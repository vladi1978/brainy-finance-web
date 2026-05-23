import { toAffiliateUrl } from "./affiliateUrl";
import { isStrictProductDetailUrl } from "./productDetailUrl";
import { fetchSearchPageHtml } from "./scrapeProduct";
import {
  parseBestBuySearchHtml,
  parseTargetSearchHtml,
  parseWalmartSearchHtml,
} from "./searchParse";
import type {
  CompareApiCandidate,
  StoreId,
  UniversalStoreId,
} from "./types";

function asUniversalStoreId(store: string): UniversalStoreId {
  return store as UniversalStoreId;
}
import {
  extractUniversalPdpLinksFromSearchHtml,
  isUniversalRetailerSearchUrl,
  pickBestUniversalPdpFromCandidates,
  scoreUniversalPdpCandidateMatch,
  UNIVERSAL_PDP_MIN_MATCH_SCORE,
  type UniversalSearchPdpPick,
} from "./universalSearchToPdp";

/** @deprecated Prefer universal resolver — kept for optional store HTML parsers. */
export const PDP_SECOND_PASS_STORES = new Set<StoreId>([
  "walmart",
  "target",
  "bestbuy",
]);

export type PdpResolveFromSearchResult = {
  productUrl: string;
  confidence: "medium" | "high";
  matchedTitle: string;
  similarity: number;
};

function storeAdapterSearchCards(
  store: StoreId,
  html: string
): { title: string; productUrl: string }[] {
  switch (store) {
    case "walmart":
      return parseWalmartSearchHtml(html, 48);
    case "target":
      return parseTargetSearchHtml(html, 48);
    case "bestbuy":
      return parseBestBuySearchHtml(html, 48);
    default:
      return [];
  }
}

function pickFromStoreAdapterCards(args: {
  store: StoreId;
  candidateTitle: string;
  cards: { title: string; productUrl: string }[];
}): UniversalSearchPdpPick | null {
  const { store, candidateTitle, cards } = args;
  const picks = cards
    .filter((c) => isStrictProductDetailUrl(store, c.productUrl))
    .map((c) => ({
      productUrl: c.productUrl,
      anchorText: c.title,
    }));

  return pickBestUniversalPdpFromCandidates({
    candidateTitle,
    store,
    picks,
  });
}

/**
 * Universal search SERP → PDP (store adapter parsers optional precision layer).
 */
export async function resolvePdpFromUniversalSearchSerp(args: {
  store: UniversalStoreId;
  searchUrl: string;
  candidateTitle: string;
  brandHint?: string | null;
}): Promise<UniversalSearchPdpPick | null> {
  const { store, searchUrl, candidateTitle, brandHint } = args;
  const trimmedSearch = searchUrl.trim();
  if (!trimmedSearch || !isUniversalRetailerSearchUrl(trimmedSearch)) return null;

  const html = await fetchSearchPageHtml(trimmedSearch);
  if (!html?.trim()) {
    console.log(
      "[PDP_UNIVERSAL_FAIL]",
      JSON.stringify({
        store,
        reason: "fetch_empty",
        searchUrlPreview: trimmedSearch.slice(0, 160),
      })
    );
    return null;
  }

  if (PDP_SECOND_PASS_STORES.has(store as StoreId)) {
    const adapterPick = pickFromStoreAdapterCards({
      store: store as StoreId,
      candidateTitle,
      cards: storeAdapterSearchCards(store as StoreId, html),
    });
    if (adapterPick) return adapterPick;
  }

  const universalPicks = extractUniversalPdpLinksFromSearchHtml(
    html,
    trimmedSearch
  );

  const universalPick = pickBestUniversalPdpFromCandidates({
    candidateTitle,
    brandHint,
    store,
    picks: universalPicks,
  });

  if (!universalPick) {
    console.log(
      "[PDP_UNIVERSAL_FAIL]",
      JSON.stringify({
        store,
        reason: "no_safe_pdp_match",
        linksScanned: universalPicks.length,
        searchUrlPreview: trimmedSearch.slice(0, 160),
      })
    );
  }

  return universalPick;
}

/**
 * @deprecated Use {@link resolvePdpFromUniversalSearchSerp} — thin wrapper for legacy callers.
 */
export async function resolvePdpFromStoreSearchSerp(args: {
  store: StoreId;
  searchUrl: string;
  candidateTitle: string;
}): Promise<PdpResolveFromSearchResult | null> {
  const resolved = await resolvePdpFromUniversalSearchSerp({
    store: args.store,
    searchUrl: args.searchUrl,
    candidateTitle: args.candidateTitle,
  });
  if (!resolved) return null;
  return {
    productUrl: resolved.productUrl,
    confidence: resolved.confidence,
    matchedTitle: resolved.anchorText || args.candidateTitle,
    similarity: resolved.matchScore,
  };
}

function outboundSearchUrlForCandidate(api: CompareApiCandidate): string {
  return (
    api.outboundUrl?.trim() ||
    api.productUrl?.trim() ||
    ""
  );
}

/**
 * Second-pass: upgrade retailer search outbound URLs to PDPs when universal parsing + title match are confident.
 */
export async function resolveDisplayedSearchPdps(
  apis: CompareApiCandidate[],
  demoMode: boolean
): Promise<CompareApiCandidate[]> {
  if (demoMode) return apis;

  return Promise.all(
    apis.map(async (api) => {
      try {
        if (api.urlType !== "search") return api;

        const searchUrl = outboundSearchUrlForCandidate(api);
        if (!searchUrl || !isUniversalRetailerSearchUrl(searchUrl)) return api;

        console.log(
          "[PDP_UNIVERSAL_ATTEMPT]",
          JSON.stringify({
            store: api.store,
            searchUrlPreview: searchUrl.slice(0, 180),
            titlePreview: api.title.slice(0, 120),
          })
        );

        const brandHint =
          api.normalized?.brand ??
          api.normalized?.structured?.brand ??
          null;

        const storeId = asUniversalStoreId(api.store);

        const resolved = await resolvePdpFromUniversalSearchSerp({
          store: storeId,
          searchUrl,
          candidateTitle: api.title,
          brandHint,
        });

        if (!resolved) return api;

        const outboundRaw = resolved.productUrl.trim();
        if (!outboundRaw) return api;

        console.log(
          "[PDP_UNIVERSAL_SUCCESS]",
          JSON.stringify({
            store: api.store,
            confidence: resolved.confidence,
            matchScore: Math.round(resolved.matchScore * 1000) / 1000,
            pdpPreview: outboundRaw.slice(0, 180),
            anchorPreview: resolved.anchorText.slice(0, 100),
          })
        );

        const affiliateUrl =
          outboundRaw.length > 0 ? toAffiliateUrl(outboundRaw, storeId) : "";

        return {
          ...api,
          productUrl: outboundRaw,
          resolvedProductUrl: outboundRaw,
          affiliateUrl: affiliateUrl || outboundRaw,
          outboundUrl: affiliateUrl || outboundRaw,
          urlType: "product" as const,
          urlConfidence: resolved.confidence,
          urlResolutionReason: "universal_search_to_pdp_resolved",
          outboundIsStoreSearch: false,
        };
      } catch (err) {
        console.log(
          "[PDP_UNIVERSAL_FAIL]",
          JSON.stringify({
            store: api.store,
            reason: "resolver_threw",
            detail: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
          })
        );
        return api;
      }
    })
  );
}

export {
  isUniversalRetailerSearchUrl,
  scoreUniversalPdpCandidateMatch,
  UNIVERSAL_PDP_MIN_MATCH_SCORE,
};

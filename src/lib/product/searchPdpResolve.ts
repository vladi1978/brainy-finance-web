import { toAffiliateUrl } from "./affiliateUrl";
import { tokenizeSignificant } from "./normalize";
import { isStrictProductDetailUrl } from "./productDetailUrl";
import { resolveCompareCandidateOutbound } from "./productUrlResolver";
import { fetchSearchPageHtml } from "./scrapeProduct";
import {
  parseBestBuySearchHtml,
  parseTargetSearchHtml,
  parseWalmartSearchHtml,
} from "./searchParse";
import type { CompareApiCandidate, StoreId } from "./types";

const PDP_SECOND_PASS_STORES = new Set<StoreId>([
  "walmart",
  "target",
  "bestbuy",
]);

const MIN_TITLE_SIMILARITY = 0.2;

export type PdpResolveFromSearchResult = {
  productUrl: string;
  confidence: "medium" | "high";
  matchedTitle: string;
  similarity: number;
};

function titleMatchScore(candidateTitle: string, cardTitle: string): number {
  const a = new Set(tokenizeSignificant(candidateTitle));
  const b = new Set(tokenizeSignificant(cardTitle));
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter += 1;
  }
  return inter / Math.max(a.size, b.size);
}

/**
 * Fetch a retailer search SERP and pick the product card whose title best matches the listing.
 */
export async function resolvePdpFromStoreSearchSerp(args: {
  store: StoreId;
  searchUrl: string;
  candidateTitle: string;
}): Promise<PdpResolveFromSearchResult | null> {
  const { store, searchUrl, candidateTitle } = args;
  const html = await fetchSearchPageHtml(searchUrl);
  if (!html?.trim()) return null;

  let cards: { title: string; productUrl: string }[] = [];
  switch (store) {
    case "walmart":
      cards = parseWalmartSearchHtml(html, 48);
      break;
    case "target":
      cards = parseTargetSearchHtml(html, 48);
      break;
    case "bestbuy":
      cards = parseBestBuySearchHtml(html, 48);
      break;
    default:
      return null;
  }

  let best: { card: (typeof cards)[0]; score: number } | null = null;
  for (const card of cards) {
    if (!isStrictProductDetailUrl(store, card.productUrl)) continue;
    const score = titleMatchScore(candidateTitle, card.title);
    if (!best || score > best.score) best = { card, score };
  }

  if (!best || best.score < MIN_TITLE_SIMILARITY) return null;

  const confidence: "medium" | "high" =
    best.score >= 0.48 ? "high" : "medium";

  return {
    productUrl: best.card.productUrl,
    confidence,
    matchedTitle: best.card.title,
    similarity: best.score,
  };
}

/**
 * Second-pass PDP resolution for compare candidates that only have a store search outbound URL.
 */
export async function resolveDisplayedSearchPdps(
  apis: CompareApiCandidate[],
  demoMode: boolean
): Promise<CompareApiCandidate[]> {
  if (demoMode) return apis;

  return Promise.all(
    apis.map(async (api) => {
      if (
        api.urlType !== "search" ||
        !PDP_SECOND_PASS_STORES.has(api.store as StoreId)
      ) {
        return api;
      }

      const store = api.store as StoreId;
      const { outboundUrlRaw } = resolveCompareCandidateOutbound({
        store,
        listingProductUrl: api.productUrl,
        title: api.title,
      });
      const searchUrl = outboundUrlRaw.trim();
      if (!searchUrl) {
        console.log(
          "[PDP_RESOLVE_FAIL]",
          JSON.stringify({ store, reason: "empty_search_url" })
        );
        return api;
      }

      console.log(
        "[PDP_RESOLVE_ATTEMPT]",
        JSON.stringify({
          store,
          searchUrlPreview: searchUrl.slice(0, 180),
          titlePreview: api.title.slice(0, 120),
        })
      );

      const resolved = await resolvePdpFromStoreSearchSerp({
        store,
        searchUrl,
        candidateTitle: api.title,
      });

      if (!resolved) {
        console.log(
          "[PDP_RESOLVE_FAIL]",
          JSON.stringify({
            store,
            reason: "no_matching_pdp_or_fetch_parse_failed",
            searchUrlPreview: searchUrl.slice(0, 140),
          })
        );
        return api;
      }

      console.log(
        "[PDP_RESOLVE_SUCCESS]",
        JSON.stringify({
          store,
          confidence: resolved.confidence,
          similarity: Math.round(resolved.similarity * 1000) / 1000,
          pdpPreview: resolved.productUrl.slice(0, 160),
          matchedTitlePreview: resolved.matchedTitle.slice(0, 120),
        })
      );

      const outboundRaw = resolved.productUrl;
      const affiliateUrl =
        outboundRaw.length > 0 ? toAffiliateUrl(outboundRaw, store) : "";

      return {
        ...api,
        resolvedProductUrl: outboundRaw,
        affiliateUrl: affiliateUrl || outboundRaw,
        outboundUrl: affiliateUrl || outboundRaw,
        urlType: "product",
        urlConfidence: resolved.confidence,
        urlResolutionReason: "pdp_resolved_from_store_search_serp",
        outboundIsStoreSearch: false,
      };
    })
  );
}

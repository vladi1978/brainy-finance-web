import { toAffiliateUrl } from "./affiliateUrl";
import {
  isClearlyHomepageOrCategoryOnly,
  isProductDetailStoreKey,
  isProductLikeRetailerUrl,
  isStrictProductDetailUrl,
  type ProductDetailStoreKey,
} from "./productDetailUrl";
import type {
  CompareApiCandidate,
  UniversalStoreId,
} from "./types";
import {
  isUniversalPdpCandidateUrl,
  isUniversalRetailerSearchUrl,
  pickBestUniversalPdpFromCandidates,
  scoreUniversalPdpCandidateMatch,
  UNIVERSAL_PDP_MIN_MATCH_SCORE,
  type UniversalSearchPdpPick,
} from "./universalSearchToPdp";

export type PdpResolveFromSearchResult = {
  productUrl: string;
  confidence: "medium" | "high";
  matchedTitle: string;
  similarity: number;
};

type SerperOrganicRow = {
  title?: string;
  link?: string;
  snippet?: string;
};

function normHost(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

function retailerHostFromUrl(url: string): string | null {
  try {
    return normHost(new URL(url.trim()).hostname);
  } catch {
    return null;
  }
}

function hostMatchesRetailerHost(url: string, retailerHost: string): boolean {
  try {
    const host = normHost(new URL(url.trim()).hostname);
    return host === retailerHost || host.endsWith(`.${retailerHost}`);
  } catch {
    return false;
  }
}

async function fetchSerperWebSearchOrganic(
  query: string
): Promise<SerperOrganicRow[]> {
  const apiKey = process.env.SERPER_API_KEY?.trim();
  if (!apiKey) return [];

  const endpoint =
    process.env.PRODUCT_SERPER_SEARCH_URL?.trim() ??
    "https://google.serper.dev/search";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      gl: process.env.PRODUCT_SHOPPING_GL?.trim() ?? "us",
      hl: process.env.PRODUCT_SHOPPING_HL?.trim() ?? "en",
      num: 10,
    }),
  });

  if (!res.ok) return [];

  try {
    const payload = (await res.json()) as {
      organic?: SerperOrganicRow[];
    };
    return Array.isArray(payload.organic) ? payload.organic : [];
  } catch {
    return [];
  }
}

function buildEnrichedTitleForPdpSearch(api: CompareApiCandidate): string {
  const parts = [api.title.replace(/\s+/g, " ").trim()];
  const brand =
    api.normalized?.brand ?? api.normalized?.structured?.brand ?? null;
  if (brand) {
    const b = brand.trim();
    if (b.length >= 2 && !api.title.toLowerCase().includes(b.toLowerCase())) {
      parts.push(b);
    }
  }
  const models = api.normalized?.modelTokens ?? [];
  for (const m of models.slice(0, 2)) {
    const tok = m.trim();
    if (tok.length >= 2 && !api.title.toLowerCase().includes(tok.toLowerCase())) {
      parts.push(tok);
    }
  }
  const size =
    api.normalized?.sizeInches ?? api.normalized?.structured?.sizeInches ?? null;
  if (size != null && Number.isFinite(size)) {
    const sizeStr = `${size}"`;
    if (!api.title.includes(String(size))) parts.push(sizeStr);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** `site:{retailerHost} "{title}"` — universal second-pass PDP discovery query. */
export function buildSecondPassPdpSerpQuery(args: {
  retailerHost: string;
  candidateTitle: string;
}): string {
  const host = normHost(args.retailerHost);
  const title = args.candidateTitle.replace(/["']/g, "").replace(/\s+/g, " ").trim();
  return `site:${host} "${title || "product"}"`;
}

function isRejectedNonPdpUrl(
  store: UniversalStoreId,
  url: string,
  retailerHost: string
): boolean {
  const trimmed = url.trim();
  if (!trimmed.startsWith("http")) return true;
  if (!hostMatchesRetailerHost(trimmed, retailerHost)) return true;
  if (isUniversalRetailerSearchUrl(trimmed)) return true;

  try {
    const u = new URL(trimmed);
    const path = u.pathname.replace(/\/+$/, "");
    if (path === "" || path === "/") return true;
    if (path.toLowerCase().includes("/category")) return true;
  } catch {
    return true;
  }

  if (isProductDetailStoreKey(store)) {
    if (isClearlyHomepageOrCategoryOnly(store as ProductDetailStoreKey, trimmed)) {
      return true;
    }
  }

  return false;
}

function isAcceptedSecondPassPdpUrl(
  store: UniversalStoreId,
  url: string,
  retailerHost: string
): boolean {
  if (isRejectedNonPdpUrl(store, url, retailerHost)) return false;

  if (isProductDetailStoreKey(store)) {
    const key = store as ProductDetailStoreKey;
    return (
      isStrictProductDetailUrl(key, url) || isProductLikeRetailerUrl(key, url)
    );
  }

  return isUniversalPdpCandidateUrl(url, { searchPageHost: retailerHost });
}

function confidenceForPdpUrl(
  store: UniversalStoreId,
  productUrl: string,
  matchScore: number
): "medium" | "high" {
  if (isProductDetailStoreKey(store) && isStrictProductDetailUrl(store, productUrl)) {
    return "high";
  }
  if (matchScore >= 0.55) return "high";
  return "medium";
}

/**
 * Serper site: search → retailer PDP (no retailer HTML scraping).
 */
export async function resolvePdpViaSerperSiteSearch(args: {
  store: UniversalStoreId;
  searchUrl: string;
  candidateTitle: string;
  brandHint?: string | null;
  enrichedTitle?: string;
}): Promise<UniversalSearchPdpPick | null> {
  const retailerHost = retailerHostFromUrl(args.searchUrl);
  if (!retailerHost) return null;

  const titleForQuery =
    args.enrichedTitle?.trim() || args.candidateTitle.trim();
  const query = buildSecondPassPdpSerpQuery({
    retailerHost,
    candidateTitle: titleForQuery,
  });

  const organic = await fetchSerperWebSearchOrganic(query);
  if (organic.length === 0) return null;

  const picks: { productUrl: string; anchorText: string }[] = [];
  for (const row of organic) {
    const link = typeof row.link === "string" ? row.link.trim() : "";
    if (!link) continue;
    if (!isAcceptedSecondPassPdpUrl(args.store, link, retailerHost)) continue;
    const anchorText =
      (typeof row.title === "string" && row.title.trim()) ||
      (typeof row.snippet === "string" && row.snippet.trim().slice(0, 200)) ||
      "";
    picks.push({ productUrl: link, anchorText });
  }

  if (picks.length === 0) return null;

  const best = pickBestUniversalPdpFromCandidates({
    candidateTitle: args.candidateTitle,
    brandHint: args.brandHint,
    store: args.store,
    picks,
  });

  if (!best) return null;

  return {
    ...best,
    confidence: confidenceForPdpUrl(args.store, best.productUrl, best.matchScore),
  };
}

/**
 * @deprecated Use {@link resolvePdpViaSerperSiteSearch}.
 */
export async function resolvePdpFromUniversalSearchSerp(args: {
  store: UniversalStoreId;
  searchUrl: string;
  candidateTitle: string;
  brandHint?: string | null;
}): Promise<UniversalSearchPdpPick | null> {
  const enrichedParts = [args.candidateTitle.trim()];
  const brand = args.brandHint?.trim();
  if (brand && !args.candidateTitle.toLowerCase().includes(brand.toLowerCase())) {
    enrichedParts.push(brand);
  }
  return resolvePdpViaSerperSiteSearch({
    ...args,
    enrichedTitle: enrichedParts.join(" ").replace(/\s+/g, " ").trim(),
  });
}

/**
 * @deprecated Use {@link resolvePdpViaSerperSiteSearch}.
 */
export async function resolvePdpFromStoreSearchSerp(args: {
  store: import("./types").StoreId;
  searchUrl: string;
  candidateTitle: string;
}): Promise<PdpResolveFromSearchResult | null> {
  const resolved = await resolvePdpViaSerperSiteSearch({
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
  return api.outboundUrl?.trim() || api.productUrl?.trim() || "";
}

/**
 * Second-pass: upgrade retailer search outbound URLs to PDPs via Serper site: search.
 */
export async function resolveDisplayedSearchPdps(
  apis: CompareApiCandidate[],
  demoMode: boolean
): Promise<CompareApiCandidate[]> {
  if (demoMode) return apis;
  if (!process.env.SERPER_API_KEY?.trim()) return apis;

  return Promise.all(
    apis.map(async (api) => {
      try {
        if (api.urlType !== "search") return api;

        const searchUrl = outboundSearchUrlForCandidate(api);
        if (!searchUrl) return api;

        const retailerHost = retailerHostFromUrl(searchUrl);
        if (!retailerHost) return api;

        const enrichedTitle = buildEnrichedTitleForPdpSearch(api);
        const brandHint =
          api.normalized?.brand ?? api.normalized?.structured?.brand ?? null;

        console.log(
          "[PDP_SECOND_PASS_ATTEMPT]",
          JSON.stringify({
            store: api.store,
            retailerHost,
            titlePreview: api.title.slice(0, 120),
            searchUrlPreview: searchUrl.slice(0, 180),
            queryPreview: buildSecondPassPdpSerpQuery({
              retailerHost,
              candidateTitle: enrichedTitle,
            }).slice(0, 200),
          })
        );

        const resolved = await resolvePdpViaSerperSiteSearch({
          store: api.store as UniversalStoreId,
          searchUrl,
          candidateTitle: api.title,
          brandHint,
          enrichedTitle,
        });

        if (!resolved) {
          console.log(
            "[PDP_SECOND_PASS_NOT_FOUND]",
            JSON.stringify({
              store: api.store,
              retailerHost,
              searchUrlPreview: searchUrl.slice(0, 180),
            })
          );
          return api;
        }

        const outboundRaw = resolved.productUrl.trim();
        if (!outboundRaw) {
          console.log(
            "[PDP_SECOND_PASS_NOT_FOUND]",
            JSON.stringify({
              store: api.store,
              reason: "empty_pdp_url",
            })
          );
          return api;
        }

        const storeId = api.store as UniversalStoreId;
        const affiliateUrl =
          outboundRaw.length > 0 ? toAffiliateUrl(outboundRaw, storeId) : "";

        console.log(
          "[PDP_SECOND_PASS_FOUND]",
          JSON.stringify({
            store: api.store,
            confidence: resolved.confidence,
            matchScore: Math.round(resolved.matchScore * 1000) / 1000,
            pdpPreview: outboundRaw.slice(0, 180),
            anchorPreview: resolved.anchorText.slice(0, 100),
          })
        );

        return {
          ...api,
          productUrl: outboundRaw,
          resolvedProductUrl: outboundRaw,
          affiliateUrl: affiliateUrl || outboundRaw,
          outboundUrl: affiliateUrl || outboundRaw,
          urlType: "product" as const,
          urlConfidence: resolved.confidence,
          urlResolutionReason: "second_pass_pdp_resolved",
          outboundIsStoreSearch: false,
        };
      } catch (err) {
        console.log(
          "[PDP_SECOND_PASS_NOT_FOUND]",
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

/** @deprecated Prefer Serper second pass — kept for optional store HTML parsers. */
export const PDP_SECOND_PASS_STORES = new Set<import("./types").StoreId>([
  "walmart",
  "target",
  "bestbuy",
]);

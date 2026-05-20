import {
  isAcceptableUniversalShoppingOutboundUrl,
  isBlockedUserFacingOutboundUrl,
  isClearlyHomepageOrCategoryOnly,
  isProductDetailStoreKey,
  isStrictProductDetailUrl,
  isProductLikeRetailerUrl,
  isRetailerSearchUrl,
  type ProductDetailStoreKey,
} from "./productDetailUrl";
import { shortenSearchQuery, truncateAtWordBoundary } from "./shortenSearchQuery";
import type { StoreId, UniversalStoreId } from "./types";

function truncateUrlForLog(url: string, max = 240): string {
  const t = url.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

type OutboundLogTag =
  | "URL_STRICT_PRODUCT"
  | "URL_KEPT_PRODUCT_LIKE"
  | "URL_SEARCH"
  | "URL_GENERATED_SEARCH_FALLBACK"
  | "URL_REJECTED_GOOGLE_OR_TRACKING";

function logOutboundResolution(
  tag: OutboundLogTag,
  store: UniversalStoreId,
  fields: Record<string, string>,
) {
  const parts = [`[${tag}]`, `store=${store}`, ...Object.entries(fields).map(([k, v]) => `${k}=${v}`)];
  console.log(parts.join(" "));
}

export type ProductOutboundUrlKind = "product" | "search" | "unknown";

export type ProductUrlConfidence = "high" | "medium" | "low";

export type ResolvedCompareCandidateOutbound = {
  /** Raw HTTPS URL opened for the shopper (before affiliate wrapping). */
  outboundUrlRaw: string;
  /** Present when outbound is a retailer PDP (same URL as outbound in practice). */
  resolvedProductUrl?: string;
  urlType: ProductOutboundUrlKind;
  urlConfidence: ProductUrlConfidence;
  urlResolutionReason?: string;
};

function isMalformedHttpUrl(url: string): boolean {
  const trimmed = url.replace(/\s+/g, " ").trim();
  if (!trimmed) return true;
  try {
    const u = new URL(trimmed);
    return !/^https?:$/i.test(u.protocol);
  } catch {
    return true;
  }
}

function shouldGenerateSearchFallback(
  store: ProductDetailStoreKey,
  listingRaw: string
): boolean {
  if (!listingRaw.trim()) return true;
  if (isMalformedHttpUrl(listingRaw)) return true;
  if (isBlockedUserFacingOutboundUrl(listingRaw)) return true;
  if (isStrictProductDetailUrl(store, listingRaw)) return false;
  if (isProductLikeRetailerUrl(store, listingRaw)) return false;
  return isClearlyHomepageOrCategoryOnly(store, listingRaw);
}

function generatedSearchFallback(
  store: ProductDetailStoreKey,
  title: string,
  priorListing: string
): ResolvedCompareCandidateOutbound {
  const generated = buildRetailerSearchUrlFromTitle(store, title);
  if (!generated.trim() || isBlockedUserFacingOutboundUrl(generated)) {
    return {
      outboundUrlRaw: "",
      urlType: "unknown",
      urlConfidence: "low",
      urlResolutionReason: "generated_search_blocked_or_empty",
    };
  }

  logOutboundResolution("URL_GENERATED_SEARCH_FALLBACK", store, {
    url: truncateUrlForLog(generated),
    title_preview: truncateUrlForLog(title, 160),
    prior_listing_present: priorListing ? "yes" : "no",
  });

  return finalizeOutboundResolution(store, {
    outboundUrlRaw: generated,
    urlType: "search",
    urlConfidence: "low",
    urlResolutionReason: priorListing
      ? "generated_search_fallback_from_title"
      : "missing_listing_link_generated_search",
  });
}

/**
 * Retailer search URL using a shortened listing title (honest fallback when PDP/affiliate links are unreliable).
 */
function prepareRetailerSearchQuery(title: string, maxDecoded: number): string {
  let q = shortenSearchQuery(title, maxDecoded);
  q = q.replace(/["'`]/g, "");
  q = truncateAtWordBoundary(q.replace(/\s+/g, " ").trim(), maxDecoded);
  if (!q.trim()) {
    q = truncateAtWordBoundary(
      title.replace(/\s+/g, " ").trim().replace(/["'`]/g, ""),
      maxDecoded,
    );
  }
  return q;
}

export function buildRetailerSearchUrlFromTitle(store: StoreId, title: string): string {
  const maxDecoded = store === "bestbuy" ? 50 : 60;
  const q = prepareRetailerSearchQuery(title, maxDecoded);
  const enc = encodeURIComponent(q || " ");
  switch (store) {
    case "amazon":
      return `https://www.amazon.com/s?k=${enc}`;
    case "walmart":
      return `https://www.walmart.com/search?q=${enc}`;
    case "target":
      return `https://www.target.com/s?searchTerm=${enc}`;
    case "temu":
      return `https://www.temu.com/search_result.html?search_key=${enc}`;
    case "bestbuy":
      return `https://www.bestbuy.com/site/searchpage.jsp?st=${enc}`;
    case "homedepot":
      return `https://www.homedepot.com/s/${enc}`;
    case "lowes":
      return `https://www.lowes.com/search?searchTerm=${enc}`;
    case "costco":
      return `https://www.costco.com/CatalogSearch?keyword=${enc}`;
    case "samsclub":
      return `https://www.samsclub.com/search?searchTerm=${enc}`;
    case "ebay":
      return `https://www.ebay.com/sch/i.html?_nkw=${enc}`;
    case "macys":
      return `https://www.macys.com/shop/featured/${enc}`;
    case "kohls":
      return `https://www.kohls.com/search/results.jsp?search=${enc}`;
    case "wayfair":
      return `https://www.wayfair.com/keyword.php?keyword=${enc}`;
    case "overstock":
      return `https://www.overstock.com/search?keywords=${enc}`;
    case "chewy":
      return `https://www.chewy.com/s?query=${enc}`;
    case "academy":
      return `https://www.academy.com/search?q=${enc}`;
    case "tractorsupply":
      return `https://www.tractorsupply.com/tsc/search?keyword=${enc}`;
    case "nike":
      return `https://www.nike.com/w?q=${enc}`;
    case "adidas":
      return `https://www.adidas.com/us/search?q=${enc}`;
    default:
      return "";
  }
}

function hasUsableListingTitle(title: string): boolean {
  return title.replace(/\s+/g, " ").trim().length >= 2;
}

/** Extract search query from Tractor Supply URLs (canonical or legacy SERP paths). */
function tractorSupplySearchQuery(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (!u.hostname.toLowerCase().includes("tractorsupply.com")) return null;
    for (const key of ["keyword", "q", "searchTerm", "Ntt", "ntt", "query"]) {
      const v = u.searchParams.get(key)?.trim();
      if (v) return v;
    }
    return null;
  } catch {
    return null;
  }
}

function isTractorSupplySearchPath(url: string): boolean {
  try {
    const u = new URL(url.trim());
    if (!u.hostname.toLowerCase().includes("tractorsupply.com")) return false;
    const pl = u.pathname.toLowerCase();
    return (
      pl.includes("/tsc/search") ||
      pl === "/search" ||
      pl.startsWith("/search/") ||
      pl.includes("/search-results")
    );
  } catch {
    return false;
  }
}

/** Canonical Tractor Supply search URL: https://www.tractorsupply.com/tsc/search?keyword=QUERY */
export function canonicalizeTractorSupplySearchUrl(
  url: string,
  queryFallback?: string
): string {
  const q = tractorSupplySearchQuery(url) ?? queryFallback?.trim();
  if (!q) return url.trim();
  const prepared = prepareRetailerSearchQuery(q, 60);
  return `https://www.tractorsupply.com/tsc/search?keyword=${encodeURIComponent(prepared || q)}`;
}

function withTractorSupplySearchCanonical(
  store: UniversalStoreId,
  resolution: ResolvedCompareCandidateOutbound
): ResolvedCompareCandidateOutbound {
  if (store !== "tractorsupply" || resolution.urlType !== "search") return resolution;
  const raw = resolution.outboundUrlRaw.trim();
  if (!raw) return resolution;
  const canonical = canonicalizeTractorSupplySearchUrl(raw);
  if (canonical === raw) return resolution;
  return { ...resolution, outboundUrlRaw: canonical };
}

function logOutboundUrlDebug(
  store: UniversalStoreId,
  resolution: ResolvedCompareCandidateOutbound,
): void {
  const outboundUrl = resolution.outboundUrlRaw.trim();
  if (!outboundUrl) return;
  console.log("[OUTBOUND_URL_DEBUG]", {
    store,
    urlType: resolution.urlType,
    urlResolutionReason: resolution.urlResolutionReason ?? null,
    outboundUrl: truncateUrlForLog(outboundUrl),
  });
}

function finalizeOutboundResolution(
  store: UniversalStoreId,
  resolution: ResolvedCompareCandidateOutbound,
): ResolvedCompareCandidateOutbound {
  const finalized = withTractorSupplySearchCanonical(store, resolution);
  logOutboundUrlDebug(store, finalized);
  return finalized;
}

function isUniversalMerchantProductLikeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || isBlockedUserFacingOutboundUrl(trimmed)) return false;
  try {
    const u = new URL(trimmed);
    const pathLower = u.pathname.toLowerCase();
    if (pathLower.includes("/search") || pathLower === "/s" || pathLower.startsWith("/s/")) {
      return false;
    }
    if (
      /\/(?:product|products|item|items|dp|ip|itm|pd|sku)(?:\/|$)/i.test(pathLower) ||
      /^\/p\/[^/]/i.test(pathLower)
    ) {
      return true;
    }
    const segs = u.pathname.split("/").filter(Boolean);
    return segs.length >= 2;
  } catch {
    return false;
  }
}

/**
 * Decide what URL Brainy opens for a Shopping candidate row after attribute gates pass:
 * PDP (high trust), retailer search listing (medium), or title-derived search (low).
 */
export function resolveCompareCandidateOutbound(args: {
  store: UniversalStoreId;
  listingProductUrl: string;
  title: string;
  /** SERP merchant label — required for `other` Google-search fallbacks */
  sourceLabel?: string | null;
}): ResolvedCompareCandidateOutbound {
  const { store, listingProductUrl, title } = args;
  const listingRaw = listingProductUrl.replace(/\s+/g, " ").trim();

  if (store === "other") {
    if (listingRaw && isBlockedUserFacingOutboundUrl(listingRaw)) {
      logOutboundResolution("URL_REJECTED_GOOGLE_OR_TRACKING", store, {
        url: truncateUrlForLog(listingRaw),
      });
    } else if (listingRaw && isAcceptableUniversalShoppingOutboundUrl(listingRaw)) {
      const productLike = isUniversalMerchantProductLikeUrl(listingRaw);
      return finalizeOutboundResolution(store, {
        outboundUrlRaw: listingRaw,
        resolvedProductUrl: productLike ? listingRaw : undefined,
        urlType: productLike ? "product" : "search",
        urlConfidence: productLike ? "medium" : "low",
        urlResolutionReason: productLike
          ? "merchant_product_like_url"
          : "merchant_outbound_unverified",
      });
    }
    return {
      outboundUrlRaw: "",
      urlType: "unknown",
      urlConfidence: "low",
      urlResolutionReason: "other_missing_clean_merchant_url",
    };
  }

  if (!isProductDetailStoreKey(store)) {
    return {
      outboundUrlRaw: "",
      urlType: "unknown",
      urlConfidence: "low",
      urlResolutionReason: "unsupported_store",
    };
  }

  if (listingRaw && isBlockedUserFacingOutboundUrl(listingRaw)) {
    logOutboundResolution("URL_REJECTED_GOOGLE_OR_TRACKING", store, {
      url: truncateUrlForLog(listingRaw),
    });
    if (hasUsableListingTitle(title)) {
      return generatedSearchFallback(store, title, listingRaw);
    }
    return {
      outboundUrlRaw: "",
      urlType: "unknown",
      urlConfidence: "low",
      urlResolutionReason: "blocked_listing_no_title_fallback",
    };
  }

  if (listingRaw && !isMalformedHttpUrl(listingRaw)) {
    if (
      store === "tractorsupply" &&
      (isTractorSupplySearchPath(listingRaw) || tractorSupplySearchQuery(listingRaw))
    ) {
      const canonical = canonicalizeTractorSupplySearchUrl(listingRaw, title);
      logOutboundResolution("URL_SEARCH", store, {
        url: truncateUrlForLog(canonical),
      });
      return finalizeOutboundResolution(store, {
        outboundUrlRaw: canonical,
        urlType: "search",
        urlConfidence: tractorSupplySearchQuery(listingRaw) ? "medium" : "low",
        urlResolutionReason: "merchant_search_url",
      });
    }

    if (isStrictProductDetailUrl(store, listingRaw)) {
      logOutboundResolution("URL_STRICT_PRODUCT", store, {
        url: truncateUrlForLog(listingRaw),
      });
      return finalizeOutboundResolution(store, {
        outboundUrlRaw: listingRaw,
        resolvedProductUrl: listingRaw,
        urlType: "product",
        urlConfidence: "high",
        urlResolutionReason: "merchant_strict_product_url",
      });
    }

    if (isProductLikeRetailerUrl(store, listingRaw)) {
      logOutboundResolution("URL_KEPT_PRODUCT_LIKE", store, {
        url: truncateUrlForLog(listingRaw),
      });
      return finalizeOutboundResolution(store, {
        outboundUrlRaw: listingRaw,
        resolvedProductUrl: listingRaw,
        urlType: "product",
        urlConfidence: "medium",
        urlResolutionReason: "merchant_product_like_url",
      });
    }

    if (isRetailerSearchUrl(store, listingRaw)) {
      logOutboundResolution("URL_SEARCH", store, {
        url: truncateUrlForLog(listingRaw),
      });
      return finalizeOutboundResolution(store, {
        outboundUrlRaw: listingRaw,
        urlType: "search",
        urlConfidence: "medium",
        urlResolutionReason: "merchant_search_url",
      });
    }

    if (!shouldGenerateSearchFallback(store, listingRaw)) {
      return finalizeOutboundResolution(store, {
        outboundUrlRaw: listingRaw,
        resolvedProductUrl: listingRaw,
        urlType: "product",
        urlConfidence: "medium",
        urlResolutionReason: "merchant_outbound_preserved",
      });
    }
  }

  if (hasUsableListingTitle(title)) {
    return generatedSearchFallback(store, title, listingRaw);
  }

  return {
    outboundUrlRaw: "",
    urlType: "unknown",
    urlConfidence: "low",
    urlResolutionReason: "empty_title_no_outbound",
  };
}

/**
 * Shopping-row URL pick — shares outbound classification with compare resolution.
 */
export function resolveShoppingRowProductUrl(args: {
  store: UniversalStoreId;
  title: string;
  merchantUrl: string | null;
}): string | null {
  const { store, title, merchantUrl } = args;

  if (store === "other") {
    const raw = merchantUrl?.replace(/\s+/g, " ").trim() ?? "";
    if (
      raw &&
      isAcceptableUniversalShoppingOutboundUrl(raw) &&
      !isBlockedUserFacingOutboundUrl(raw)
    ) {
      return raw;
    }
    return null;
  }

  const resolution = resolveCompareCandidateOutbound({
    store,
    listingProductUrl: merchantUrl ?? "",
    title,
  });
  const outbound = resolution.outboundUrlRaw.trim();
  if (!outbound || isBlockedUserFacingOutboundUrl(outbound)) return null;
  if (resolution.urlType !== "product" && resolution.urlType !== "search") return null;
  return outbound;
}

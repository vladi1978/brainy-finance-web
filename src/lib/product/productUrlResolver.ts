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

  return {
    outboundUrlRaw: generated,
    urlType: "search",
    urlConfidence: "low",
    urlResolutionReason: priorListing
      ? "generated_search_fallback_from_title"
      : "missing_listing_link_generated_search",
  };
}

/**
 * Retailer search URL using a shortened listing title (honest fallback when PDP/affiliate links are unreliable).
 */
export function buildRetailerSearchUrlFromTitle(store: StoreId, title: string): string {
  const maxDecoded = store === "bestbuy" ? 50 : 60;
  let q = shortenSearchQuery(title, maxDecoded);
  if (store === "bestbuy") {
    q = q.replace(/["'`]/g, "");
    q = truncateAtWordBoundary(q.replace(/\s+/g, " ").trim(), maxDecoded);
  }
  if (!q.trim()) {
    q = truncateAtWordBoundary(
      title.replace(/\s+/g, " ").trim().replace(/["'`]/g, ""),
      maxDecoded
    );
  }
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
      return `https://www.tractorsupply.com/tsc/search?q=${enc}`;
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
      const productLike = /\/(product|products|\/p\/|\/pd\/|\/item\/|\/dp\/|\/ip\/|\/itm\/)/i.test(
        listingRaw
      );
      return {
        outboundUrlRaw: listingRaw,
        resolvedProductUrl: productLike ? listingRaw : undefined,
        urlType: productLike ? "product" : "search",
        urlConfidence: productLike ? "medium" : "low",
        urlResolutionReason: "merchant_outbound_unverified",
      };
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
    if (isStrictProductDetailUrl(store, listingRaw)) {
      logOutboundResolution("URL_STRICT_PRODUCT", store, {
        url: truncateUrlForLog(listingRaw),
      });
      return {
        outboundUrlRaw: listingRaw,
        resolvedProductUrl: listingRaw,
        urlType: "product",
        urlConfidence: "high",
        urlResolutionReason: "merchant_strict_product_url",
      };
    }

    if (isProductLikeRetailerUrl(store, listingRaw)) {
      logOutboundResolution("URL_KEPT_PRODUCT_LIKE", store, {
        url: truncateUrlForLog(listingRaw),
      });
      return {
        outboundUrlRaw: listingRaw,
        resolvedProductUrl: listingRaw,
        urlType: "product",
        urlConfidence: "medium",
        urlResolutionReason: "merchant_product_like_url",
      };
    }

    if (isRetailerSearchUrl(store, listingRaw)) {
      logOutboundResolution("URL_SEARCH", store, {
        url: truncateUrlForLog(listingRaw),
      });
      return {
        outboundUrlRaw: listingRaw,
        urlType: "search",
        urlConfidence: "medium",
        urlResolutionReason: "merchant_search_url",
      };
    }

    if (!shouldGenerateSearchFallback(store, listingRaw)) {
      return {
        outboundUrlRaw: listingRaw,
        resolvedProductUrl: listingRaw,
        urlType: "product",
        urlConfidence: "medium",
        urlResolutionReason: "merchant_outbound_preserved",
      };
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

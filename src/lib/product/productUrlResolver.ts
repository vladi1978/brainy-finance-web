import {
  isAcceptableUniversalShoppingOutboundUrl,
  isProductDetailStoreKey,
  isStrictProductDetailUrl,
  isProductLikeRetailerUrl,
  isRetailerSearchUrl,
} from "./productDetailUrl";
import type { StoreId, UniversalStoreId } from "./types";

function truncateUrlForLog(url: string, max = 240): string {
  const t = url.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function logOutboundResolution(
  tag: "URL_STRICT_PRODUCT" | "URL_PRODUCT_LIKE" | "URL_SEARCH" | "URL_GENERATED_SEARCH" | "URL_BLOCKED_BAD",
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

/**
 * Retailer search URL using the listing title (honest fallback when PDP/affiliate links are unreliable).
 */
export function buildRetailerSearchUrlFromTitle(store: StoreId, title: string): string {
  const q = title.replace(/\s+/g, " ").trim();
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
      return `https://www.google.com/search?q=${enc}`;
  }
}

/** Google web search — honest fallback when the merchant has no mapped host patterns. */
export function buildGoogleSearchUrlForRetailerListing(
  title: string,
  sourceLabel: string
): string {
  const q = [title, sourceLabel]
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
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
  const { store, listingProductUrl, title, sourceLabel } = args;
  const listing = listingProductUrl.replace(/\s+/g, " ").trim();
  const label = sourceLabel?.replace(/\s+/g, " ").trim() ?? "";

  if (store === "other") {
    if (listing && isAcceptableUniversalShoppingOutboundUrl(listing)) {
      let gSearch = false;
      try {
        const u = new URL(listing);
        const host = u.hostname.replace(/^www\./i, "").toLowerCase();
        gSearch =
          (host === "google.com" || host.endsWith(".google.com")) &&
          u.pathname.toLowerCase().startsWith("/search");
      } catch {
        gSearch = false;
      }
      return {
        outboundUrlRaw: listing,
        urlType: "search",
        urlConfidence: gSearch ? "low" : "medium",
        urlResolutionReason: gSearch
          ? "google_search_fallback"
          : "merchant_outbound_unverified",
      };
    }
    if (hasUsableListingTitle(title) && label.length > 0) {
      return {
        outboundUrlRaw: buildGoogleSearchUrlForRetailerListing(title, label),
        urlType: "search",
        urlConfidence: "low",
        urlResolutionReason: "google_search_fallback_from_title_and_source",
      };
    }
    return {
      outboundUrlRaw: "",
      urlType: "unknown",
      urlConfidence: "low",
      urlResolutionReason: "other_missing_outbound_and_source",
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

  if (listing && isStrictProductDetailUrl(store, listing)) {
    logOutboundResolution("URL_STRICT_PRODUCT", store, {
      url: truncateUrlForLog(listing),
    });
    return {
      outboundUrlRaw: listing,
      resolvedProductUrl: listing,
      urlType: "product",
      urlConfidence: "high",
      urlResolutionReason: "merchant_strict_product_url",
    };
  }

  if (listing && isProductLikeRetailerUrl(store, listing)) {
    logOutboundResolution("URL_PRODUCT_LIKE", store, {
      url: truncateUrlForLog(listing),
    });
    return {
      outboundUrlRaw: listing,
      resolvedProductUrl: listing,
      urlType: "product",
      urlConfidence: "medium",
      urlResolutionReason: "merchant_product_like_url",
    };
  }

  if (listing && isRetailerSearchUrl(store, listing)) {
    logOutboundResolution("URL_SEARCH", store, {
      url: truncateUrlForLog(listing),
    });
    return {
      outboundUrlRaw: listing,
      urlType: "search",
      urlConfidence: "medium",
      urlResolutionReason: "merchant_search_url",
    };
  }

  if (hasUsableListingTitle(title)) {
    const generated = buildRetailerSearchUrlFromTitle(store, title);
    logOutboundResolution("URL_GENERATED_SEARCH", store, {
      url: truncateUrlForLog(generated),
      title_preview: truncateUrlForLog(title, 160),
      prior_listing_present: listing ? "yes" : "no",
    });
    if (listing) {
      logOutboundResolution("URL_BLOCKED_BAD", store, {
        url: truncateUrlForLog(listing),
        detail: "not_strict_not_product_like_not_retailer_search",
      });
    }
    return {
      outboundUrlRaw: generated,
      urlType: "search",
      urlConfidence: "low",
      urlResolutionReason: listing
        ? "generated_search_fallback_from_title"
        : "missing_listing_link_generated_search",
    };
  }

  if (listing) {
    logOutboundResolution("URL_BLOCKED_BAD", store, {
      url: truncateUrlForLog(listing),
      detail: "empty_title_unusable_outbound",
    });
  }

  return {
    outboundUrlRaw: "",
    urlType: "unknown",
    urlConfidence: "low",
    urlResolutionReason: "empty_title_no_outbound",
  };
}

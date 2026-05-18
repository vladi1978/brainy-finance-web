import {
  isAcceptableUniversalShoppingOutboundUrl,
  isProductDetailStoreKey,
  isStrictProductDetailUrl,
  isRetailerSearchUrl,
} from "./productDetailUrl";
import type { StoreId, UniversalStoreId } from "./types";

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
    return {
      outboundUrlRaw: listing,
      resolvedProductUrl: listing,
      urlType: "product",
      urlConfidence: "high",
      urlResolutionReason: "merchant_product_detail_url",
    };
  }

  if (listing && isRetailerSearchUrl(store, listing)) {
    return {
      outboundUrlRaw: listing,
      urlType: "search",
      urlConfidence: "medium",
      urlResolutionReason: "merchant_search_url",
    };
  }

  if (hasUsableListingTitle(title)) {
    return {
      outboundUrlRaw: buildRetailerSearchUrlFromTitle(store, title),
      urlType: "search",
      urlConfidence: "low",
      urlResolutionReason: listing
        ? "generated_search_fallback_from_title"
        : "missing_listing_link_generated_search",
    };
  }

  return {
    outboundUrlRaw: "",
    urlType: "unknown",
    urlConfidence: "low",
    urlResolutionReason: "empty_title_no_outbound",
  };
}

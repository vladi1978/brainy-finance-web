/**
 * Shopping Assistant–only TV need matching.
 * Does not change Compare & Save identity/TV gates.
 */

import {
  detectDisplayDeviceKind,
  extractDiagonalInches,
} from "./matching/displayDimensions";
import { extractSizeInches } from "./normalize";
import type { CandidateProduct, CompareApiCandidate } from "./types";

type ShoppingNeed = {
  attributes: Record<string, string>;
};

type SizeFit = "match" | "mismatch" | "unknown";

const TV_ACCESSORY_RE =
  /\b(wall\s*mount|tv\s*mount|mounting\s*(bracket|kit|arm|hardware)|tilt\s*mount|full[\s-]*motion\s*mount|tv\s*stand|tv\s*base|tv\s*table|sound\s*bar|soundbar|tv\s*antenna|hdmi\s*cable|optical\s*cable|tv\s*cover|dust\s*cover|screen\s*cleaner|universal\s*remote|replacement\s*remote|tv\s*bracket|wall\s*bracket)\b/i;

export function isTvShoppingAccessory(title: string): boolean {
  return TV_ACCESSORY_RE.test(title);
}

export function isTelevisionProductTitle(title: string): boolean {
  if (isTvShoppingAccessory(title)) return false;
  const kind = detectDisplayDeviceKind(title);
  if (kind === "monitor" || kind === "laptop") return false;
  if (kind === "tv") return true;
  return /\b(television|smart\s*tv|\btv\b)\b/i.test(title);
}

/**
 * Shopping-only explicit TV size phrases. Does not infer size from SKUs like C6 or WD58.
 * Recognizes: 65" 65″ 65-inch 65 inch 65in 65 in. Class 65 65-In. 65-In
 */
export function extractShoppingTvInches(title: string): number | null {
  const t = title
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D\u2033\u00B4]/g, '"')
    .replace(/[–—]/g, "-");
  const patterns: RegExp[] = [
    /\b(\d{2,3})\s*["″]/,
    /\b(\d{2,3})\s*-?\s*in(?:ch(?:es)?)?\.?(?=\s|$|[^a-z])/i,
    /\b(\d{2,3})\s*-in\.?(?=\s|$|[^a-z])/i,
    /\bclass\s+(\d{2,3})\b/i,
    /\b(\d{2,3})\s*-?\s*class\b/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m?.[1]) continue;
    const n = Number.parseInt(m[1], 10);
    if (n >= 20 && n <= 120) return n;
  }
  return null;
}

export function listingScreenInches(title: string, sizeInches?: number | null): number | null {
  const explicit = extractShoppingTvInches(title);
  if (explicit != null) return explicit;
  if (typeof sizeInches === "number" && Number.isFinite(sizeInches) && sizeInches >= 20) {
    return Math.round(sizeInches);
  }
  const fromDisplay = extractDiagonalInches(title, { deviceKind: "tv" });
  if (fromDisplay != null) return Math.round(fromDisplay);
  const fromTitle = extractSizeInches(title);
  if (fromTitle != null && fromTitle >= 20) return Math.round(fromTitle);
  return null;
}

export function tvScreenSizeCompatibility(
  wantedInches: number,
  listingInches: number | null
): SizeFit {
  if (listingInches == null) return "unknown";
  if (Math.abs(listingInches - wantedInches) <= 1) return "match";
  return "mismatch";
}

/** Hard-exclude mounts/stands/accessories and non-TV devices. Size mismatches stay but rank lower. */
export function shoppingTvListingAllowed(title: string): boolean {
  if (isTvShoppingAccessory(title)) return false;
  const kind = detectDisplayDeviceKind(title);
  if (kind === "monitor" || kind === "laptop") return false;
  return isTelevisionProductTitle(title) || kind == null;
}

export function shoppingListingToCompareRow(
  listing: CandidateProduct
): CompareApiCandidate {
  const outbound = listing.affiliateUrl || listing.productUrl;
  return {
    store: listing.store,
    storeLabel: listing.sourceLabel,
    title: listing.title,
    price: listing.price,
    currency: listing.currency,
    productUrl: listing.productUrl,
    affiliateUrl: listing.affiliateUrl,
    imageUrl: listing.imageUrl,
    rating: listing.rating ?? null,
    normalized: listing.normalized,
    confidence: listing.sourceConfidence,
    matchConfidenceLabel: "medium",
    matchType: "close_match",
    identityScore: 0,
    identityReasons: [],
    missingCriticalAttributes: [],
    relevanceScore: 50,
    relevanceReason: "shopping_discovery",
    matchReasons: [],
    outboundUrl: outbound,
    urlType: "product",
    urlConfidence: "medium",
    rawPriceText: listing.rawPriceText ?? null,
    commercialListing: listing.commercialListing,
  };
}

export function applyShoppingTvNeedFilter(
  interpreted: ShoppingNeed,
  rows: CompareApiCandidate[]
): CompareApiCandidate[] {
  const wanted = Number.parseInt(interpreted.attributes.screenSizeInches ?? "", 10);
  const wantedInches = Number.isFinite(wanted) ? wanted : null;

  return rows.filter((row) => {
    if (!shoppingTvListingAllowed(row.title)) return false;
    if (wantedInches == null) return true;
    const inches = listingScreenInches(
      row.title,
      row.normalized?.sizeInches ?? row.normalized?.structured?.sizeInches
    );
    const fit = tvScreenSizeCompatibility(wantedInches, inches);
    if (fit === "mismatch") return false;
    return true;
  });
}

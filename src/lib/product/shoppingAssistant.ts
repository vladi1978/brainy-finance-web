/**
 * Commercial shopping-assistant demo.
 * Uses `compareProduct` for discovery/normalization only.
 * Winner selection is Shopping Assistant–specific and does not change Compare & Save ranking.
 */

import { compareProduct } from "./compareEngine";
import type { CompareFlowDepartment } from "./compareFlowDepartment";
import { fetchGoogleShoppingCandidatesWithDiagnostics } from "./googleShoppingSearch";
import { extractPackCount } from "./normalize";
import {
  applyShoppingTvNeedFilter,
  listingScreenInches,
  shoppingListingToCompareRow,
  tvScreenSizeCompatibility,
} from "./shoppingTvCompatibility";
import type { CompareApiCandidate, CompareProductResponse } from "./types";

const LEAD_IN =
  /^(?:i\s+(?:need|want|would\s+like)|i'?m\s+(?:looking\s+for|shopping\s+for)|looking\s+for|find(?:\s+me)?|get(?:\s+me)?|buy(?:\s+me)?|can\s+you\s+find|please\s+find|help\s+me\s+(?:find|buy))\s+/i;

/** Shopping-only: typical household AA/AAA packs vs tiny impulse packs and bulk lots. */
const HOUSEHOLD_BATTERY_PACK_MIN = 8;
const HOUSEHOLD_BATTERY_PACK_MAX = 80;
/** Amazon may win within this value slack vs the cheapest comparable listing. */
const AMAZON_VALUE_SLACK = 1.75;

export type InterpretedShoppingRequest = {
  originalRequest: string;
  productQuery: string;
  category: string | null;
  department: CompareFlowDepartment | null;
  attributes: Record<string, string>;
};

export type ShoppingCompatibility = "match" | "mismatch" | "unknown";
export type ShoppingChemistry = "alkaline" | "rechargeable" | "unknown";
export type ShoppingPackClass = "household" | "bulk" | "small" | "unknown";

export type ShoppingAssistantOption = {
  title: string;
  retailer: string;
  storeId: string;
  price: number | null;
  currency: string;
  rating: number | null;
  imageUrl: string | null;
  productUrl: string;
  specifications: Record<string, string>;
  packCount: number | null;
  pricePerUnit: number | null;
  compatibility: ShoppingCompatibility;
  chemistry: ShoppingChemistry;
  packClass: ShoppingPackClass;
  matchType: string;
  identityScore: number;
  relevanceScore: number;
  matchReasons: string[];
  amazonListing: boolean;
  dataNotes: string[];
};

export type ShoppingAssistantRecommendation = {
  title: string;
  retailer: string;
  productUrl: string;
  amazonListing: boolean;
  explanation: string;
  factualReasons: string[];
};

export type ShoppingAssistantResult = {
  userRequest: string;
  interpreted: InterpretedShoppingRequest;
  options: ShoppingAssistantOption[];
  recommendation: ShoppingAssistantRecommendation | null;
  engineMessage: string | null;
  amazonPreferred: boolean;
  limitations: string[];
};

function collapseWs(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Known rent-to-own / lease merchants — listing source itself is the offer type. */
const RTO_MERCHANT_RE =
  /\brent[\s-]*a[\s-]*center\b|\brentacenter\b|\baaron'?s\b|\bflexshopper\b|\bprogressive\s+leasing\b|\bacima\s+leasing\b|\brent[\s-]*2[\s-]*own\b/i;

/** Shopping-only merchant/source denylist (unusable for this demo's purchase workflow). */
const BLOCKED_SHOPPING_MERCHANT_RE =
  /\bvision[\s-]*optique\b|\bvisionoptique\b/i;

/** Listing text that the displayed amount is a payment, not an outright price. */
const NON_PURCHASE_OFFER_RE =
  /\brent[\s-]*to[\s-]*own\b|\brent2own\b|\blease[\s-]*to[\s-]*own\b|\blease2own\b|\bweekly\s+payment\b|\bbi-?weekly\s+payment\b|\bmonthly\s+payment\b|\bper\s+week\b|\bper\s+month\b|\/\s*week\b|\/\s*wk\b|\/\s*month\b|\/\s*mo\b|\bas\s+low\s+as\b.{0,24}\b(week|month|wk|mo)\b/i;

/**
 * Shopping-only: drop listings whose source facts show a rental/lease/payment-plan
 * offer rather than an outright purchase price. Does not change Compare & Save.
 */
export function isNonOutrightPurchaseShoppingOffer(row: {
  title: string;
  store?: string;
  storeLabel?: string;
  productUrl?: string;
  outboundUrl?: string;
  rawPriceText?: string | null;
}): boolean {
  const blob = [
    row.store,
    row.storeLabel,
    row.title,
    row.productUrl,
    row.outboundUrl,
    row.rawPriceText,
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ");
  if (!blob.trim()) return false;
  return RTO_MERCHANT_RE.test(blob) || NON_PURCHASE_OFFER_RE.test(blob);
}

function shoppingMerchantBlob(row: {
  title: string;
  store?: string;
  storeLabel?: string;
  productUrl?: string;
  outboundUrl?: string;
}): string {
  return [row.store, row.storeLabel, row.title, row.productUrl, row.outboundUrl]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ");
}

/** Shopping-only: merchant/source is not eligible for this demo's purchase workflow. */
export function isBlockedShoppingMerchant(row: {
  title: string;
  store?: string;
  storeLabel?: string;
  productUrl?: string;
  outboundUrl?: string;
}): boolean {
  return BLOCKED_SHOPPING_MERCHANT_RE.test(shoppingMerchantBlob(row));
}

export function isIneligibleShoppingListing(row: {
  title: string;
  store?: string;
  storeLabel?: string;
  productUrl?: string;
  outboundUrl?: string;
  rawPriceText?: string | null;
}): boolean {
  return isNonOutrightPurchaseShoppingOffer(row) || isBlockedShoppingMerchant(row);
}

export function interpretShoppingRequest(
  raw: string
): InterpretedShoppingRequest {
  const originalRequest = collapseWs(raw);
  let productQuery = originalRequest
    .replace(LEAD_IN, "")
    .replace(/[.?!]+$/g, "")
    .trim();
  productQuery = productQuery.replace(/^(?:a|an|some|the)\s+/i, "").trim();
  if (!productQuery) productQuery = originalRequest;

  const attributes: Record<string, string> = {};
  const blob = `${originalRequest} ${productQuery}`;

  const inch = blob.match(/\b(\d{2,3})\s*(?:-)?\s*(?:inch|in|")\b/i);
  if (inch?.[1]) attributes.screenSizeInches = inch[1];

  if (/\baaa\b/i.test(blob) && /\bbatter/i.test(blob)) {
    attributes.batterySize = "AAA";
  } else if (/\baa\b/i.test(blob) && /\bbatter/i.test(blob)) {
    attributes.batterySize = "AA";
  } else if (/\b9\s*-?\s*v(?:olt)?\b/i.test(blob) && /\bbatter/i.test(blob)) {
    attributes.batterySize = "9V";
  }

  if (/\brechargeable|ni-?mh|nimh\b/i.test(blob)) {
    attributes.rechargeable = "true";
  }
  if (/\balkaline\b/i.test(blob)) attributes.alkaline = "true";
  if (/\bcordless\b/i.test(blob)) attributes.cordless = "true";
  if (/\bdrill\b/i.test(blob)) attributes.toolType = "drill";

  let category: string | null = null;
  let department: CompareFlowDepartment | null = null;

  if (/\bbatter(?:y|ies)\b/i.test(blob)) {
    category = "batteries";
  } else if (/\b(tv|television|monitor)\b/i.test(blob)) {
    category = "televisions";
    department = "electronics";
  } else if (/\b(laptop|headphone|earbud|tablet|speaker)\b/i.test(blob)) {
    category = "electronics";
    department = "electronics";
  } else if (/\b(drill|saw|impact\s+driver|grinder|sander)\b/i.test(blob)) {
    category = "power tools";
    department = "tools";
  } else if (/\bpool\b/i.test(blob)) {
    category = "pools & outdoor";
    department = "pools_outdoor";
  }

  return {
    originalRequest,
    productQuery,
    category,
    department,
    attributes,
  };
}

function isAmazonCandidate(row: CompareApiCandidate): boolean {
  const hay = `${row.store} ${row.storeLabel ?? ""} ${row.productUrl} ${row.outboundUrl}`;
  return row.store === "amazon" || /\bamazon\b/i.test(hay);
}

function listingText(row: CompareApiCandidate): string {
  return collapseWs(
    `${row.title} ${row.normalized?.structured?.title ?? ""} ${row.normalized?.titleNorm ?? ""}`
  );
}

export function detectBatterySizeFromText(text: string): string | null {
  const t = text.toLowerCase();
  if (/\baaa\b/.test(t)) return "AAA";
  if (/\baa\b/.test(t)) return "AA";
  if (/\b9\s*-?\s*v(?:olt)?\b/.test(t) || /\b9v\b/.test(t)) return "9V";
  if (/\bc[\s-]?cell\b/.test(t) || /\bc-size\b/.test(t)) return "C";
  if (/\bd[\s-]?cell\b/.test(t) || /\bd-size\b/.test(t)) return "D";
  return null;
}

export function detectBatteryChemistryFromText(text: string): ShoppingChemistry {
  const t = text.toLowerCase();
  if (
    /\brechargeable\b|\bni-?mh\b|\bnimh\b|\bli-?ion\b|\blithium[\s-]?ion\b/.test(t)
  ) {
    return "rechargeable";
  }
  if (/\balkaline\b/.test(t)) return "alkaline";
  return "unknown";
}

function reliablePackCount(row: CompareApiCandidate): number | null {
  const fromNorm =
    row.normalized?.structured?.packCount ?? row.normalized?.packCount ?? null;
  if (typeof fromNorm === "number" && Number.isFinite(fromNorm) && fromNorm > 0) {
    return fromNorm;
  }
  const fromTitle = extractPackCount(row.title);
  if (typeof fromTitle === "number" && Number.isFinite(fromTitle) && fromTitle > 0) {
    return fromTitle;
  }
  return null;
}

function pricePerUnit(price: number | null, packCount: number | null): number | null {
  if (price == null || !Number.isFinite(price) || price < 0) return null;
  if (packCount == null || packCount <= 0) return null;
  return price / packCount;
}

function packClassForBatteries(packCount: number | null): ShoppingPackClass {
  if (packCount == null) return "unknown";
  if (packCount >= HOUSEHOLD_BATTERY_PACK_MIN && packCount <= HOUSEHOLD_BATTERY_PACK_MAX) {
    return "household";
  }
  if (packCount > HOUSEHOLD_BATTERY_PACK_MAX) return "bulk";
  return "small";
}

function compatibilityForRequest(
  interpreted: InterpretedShoppingRequest,
  row: CompareApiCandidate
): ShoppingCompatibility {
  const wantedScreen = Number.parseInt(
    interpreted.attributes.screenSizeInches ?? "",
    10
  );
  if (interpreted.category === "televisions" && Number.isFinite(wantedScreen)) {
    const inches = listingScreenInches(
      row.title,
      row.normalized?.sizeInches ?? row.normalized?.structured?.sizeInches
    );
    return tvScreenSizeCompatibility(wantedScreen, inches);
  }
  const wanted = interpreted.attributes.batterySize;
  if (!wanted) return "unknown";
  const label = row.normalized?.structured?.sizeLabel?.trim() ?? "";
  const detected =
    detectBatterySizeFromText(label) ?? detectBatterySizeFromText(listingText(row));
  if (!detected) return "unknown";
  return detected === wanted ? "match" : "mismatch";
}

function chemistryFitsRequest(
  interpreted: InterpretedShoppingRequest,
  chemistry: ShoppingChemistry
): boolean {
  const wantsRechargeable = interpreted.attributes.rechargeable === "true";
  if (wantsRechargeable) {
    return chemistry === "rechargeable" || chemistry === "unknown";
  }
  return chemistry !== "rechargeable";
}

function specificationMap(
  row: CompareApiCandidate,
  packCount: number | null,
  priceEach: number | null,
  chemistry: ShoppingChemistry,
  compatibility: ShoppingCompatibility
): Record<string, string> {
  const structured = row.normalized?.structured;
  const normalized = row.normalized;
  const out: Record<string, string> = {};
  const brand = structured?.brand ?? normalized?.brand;
  if (brand) out.brand = brand;
  const inches = structured?.sizeInches ?? normalized?.sizeInches;
  if (inches != null) out.screenSizeInches = String(inches);
  if (structured?.fullModel) out.model = structured.fullModel;
  else if (structured?.modelFamily) out.modelFamily = structured.modelFamily;
  if (structured?.displayType) out.displayType = structured.displayType;
  if (structured?.resolution) out.resolution = structured.resolution;
  if (structured?.smartTvPlatform) out.smartTvPlatform = structured.smartTvPlatform;
  if (structured?.toolVoltage) out.voltage = structured.toolVoltage;
  if (structured?.toolBatteryKit != null) {
    out.batteryKit = structured.toolBatteryKit ? "kit" : "tool only";
  }
  if (packCount != null) out.packCount = String(packCount);
  if (priceEach != null) out.pricePerUnit = priceEach.toFixed(4);
  if (chemistry !== "unknown") out.chemistry = chemistry;
  if (compatibility !== "unknown") out.sizeCompatibility = compatibility;
  if (structured?.sizeLabel) out.size = structured.sizeLabel;
  if (structured?.color) out.color = structured.color;
  const screenInches = listingScreenInches(
    row.title,
    normalized?.sizeInches ?? structured?.sizeInches
  );
  if (screenInches != null) out.screenSizeInches = String(screenInches);
  return out;
}

function dataNotes(args: {
  price: number | null;
  rating: number | null;
  imageUrl: string | null;
  packCount: number | null;
  priceEach: number | null;
}): string[] {
  return [
    args.price == null
      ? "Price: unavailable"
      : `Price: available ($${args.price.toFixed(2)})`,
    args.packCount == null
      ? "Pack count: unavailable"
      : `Pack count: available (${args.packCount})`,
    args.priceEach == null
      ? "Price per unit: unavailable"
      : `Price per unit: derived ($${args.priceEach.toFixed(2)})`,
    args.rating == null
      ? "Rating: unavailable"
      : `Rating: available (${args.rating})`,
    args.imageUrl ? "Image: available" : "Image: unavailable",
  ];
}

function toOption(
  row: CompareApiCandidate,
  interpreted: InterpretedShoppingRequest
): ShoppingAssistantOption {
  const packCount = reliablePackCount(row);
  const priceEach = pricePerUnit(row.price, packCount);
  const chemistry = detectBatteryChemistryFromText(listingText(row));
  const compatibility = compatibilityForRequest(interpreted, row);
  const batteryRequest = interpreted.category === "batteries";
  return {
    title: row.title,
    retailer: row.storeLabel?.trim() || row.store,
    storeId: row.store,
    price: row.price,
    currency: row.currency || "USD",
    rating: row.rating ?? null,
    imageUrl: row.imageUrl,
    productUrl: row.outboundUrl || row.productUrl,
    specifications: specificationMap(
      row,
      packCount,
      priceEach,
      chemistry,
      compatibility
    ),
    packCount,
    pricePerUnit: priceEach,
    compatibility,
    chemistry,
    packClass: batteryRequest ? packClassForBatteries(packCount) : "unknown",
    matchType: row.matchType,
    identityScore: row.identityScore,
    relevanceScore: row.relevanceScore,
    matchReasons: (row.matchReasons ?? row.identityReasons ?? []).filter(
      (reason) => reason.trim().length > 0
    ),
    amazonListing: isAmazonCandidate(row),
    dataNotes: dataNotes({
      price: row.price,
      rating: row.rating ?? null,
      imageUrl: row.imageUrl,
      packCount,
      priceEach,
    }),
  };
}

function uniqueCandidates(
  result: CompareProductResponse
): CompareApiCandidate[] {
  const rows = [...result.candidates, ...(result.similarButNotCheaper ?? [])];
  const seen = new Set<string>();
  const out: CompareApiCandidate[] = [];
  for (const row of rows) {
    const key = (row.productUrl || row.title).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function compatibilityRank(value: ShoppingCompatibility): number {
  if (value === "match") return 2;
  if (value === "unknown") return 1;
  return 0;
}

function packClassRank(value: ShoppingPackClass): number {
  if (value === "household") return 3;
  if (value === "bulk") return 2;
  if (value === "unknown") return 1;
  return 0;
}

function chemistryRank(
  interpreted: InterpretedShoppingRequest,
  chemistry: ShoppingChemistry
): number {
  return chemistryFitsRequest(interpreted, chemistry) ? 1 : 0;
}

function listingValue(
  interpreted: InterpretedShoppingRequest,
  option: ShoppingAssistantOption
): number | null {
  if (
    interpreted.category === "batteries" &&
    option.pricePerUnit != null &&
    Number.isFinite(option.pricePerUnit)
  ) {
    return option.pricePerUnit;
  }
  if (option.price != null && Number.isFinite(option.price) && option.price >= 0) {
    return option.price;
  }
  if (option.pricePerUnit != null && Number.isFinite(option.pricePerUnit)) {
    return option.pricePerUnit;
  }
  return null;
}

function amazonValueAcceptable(
  interpreted: InterpretedShoppingRequest,
  amazon: ShoppingAssistantOption,
  group: ShoppingAssistantOption[]
): boolean {
  const values = group
    .map((row) => listingValue(interpreted, row))
    .filter((n): n is number => n != null && Number.isFinite(n));
  const amazonVal = listingValue(interpreted, amazon);
  if (amazonVal == null || values.length === 0) return true;
  const best = Math.min(...values);
  return amazonVal <= best * AMAZON_VALUE_SLACK;
}

function sortShoppingPool(
  interpreted: InterpretedShoppingRequest,
  pool: ShoppingAssistantOption[]
): ShoppingAssistantOption[] {
  if (pool.length === 0) return [];
  const ranked = [...pool].sort((a, b) => {
    const c = compatibilityRank(b.compatibility) - compatibilityRank(a.compatibility);
    if (c !== 0) return c;
    const chem =
      chemistryRank(interpreted, b.chemistry) - chemistryRank(interpreted, a.chemistry);
    if (chem !== 0) return chem;
    if (interpreted.category === "batteries") {
      const pack = packClassRank(b.packClass) - packClassRank(a.packClass);
      if (pack !== 0) return pack;
    }
    const aVal = listingValue(interpreted, a);
    const bVal = listingValue(interpreted, b);
    if (aVal != null && bVal != null && aVal !== bVal) return aVal - bVal;
    const aRating = a.rating;
    const bRating = b.rating;
    if (aRating != null && bRating != null && aRating !== bRating) {
      return bRating - aRating;
    }
    return b.relevanceScore - a.relevanceScore;
  });

  const lead = ranked[0]!;
  const comparable = ranked.filter((row) => {
    if (compatibilityRank(row.compatibility) !== compatibilityRank(lead.compatibility)) {
      return false;
    }
    if (
      chemistryRank(interpreted, row.chemistry) !==
      chemistryRank(interpreted, lead.chemistry)
    ) {
      return false;
    }
    if (
      interpreted.category === "batteries" &&
      packClassRank(row.packClass) !== packClassRank(lead.packClass)
    ) {
      return false;
    }
    return true;
  });
  const amazonPick = comparable.find((row) => row.amazonListing);
  if (amazonPick && amazonValueAcceptable(interpreted, amazonPick, comparable)) {
    return [amazonPick, ...ranked.filter((row) => row !== amazonPick)];
  }
  return ranked;
}

/**
 * Shopping Assistant ranking only. Does not mutate Compare & Save candidate order.
 * For TVs: confirmed sizes are ranked first; unknown sizes may follow for display
 * but never become the recommendation while a confirmed match exists.
 */
export function rankShoppingAssistantOptions(
  interpreted: InterpretedShoppingRequest,
  options: ShoppingAssistantOption[]
): ShoppingAssistantOption[] {
  if (options.length === 0) return [];

  const eligible = options.filter((row) => row.compatibility !== "mismatch");
  if (interpreted.category === "televisions") {
    const confirmed = eligible.filter((row) => row.compatibility === "match");
    const unknown = eligible.filter((row) => row.compatibility === "unknown");
    if (confirmed.length > 0) {
      return [
        ...sortShoppingPool(interpreted, confirmed).slice(0, 8),
        ...sortShoppingPool(interpreted, unknown).slice(0, 8),
      ];
    }
    return sortShoppingPool(interpreted, unknown).slice(0, 8);
  }
  return sortShoppingPool(interpreted, eligible).slice(0, 8);
}

function buildExplanation(
  option: ShoppingAssistantOption,
  interpreted: InterpretedShoppingRequest,
  amazonPreferred: boolean,
  confirmedPeerCount: number
): { explanation: string; factualReasons: string[] } {
  const factualReasons: string[] = [];
  const screen = interpreted.attributes.screenSizeInches;
  if (interpreted.category === "televisions" && screen) {
    if (option.compatibility === "match") {
      factualReasons.push(`Matches the requested ${screen}-inch screen size.`);
      if (/\b4k\b|\buhd\b|\bultra\s*hd\b/i.test(option.title)) {
        factualReasons.push("Title states 4K/UHD (from source listing text).");
      }
      if (option.price != null && confirmedPeerCount > 1) {
        factualReasons.push(
          "Among confirmed size matches, ranking used the lower source listing price because no premium brand or feature was requested."
        );
      }
    } else if (option.compatibility === "unknown") {
      factualReasons.push(
        `Screen size was not stated in source data; recommendation is a fallback because no confirmed ${screen}-inch listing was available.`
      );
    }
  }
  const size = interpreted.attributes.batterySize;
  if (size && option.compatibility === "match") {
    factualReasons.push(`Matches the requested ${size} battery size.`);
  } else if (size && option.compatibility === "mismatch") {
    factualReasons.push(
      `Does not match the requested ${size} battery size (from listing title).`
    );
  } else if (size && interpreted.category === "batteries") {
    factualReasons.push(
      `Requested ${size} batteries; listing size was not stated in source data.`
    );
  }
  if (option.packCount != null) {
    factualReasons.push(`Pack includes ${option.packCount} units (from listing data).`);
  } else {
    factualReasons.push("Pack count unavailable from source data.");
  }
  if (option.pricePerUnit != null) {
    factualReasons.push(
      `About ${option.currency === "USD" ? "$" : ""}${option.pricePerUnit.toFixed(2)} each (derived from price ÷ pack count).`
    );
  }
  if (option.packClass === "household") {
    factualReasons.push(
      "Household multipack (8+ units), preferred over tiny 2-count packs for this shopping demo."
    );
  } else if (option.packClass === "bulk" && option.packCount != null) {
    factualReasons.push(
      `Bulk ${option.packCount}-count pack; typical household multipacks are preferred when available.`
    );
  } else if (option.packClass === "small" && option.packCount != null) {
    factualReasons.push(
      `Small ${option.packCount}-count pack; household multipacks are preferred when available.`
    );
  }
  if (option.chemistry === "rechargeable") {
    factualReasons.push("Listing is described as rechargeable in the title.");
  } else if (option.chemistry === "alkaline") {
    factualReasons.push("Listing is described as alkaline in the title.");
  }
  if (option.price != null) {
    factualReasons.push(
      `Listed price ${option.currency === "USD" ? "$" : ""}${option.price.toFixed(2)} from the shopping source.`
    );
  } else {
    factualReasons.push("No purchase price was returned for this listing.");
  }
  factualReasons.push(`Retailer in source data: ${option.retailer}.`);
  if (option.rating != null) {
    factualReasons.push(
      `Source rating ${option.rating} (when provided by the shopping feed).`
    );
  }
  if (option.amazonListing) {
    factualReasons.push(
      "Amazon listing identified from Google Shopping / URL data — not from an Amazon login or scrape."
    );
  }
  if (amazonPreferred && option.amazonListing) {
    factualReasons.push(
      "Amazon was preferred among comparable shopping-assistant candidates when the source actually returned it."
    );
  }
  return { explanation: factualReasons.join(" "), factualReasons };
}

function emptyCompareShell(
  query: string,
  candidates: CompareApiCandidate[],
  message: string | null
): CompareProductResponse {
  return {
    query,
    normalizedQuery: query.toLowerCase(),
    candidates,
    similarButNotCheaper: [],
    resultsByStore: [],
    bestDeal: null,
    showBestDeal: false,
    confidence: candidates.length > 0 ? "medium" : null,
    message,
    sourceProduct: null,
    alternatives: [],
    savings: null,
  };
}

export function buildShoppingAssistantView(
  userRequest: string,
  interpreted: InterpretedShoppingRequest,
  compare: CompareProductResponse
): ShoppingAssistantResult {
  let listings = uniqueCandidates(compare).filter(
    (row) => !isIneligibleShoppingListing(row)
  );
  if (interpreted.category === "televisions") {
    listings = applyShoppingTvNeedFilter(interpreted, listings);
  }
  const mapped = listings.map((row) => toOption(row, interpreted));
  const options = rankShoppingAssistantOptions(interpreted, mapped);
  const confirmedTv = options.filter((row) => row.compatibility === "match");
  const picked =
    interpreted.category === "televisions" && confirmedTv.length > 0
      ? confirmedTv[0]!
      : (options[0] ?? null);
  const amazonPreferred = Boolean(
    picked?.amazonListing &&
      options.some(
        (row) =>
          row.amazonListing &&
          row.compatibility === picked.compatibility &&
          chemistryRank(interpreted, row.chemistry) ===
            chemistryRank(interpreted, picked.chemistry) &&
          (interpreted.category !== "batteries" || row.packClass === picked.packClass)
      )
  );

  let recommendation: ShoppingAssistantRecommendation | null = null;
  if (picked) {
    const { explanation, factualReasons } = buildExplanation(
      picked,
      interpreted,
      amazonPreferred,
      interpreted.category === "televisions" ? confirmedTv.length : 0
    );
    recommendation = {
      title: picked.title,
      retailer: picked.retailer,
      productUrl: picked.productUrl,
      amazonListing: picked.amazonListing,
      explanation,
      factualReasons,
    };
  }

  return {
    userRequest,
    interpreted,
    options,
    recommendation,
    engineMessage: compare.message ?? compare.comparisonMessage ?? null,
    amazonPreferred,
    limitations: [
      "This is a commercial demo, not the production SMS product.",
      "Listings come from the existing Google Shopping discovery path. Amazon is highlighted only when that source returns it.",
      "Prices, pack counts, ratings, and specs are shown only when present in source data. Price per unit is derived only when both price and pack count exist.",
      "No Prime status, delivery dates, or live Amazon availability are claimed.",
      "Shopping Assistant ranking is independent of Compare & Save identity/savings ranking.",
    ],
  };
}

export async function runShoppingAssistant(
  rawRequest: string
): Promise<ShoppingAssistantResult> {
  const interpreted = interpretShoppingRequest(rawRequest);
  if (!interpreted.productQuery || interpreted.productQuery.length < 2) {
    throw new Error("Describe the product you need.");
  }

  if (interpreted.category === "televisions") {
    const inches = interpreted.attributes.screenSizeInches;
    const queries = [
      interpreted.productQuery,
      inches ? `${inches} inch television` : "television",
    ];
    const discovered = await fetchGoogleShoppingCandidatesWithDiagnostics(
      queries,
      {
        rawInput: rawRequest,
        searchQuery: interpreted.productQuery,
        productQuery: interpreted.productQuery,
      },
      { perQueryLimit: 36, totalLimit: 48 }
    );
    const priced = discovered.candidates.filter(
      (row) => row.price != null && Number.isFinite(row.price)
    );
    const rows = applyShoppingTvNeedFilter(
      interpreted,
      priced.map(shoppingListingToCompareRow)
    );
    const compare = emptyCompareShell(
      interpreted.productQuery,
      rows,
      rows.length > 0
        ? null
        : "No search results with prices yet. Try a different product description."
    );
    return buildShoppingAssistantView(rawRequest.trim(), interpreted, compare);
  }

  const compare = await compareProduct(interpreted.productQuery, {
    shoppingAssistant: true,
    department: interpreted.department,
  });

  return buildShoppingAssistantView(rawRequest.trim(), interpreted, compare);
}

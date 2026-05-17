/**
 * Shared types for the product comparison pipeline:
 * source → normalized source → provider search → candidate normalization → match scoring → API result.
 */

/**
 * Registered retailers we can validate as PDP links and surface in compare results.
 * (Search is unified via Google Shopping; per-store HTML SERP is legacy.)
 */
export type StoreId =
  | "amazon"
  | "walmart"
  | "target"
  | "temu"
  | "bestbuy"
  | "homedepot"
  | "lowes";

export type ProductCategory =
  | "tv"
  | "monitor"
  | "footwear"
  | "audio"
  | "socks"
  | "apparel"
  | "household"
  | "general";

/** High-level bucket for comparison rules (tv vs monitor vs apparel vs everything else). */
export type ComparisonCategory = "tv" | "monitor" | "apparel" | "generic";

/** Unified condition across categories (title-derived). */
export type ProductCondition =
  | "new"
  | "renewed"
  | "refurbished"
  | "used"
  | "open_box"
  | "unknown";

/**
 * Structured attributes extracted from titles (and listing fields when present).
 * Used for hard gates and attribute scoring — not fuzzy title matching alone.
 */
export type StructuredProduct = {
  title: string;
  brand: string | null;
  category: ProductCategory;
  price: number | null;
  currency: string | null;
  productUrl: string | null;
  condition: ProductCondition;
  sizeInches: number | null;
  /** Core series / line (e.g. M70HB, DU7200) */
  modelFamily: string | null;
  /** Retail SKU when parseable (e.g. UN85M70HBFXZA) */
  fullModel: string | null;
  displayType: TvDisplayTechBucket;
  resolution: TvResolutionBucket;
  smartTv: boolean | null;
  gender: string | null;
  packCount: number | null;
  sizeLabel: string | null;
  color: string | null;
};

/** User-facing match level for MVP comparisons. */
export type MatchConfidenceLabel = "exact" | "equivalent" | "alternative";

/**
 * Match bucket for comparison API rows.
 * - `high`: strong attribute + query alignment (blended score ≥ exact tier)
 * - `similar_product`: passed gates with medium blended score (cross-retailer naming variance)
 * - `medium` / `low`: keyword-only tiers inside `scoreQueryRelevance` (internal / legacy)
 */
export type SearchMatchType =
  | "high"
  | "medium"
  | "low"
  | "similar_product";

/** Buckets for display-type strict matching (TVs). */
export type TvDisplayTechBucket =
  | "mini_led"
  | "crystal_led"
  | "oled"
  | "qled"
  | "neo_qled"
  | "led"
  | null;

export type TvResolutionBucket = "4k" | "8k" | "hd" | null;

/** @deprecated use ProductCondition */
export type TvConditionKind = ProductCondition;

/** Parsed TV-only fields — set when `category === "tv"`. */
export type TvNormalizedAttributes = {
  displayTech: TvDisplayTechBucket;
  resolution: TvResolutionBucket;
  /** null when not stated */
  smartTv: boolean | null;
  condition: TvConditionKind;
  /** Distinctive model / family strings (series + SKU fragments) for strict gates */
  modelFamilyTokens: string[];
};

/** Hard-filter tokens derived from user text (dimensions, product kind, bundled accessories). */
export type CriticalListingAttributes = {
  /** Normalized substrings expected in comparable titles (e.g. `18x51`, `55inch`). */
  dimensionSignatures: string[];
  /** Short phrases pinning the product kind (e.g. `smart tv`, `above ground pool`). */
  kindPhrases: string[];
  /** Stem words that must appear when the user required an accessory (e.g. `pump`). */
  accessoryMustInclude: string[];
};

export type NormalizedProduct = {
  /** Canonical structured snapshot (gates + scoring use this). */
  structured: StructuredProduct;
  /** Lowercased, punctuation-stripped title for display/debug */
  titleNorm: string;
  brand: string | null;
  modelTokens: string[];
  /** Screen diagonal in inches when detectable (TV / monitor) */
  sizeInches: number | null;
  category: ProductCategory;
  /** `null` when not confidently extractable */
  packCount: number | null;
  /** men | women | kids | unisex when detectable */
  gender: string | null;
  /** Strict TV matching signals — only when classified as a television */
  tv?: TvNormalizedAttributes;
  /**
   * Optional strict-comparison profile (Pilar 1). When present, candidates must satisfy
   * these token constraints in addition to category gates.
   */
  critical?: CriticalListingAttributes;
};

export type SourceProduct = {
  sourceUrl?: string;
  store: StoreId | "unknown";
  title: string;
  originalPrice: number | null;
  currency: string;
  normalized: NormalizedProduct;
};

/**
 * One listing row from a retailer, already mapped into our normalized shape.
 */
export type CandidateProduct = {
  store: StoreId;
  title: string;
  price: number | null;
  currency: string;
  productUrl: string;
  affiliateUrl: string;
  /** Product image when the SERP parser exposes one */
  imageUrl: string | null;
  normalized: NormalizedProduct;
  sourceConfidence: number;
};

/** @deprecated Prefer MatchConfidenceLabel — kept for internal scoring migration */
export type MatchTier = MatchConfidenceLabel | "none";

export type ScoredCandidate = {
  candidate: CandidateProduct;
  score: number;
  tier: MatchConfidenceLabel | "none";
  /** Human-readable match factors */
  reasons: string[];
  /** Hard rejection — must not be selected as best deal */
  rejected: boolean;
  rejectionDetail: string | null;
};

export type ProviderSearchContext = {
  rawInput: string;
  /** Compact query sent to retailer search */
  searchQuery: string;
  /** Full product description (query-derived, not a scraped PDP) */
  productQuery: string;
};

/** One provider’s search outcome — candidates plus fetch/parse diagnostics. */
export type ProviderSearchDiagnostics = {
  /** Retailer id, or `google_shopping` for the unified Serper/SerpAPI pipeline. */
  store: StoreId | "google_shopping";
  query: string;
  fetchOk: boolean;
  httpStatus: number | null;
  byteLength: number;
  candidateCount: number;
  hints: string[];
};

export type ProviderResult = {
  candidates: CandidateProduct[];
  diagnostics: ProviderSearchDiagnostics;
};

export type ProductProvider = {
  id: StoreId;
  canHandleProductUrl(url: string): boolean;
  extractSourceProduct(url: string): Promise<SourceProduct | null>;
  searchCandidates(ctx: ProviderSearchContext): Promise<ProviderResult>;
  toAffiliateUrl(productUrl: string): string;
};

import type { ManualProductFormFields } from "./manualProductInput";

export type CompareProductOptions = {
  /** When true, attaches `comparisonTrace` and enables verbose console logs */
  debug?: boolean;
  /**
   * When set without `link`, builds universal search queries from structured fields.
   * When `link` is set, callers should run the URL flow instead (`compareProduct(url)`).
   */
  manualProduct?: ManualProductFormFields | null;
};

export type CandidateStepTrace = {
  key: string;
  store: string;
  title: string;
  price: number | null;
  productUrl: string;
  outcome:
    | "evaluated"
    | "rejected_hard_gate"
    | "skipped_duplicate_source_url"
    | "skipped_same_source_item"
    | "invalid_product_url";
  matchConfidence?: MatchConfidenceLabel | "none";
  matchScore?: number;
  matchReasons?: string[];
  eligibleForComparable?: boolean;
  /** Present when outcome is rejected_hard_gate or filtered by minimum relevance */
  rejectionReason?: string | null;
  detail: string;
};

export type SelectionTrace = {
  trustworthyCount: number;
  pickedStore: string | null;
  reasonNoDeal: string | null;
  /** When the pick is only an alternative-tier match */
  pickedAsClosestSimilar?: boolean;
};

export type ComparisonTrace = {
  inputRaw: string;
  detectedStore: string | null;
  searchQueryUsed: string;
  demoMode: boolean;
  sourceSummary: null | {
    title: string;
    store: string;
    originalPrice: number | null;
    sourceUrl?: string;
  };
  providerQueries: { store: string; query: string }[];
  candidatesPerProvider: { store: string; count: number }[];
  providerDiagnostics: ProviderSearchDiagnostics[];
  candidateSteps: CandidateStepTrace[];
  selection: SelectionTrace;
};

/**
 * Simulated or partner-sourced coupon row — replace `source: "simulated"` with API-backed
 * payloads when coupon network keys are configured.
 */
export type PremiumCouponOffer = {
  id: string;
  headline: string;
  detail: string;
  code: string | null;
  /** ISO 8601 end date, or null when unspecified */
  validThrough: string | null;
  source: "simulated" | "partner_api";
};

export type CompareConfidence = "high" | "medium" | "low";

export type CompareProductDeal = {
  store: string;
  title: string;
  price: number | null;
  currency: string;
  productUrl: string;
  affiliateUrl: string;
  imageUrl: string | null;
  /** 0–1 combined attribute + query relevance */
  confidence: number;
  /** Qualitative tier (UI / API); pairs with numeric `confidence` */
  matchConfidenceLabel: CompareConfidence;
  matchType: SearchMatchType;
  /** 0–100 attribute-heavy match score */
  relevanceScore: number;
  relevanceReason: string;
  score?: number;
  premiumCoupons?: PremiumCouponOffer[];
};

/** Search-first API candidate (shared shape across stores). */
export type CompareApiCandidate = {
  store: string;
  title: string;
  price: number | null;
  currency: string;
  productUrl: string;
  affiliateUrl: string;
  imageUrl: string | null;
  normalized: NormalizedProduct;
  /** 0–1 combined attribute + query relevance */
  confidence: number;
  /** Qualitative tier (UI / API); pairs with numeric `confidence` */
  matchConfidenceLabel: CompareConfidence;
  matchType: SearchMatchType;
  /** 0–100 attribute-heavy match score */
  relevanceScore: number;
  relevanceReason: string;
  /** Optional duplicate of relevanceScore for API clarity (attribute match strength) */
  score?: number;
  /** Premium: active-style coupons for this retailer/category (simulated until partner APIs) */
  premiumCoupons?: PremiumCouponOffer[];
};

/** API payload — dashboard reads `bestDeal`, `candidates`, `comparisonMessage`. */
export type CompareProductResponse = {
  /** Original product query (text or URL-derived) */
  query: string;
  /** Normalized multi-field search string sent to stores */
  normalizedQuery: string;
  /** All candidates (search relevance scored), sorted by match strength then price */
  candidates: CompareApiCandidate[];
  /** Same listings grouped by retailer */
  resultsByStore: { store: StoreId; candidates: CompareApiCandidate[] }[];
  bestDeal: CompareProductDeal | null;
  /** True only when ≥2 high-confidence matches exist and a cheapest pick is highlighted */
  showBestDeal: boolean;
  /** Overall certainty of the highlighted best deal when present */
  confidence: CompareConfidence | null;
  /** User-facing summary when ambiguous or empty */
  message: string | null;
  /**
   * True when a pasted store PDP URL was scraped but the listing title looked like a bot wall
   * or unusable snippet — callers may prompt for a manual product name.
   */
  scrapeBotWalled?: boolean;
  sourceProduct: {
    sourceUrl?: string;
    store: string;
    title: string;
    originalPrice: number | null;
    currency: string;
    normalizedTitle: string;
  } | null;
  /** Other high-confidence listings when `showBestDeal` (excluding the chosen row) */
  alternatives: CompareProductDeal[];
  /** Spread among high-tier priced listings when best deal is shown (max − min price) */
  savings: number | null;
  /** e.g. "Closest matches found" when no best-deal banner */
  comparisonMessage?: string | null;
  /** @deprecated retained for trace compatibility only */
  closestSimilarDealOnly?: boolean;
  /** @deprecated retained for trace compatibility only */
  rejectionReasons?: string[];
  comparisonTrace?: ComparisonTrace;
};

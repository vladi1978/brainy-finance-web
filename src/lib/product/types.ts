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
  | "lowes"
  | "costco"
  | "samsclub"
  | "ebay"
  | "macys"
  | "kohls"
  | "wayfair"
  | "overstock"
  | "chewy"
  | "academy"
  | "tractorsupply"
  | "nike"
  | "adidas";

/**
 * Shopping pipeline id: known retailers plus `other` for merchants outside the PDP/affiliate set.
 * Use {@link CandidateProduct.sourceLabel} / API `storeLabel` for the real SERP retailer name.
 */
export type UniversalStoreId = StoreId | "other";

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
 * Universal product identity tier (post-search scoring).
 * Drives UI copy: Best Deal / Similar Product / Alternative Option.
 */
export type ProductIdentityMatchType = "exact_match" | "close_match" | "alternative";

/**
 * Attribute / keyword tiers from structured + query relevance (internal).
 * API `matchType` uses {@link ProductIdentityMatchType} after identity scoring.
 */
export type SearchMatchType =
  | "high"
  /** Tier 2 — compatible specs / intended use; may differ by retailer naming */
  | "equivalent"
  | "medium"
  | "low"
  /** Tier 3 — weak similar; suppressed when stronger tiers exist */
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

/**
 * Structured crumbs from PDP HTML (JSON-LD / meta), richer than title parsing alone.
 * Populated when `scrapeProduct` succeeds during URL extraction.
 */
export type SourceScrapedHints = {
  categoryTrail: string | null;
  retailerSku: string | null;
  modelOrMpn: string | null;
  brand: string | null;
};

export type SourceProduct = {
  sourceUrl?: string;
  store: StoreId | "unknown";
  title: string;
  originalPrice: number | null;
  currency: string;
  normalized: NormalizedProduct;
  scrapedHints?: SourceScrapedHints | null;
};

/**
 * One listing row from a retailer, already mapped into our normalized shape.
 */
export type CandidateProduct = {
  store: UniversalStoreId;
  title: string;
  price: number | null;
  currency: string;
  productUrl: string;
  affiliateUrl: string;
  /** Product image when the SERP parser exposes one */
  imageUrl: string | null;
  normalized: NormalizedProduct;
  sourceConfidence: number;
  /** Google Shopping / Serp row id when present — diagnostics and future affiliate wiring */
  productId?: string;
  /** Merchant/source label from the shopping row when present */
  sourceLabel?: string;
  /** Shopping API query that produced this row (dedupe / diagnostics) */
  shoppingQueryUsed?: string;
  /** Listing star rating when the provider exposes it */
  rating?: number | null;
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
  /**
   * Merchant / SERP source label when present (preferred over {@link store} for display name).
   */
  storeLabel?: string;
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
  /** Universal identity tier — only `exact_match` may be labeled “Best Deal”. */
  matchType: ProductIdentityMatchType;
  /** Structured + keyword tier from attribute matcher (diagnostics). */
  attributeMatchType?: SearchMatchType;
  /** 0–100 universal product identity score */
  identityScore: number;
  identityReasons: string[];
  missingCriticalAttributes: string[];
  /** 0–100 attribute-heavy match score */
  relevanceScore: number;
  relevanceReason: string;
  score?: number;
  premiumCoupons?: PremiumCouponOffer[];
  savingsVsReference?: number | null;
  priceCompareSegment?: "cheaper" | "not_cheaper" | "unknown";
  outboundIsStoreSearch?: boolean;
  /** Raw merchant PDP when {@link urlType} is `"product"` (canonical listing URL). */
  resolvedProductUrl?: string;
  /** Prefer this for outbound navigation (normally affiliate-wrapped). */
  outboundUrl: string;
  urlType: "product" | "search" | "unknown";
  urlConfidence: "high" | "medium" | "low";
  urlResolutionReason?: string;
};

/** Search-first API candidate (shared shape across stores). */
export type CompareApiCandidate = {
  store: string;
  /**
   * Human-readable retailer name from Google Shopping (or normalized fallback). Prefer for UI copy.
   */
  storeLabel?: string;
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
  /** Universal identity tier — only `exact_match` may be labeled “Best Deal”. */
  matchType: ProductIdentityMatchType;
  /** Structured + keyword tier from attribute matcher (diagnostics). */
  attributeMatchType?: SearchMatchType;
  /** 0–100 universal product identity score */
  identityScore: number;
  identityReasons: string[];
  missingCriticalAttributes: string[];
  /** 0–100 attribute-heavy match score */
  relevanceScore: number;
  relevanceReason: string;
  /** Optional duplicate of relevanceScore for API clarity (attribute match strength) */
  score?: number;
  /** Premium: active-style coupons for this retailer/category (simulated until partner APIs) */
  premiumCoupons?: PremiumCouponOffer[];
  /**
   * When the source listing had a comparable price: USD saved vs that reference
   * (only set for `priceCompareSegment === "cheaper"`).
   */
  savingsVsReference?: number | null;
  /** Grouping for cheaper-first UI when a reference price exists */
  priceCompareSegment?: "cheaper" | "not_cheaper" | "unknown";
  /**
   * Outbound button opens a store search for the listing title (not a verified PDP).
   * Kept explicit so the UI does not imply a direct product page.
   */
  outboundIsStoreSearch?: boolean;
  /** Raw merchant PDP when {@link urlType} is `"product"`. */
  resolvedProductUrl?: string;
  /** Prefer this for outbound navigation (normally affiliate-wrapped). */
  outboundUrl: string;
  urlType: "product" | "search" | "unknown";
  urlConfidence: "high" | "medium" | "low";
  urlResolutionReason?: string;
};

/** API payload — dashboard reads `bestDeal`, `candidates`, `comparisonMessage`. */
export type CompareProductResponse = {
  /** Original product query (text or URL-derived) */
  query: string;
  /** Normalized multi-field search string sent to stores */
  normalizedQuery: string;
  /** All candidates (match-scored), ordered for display — up to ~14 rows; cheaper-than-reference only when a reference price exists */
  candidates: CompareApiCandidate[];
  /** Same listings grouped by retailer */
  resultsByStore: { store: string; candidates: CompareApiCandidate[] }[];
  bestDeal: CompareProductDeal | null;
  /** True when a primary pick (`bestDeal`) is highlighted among returned candidates */
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
  /** Maximum savings vs reference price among cheaper alternatives (when reference price exists) */
  savings: number | null;
  /** e.g. "Closest matches found" when no best-deal banner */
  comparisonMessage?: string | null;
  /** AI summary: immutable specs vs flexible brand/model for savings-focused matching */
  aiProductSummary?: string | null;
  /** @deprecated retained for trace compatibility only */
  closestSimilarDealOnly?: boolean;
  /** @deprecated retained for trace compatibility only */
  rejectionReasons?: string[];
  comparisonTrace?: ComparisonTrace;
};

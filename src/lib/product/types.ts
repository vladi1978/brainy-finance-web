/**
 * Shared types for the product comparison pipeline:
 * source → normalized source → provider search → candidate normalization → match scoring → API result.
 */

/** Registered retailers — extend as you add provider modules. */
export type StoreId = "amazon" | "walmart" | "target" | "temu";

export type ProductCategory =
  | "tv"
  | "footwear"
  | "audio"
  | "socks"
  | "apparel"
  | "household"
  | "general";

/** User-facing match level for MVP comparisons. */
export type MatchConfidenceLabel = "exact" | "equivalent" | "alternative";

export type NormalizedProduct = {
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
  store: StoreId;
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

export type CompareProductOptions = {
  /** When true, attaches `comparisonTrace` and enables verbose console logs */
  debug?: boolean;
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
    | "skipped_same_source_item";
  matchConfidence?: MatchConfidenceLabel | "none";
  matchScore?: number;
  matchReasons?: string[];
  eligibleForComparable?: boolean;
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

export type CompareProductDeal = {
  store: string;
  title: string;
  price: number | null;
  currency: string;
  productUrl: string;
  affiliateUrl: string;
  imageUrl: string | null;
  /** 0–100 overall match score */
  matchScore: number;
  /** exact | equivalent | alternative */
  matchConfidence: MatchConfidenceLabel;
  /** Short explanation for the user */
  comparisonReason: string;
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
  matchScore: number;
  matchConfidence: MatchConfidenceLabel | "none";
  includedInBestDealConsideration: boolean;
  rejectReason: string | null;
};

export type CompareConfidence = "high" | "medium" | "low";

/** API payload — dashboard reads `bestDeal`, `sourceProduct`, `comparisonMessage`. */
export type CompareProductResponse = {
  /** Original product query (text or URL-derived) */
  query: string;
  /** Normalized multi-field search string sent to stores */
  normalizedQuery: string;
  /** All candidates considered (with scores / reject reasons) */
  candidates: CompareApiCandidate[];
  bestDeal: CompareProductDeal | null;
  /** Overall certainty of a single best pick */
  confidence: CompareConfidence | null;
  /** User-facing summary when ambiguous or empty */
  message: string | null;
  sourceProduct: {
    sourceUrl?: string;
    store: string;
    title: string;
    originalPrice: number | null;
    currency: string;
    normalizedTitle: string;
  } | null;
  alternatives: CompareProductDeal[];
  /** Benchmark vs best among comparables when no PDP price exists */
  savings: number | null;
  comparisonMessage?: string | null;
  /** When true, UI may label the result as “Closest Similar Deal” */
  closestSimilarDealOnly?: boolean;
  /** Top reasons the pipeline could not rank higher-confidence matches (debug) */
  rejectionReasons?: string[];
  comparisonTrace?: ComparisonTrace;
};

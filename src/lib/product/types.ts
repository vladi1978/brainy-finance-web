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
  /** Short query derived from normalized source */
  searchQuery: string;
  sourceProduct: SourceProduct | null;
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
    | "skipped_duplicate_source_url";
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
  /** 0–100 overall match score */
  matchScore: number;
  /** exact | equivalent | alternative */
  matchConfidence: MatchConfidenceLabel;
  /** Short explanation for the user */
  comparisonReason: string;
};

/** API payload — dashboard reads `bestDeal`, `sourceProduct`, `comparisonMessage`. */
export type CompareProductResponse = {
  sourceProduct: {
    sourceUrl?: string;
    store: string;
    title: string;
    originalPrice: number | null;
    currency: string;
    normalizedTitle: string;
  } | null;
  bestDeal: CompareProductDeal | null;
  alternatives: CompareProductDeal[];
  /** `max(0, source originalPrice − best deal price)` when both are valid; otherwise null */
  savings: number | null;
  comparisonMessage?: string | null;
  /** When true, UI may label the result as “Closest Similar Deal” */
  closestSimilarDealOnly?: boolean;
  /** Top reasons the pipeline could not rank higher-confidence matches (debug) */
  rejectionReasons?: string[];
  comparisonTrace?: ComparisonTrace;
};

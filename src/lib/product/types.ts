/**
 * Shared types for the product comparison pipeline:
 * source → normalized source → provider candidates → scored matches → API result.
 */

export type StoreId = "amazon" | "walmart";

export type ProductCategory =
  | "tv"
  | "footwear"
  | "audio"
  | "general";

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

export type MatchTier = "exact" | "strong" | "weak" | "none";

export type ScoredCandidate = {
  candidate: CandidateProduct;
  score: number;
  tier: MatchTier;
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
  outcome: "evaluated" | "rejected_hard_gate" | "skipped_duplicate_source_url";
  matchTier?: MatchTier;
  matchScore?: number;
  matchReasons?: string[];
  eligibleForComparable?: boolean;
  detail: string;
};

export type SelectionTrace = {
  trustworthyCount: number;
  pickedStore: string | null;
  reasonNoDeal: string | null;
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
  candidateSteps: CandidateStepTrace[];
  selection: SelectionTrace;
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
  bestDeal: {
    store: string;
    title: string;
    price: number | null;
    currency: string;
    productUrl: string;
    affiliateUrl: string;
    matchConfidence: number;
    matchType: MatchTier;
  } | null;
  alternatives: {
    store: string;
    title: string;
    price: number | null;
    currency: string;
    productUrl: string;
    affiliateUrl: string;
    matchConfidence: number;
    matchType: MatchTier;
  }[];
  comparisonMessage?: string | null;
  comparisonTrace?: ComparisonTrace;
};

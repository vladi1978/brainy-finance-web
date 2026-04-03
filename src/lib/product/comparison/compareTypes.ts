import type { ExtractedSourceProduct } from "../providers/base";
import type { ProductSearchResult } from "../providers/search-result";
import type { StoreSerpDiagnostics } from "../searchParse";
import type { MatchType } from "./matchTypes";

export type CompareProductResponse = {
  sourceProduct: ExtractedSourceProduct | null;
  bestDeal: ProductSearchResult | null;
  alternatives: ProductSearchResult[];
  /** Present when no comparable cross-store match is available */
  comparisonMessage?: string | null;
  /** Present when `compareProduct(..., { debug: true })` */
  comparisonTrace?: ComparisonTrace;
};

export type ComparisonTrace = {
  inputRaw: string;
  detectedStore: string | null;
  searchQueryUsed: string;
  sourceSummary: null | {
    title: string;
    store: string;
    originalPrice: number | null;
    sourceUrl?: string;
  };
  providerSerp: StoreSerpDiagnostics[];
  /** One entry per raw SERP row we evaluated or dropped early */
  candidateSteps: CandidateStepTrace[];
  selection: SelectionTrace;
};

export type CandidateStepTrace = {
  key: string;
  store: string;
  title: string;
  price: number | null;
  productUrl: string;
  /** Pipeline stage outcome */
  outcome:
    | "dropped_no_price"
    | "dropped_rank_filter"
    | "skipped_duplicate_source_url"
    | "skipped_same_store_as_source"
    | "evaluated"
    | "dedupe_loser";
  matchType?: MatchType;
  matchScore?: number;
  matchReasons?: string[];
  eligibleForBestDeal?: boolean;
  /** Why this row is not the winner (or why dropped) */
  detail: string;
};

export type SelectionTrace = {
  eligibleTier: "exact_or_strong" | "weak_promoted" | "none";
  pickedStore: string | null;
  reasonNoDeal: string | null;
};

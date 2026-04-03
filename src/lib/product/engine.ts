/**
 * Product comparison entry — search-first pipeline in `./compareEngine`.
 * Normalization lives in `./normalize`; legacy structured matching in `./match` is deprecated for API selection.
 */

export { compareProduct, DEMO_MODE, isCompareDemoMode } from "./compareEngine";
export {
  buildNormalizedProduct,
  buildStructuredProduct,
  normalizeTitle,
  toComparisonCategory,
} from "./normalize";
export type { StructuredListingContext } from "./normalize";
export {
  rankMatchTypes,
  scoreQueryRelevance,
} from "./searchRelevance";
export type { QueryRelevanceResult } from "./searchRelevance";
/** @deprecated Exact-match / structured comparison — not used for dashboard selection anymore. */
export {
  evaluateCandidate,
  MIN_COMPARABLE_SCORE_OTHER,
  MIN_COMPARABLE_SCORE_TV,
  runHardGates,
  scoreTvStructured,
} from "./match";
export type {
  CompareApiCandidate,
  CompareConfidence,
  ComparisonCategory,
  SearchMatchType,
  StructuredProduct,
} from "./types";

/**
 * Product comparison entry — search-first pipeline in `./compareEngine`.
 * Structured extraction and matching live in `./normalize` and `./match`.
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
  StructuredProduct,
} from "./types";

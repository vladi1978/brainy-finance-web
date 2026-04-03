/**
 * Product comparison entry — search-first pipeline in `./compareEngine`.
 * Normalization lives in `./normalize`; attribute gates + scoring in `./attributeMatch` + `./match`.
 */

export { compareProduct, DEMO_MODE, isCompareDemoMode } from "./compareEngine";
export { scoreAttributeMatch } from "./attributeMatch";
export {
  buildNormalizedProduct,
  buildStructuredProduct,
  normalizeTitle,
  parseProductAttributesFromTitle,
  toComparisonCategory,
} from "./normalize";
export type { ParsedProductAttributes, StructuredListingContext } from "./normalize";
export {
  rankMatchTypes,
  scoreQueryRelevance,
} from "./searchRelevance";
export type { QueryRelevanceResult } from "./searchRelevance";
/** @deprecated Legacy structured evaluation helper — API uses `scoreAttributeMatch`. */
export {
  attributeScoreForPair,
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

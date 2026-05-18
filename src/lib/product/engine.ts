/**
 * Product comparison entry — search-first pipeline in `./compareEngine`.
 * Normalization lives in `./normalize`; attribute gates + scoring in `./attributeMatch` + `./match`.
 */

export { compareProduct, DEMO_MODE, isCompareDemoMode } from "./compareEngine";
export {
  fetchAiProductMetadata,
  applyAiProductMetadataToUnderstanding,
  aiProductMetadataSearchQueries,
} from "./aiProductMetadata";
export type { AiProductMetadata, AiProductMetadataInput } from "./aiProductMetadata";
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
/** Universal matcher — profile-driven gates + weighted similarity (extends cleanly with embeddings/APIs). */
export {
  runUniversalHardGates,
  scoreUniversalStructured,
} from "./matching/universalMatchEngine";
export type { UniversalStructuredScore } from "./matching/universalMatchEngine";
export {
  CATEGORY_MATCH_PROFILES,
  profileForCategory,
} from "./matching/weightProfiles";
export type { CategoryGateFlags, CategoryMatchProfile } from "./matching/weightProfiles";
export type { UniversalAttributeKey } from "./matching/attributeKeys";
export type {
  CompareApiCandidate,
  CompareConfidence,
  ComparisonCategory,
  SearchMatchType,
  StructuredProduct,
  UniversalStoreId,
} from "./types";

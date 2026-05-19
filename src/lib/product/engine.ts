/**
 * Product comparison public API — orchestration in `./compareEngine`.
 * Discovery: Google Shopping (Serper/SerpAPI) via `./googleShoppingSearch`.
 * PDP URLs: `./registry` providers `extractSourceProduct` (not `searchCandidates`).
 * Architecture & legacy paths: `./LEGACY.md`.
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
export {
  extractUniversalProductIdentity,
  identityMatchLabel,
  rankIdentityMatchTypes,
  scoreProductIdentity,
} from "./matching/productIdentity";
export type { ProductIdentityResult, UniversalProductIdentity } from "./matching/productIdentity";
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
  ProductIdentityMatchType,
  SearchMatchType,
  StructuredProduct,
  UniversalStoreId,
} from "./types";

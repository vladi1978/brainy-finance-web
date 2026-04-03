/**
 * Product comparison — public entrypoints.
 *
 * Implementation lives under `./comparison/` (matching, normalization, SERP orchestration).
 * Add new retailers in `./registry.ts` by implementing `ProductProvider` and registering it.
 */

export type {
  CompareProductResponse,
  ComparisonTrace,
  CandidateStepTrace,
  SelectionTrace,
} from "./comparison/compareTypes";
export type { MatchType, MatchEvaluation } from "./comparison/matchTypes";
export {
  compareProduct,
  type CompareProductOptions,
} from "./comparison/runCompareProduct";
export {
  evaluateProductMatch,
  evaluateProductMatchDetailed,
  scoreProductMatch,
  isTvProduct,
  extractTvSignals,
} from "./comparison/matchClassifier";
export { extractImportantQuery } from "./comparison/queryText";

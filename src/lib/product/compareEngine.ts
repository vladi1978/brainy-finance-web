/**
 * Back-compat re-exports — new implementation lives in `./engine`.
 */

export { compareProduct, isCompareDemoMode } from "./engine";
export type { CompareProductOptions } from "./types";
export type {
  CompareProductResponse,
  ComparisonTrace,
  CandidateStepTrace,
  SelectionTrace,
  MatchTier,
} from "./types";

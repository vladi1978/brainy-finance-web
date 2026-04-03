/**
 * Back-compat re-exports — implementation lives in `./engine`.
 */

export { compareProduct, DEMO_MODE, isCompareDemoMode } from "./engine";
export type { CompareProductOptions } from "./types";
export type {
  CompareProductResponse,
  ComparisonTrace,
  CandidateStepTrace,
  SelectionTrace,
  MatchTier,
} from "./types";

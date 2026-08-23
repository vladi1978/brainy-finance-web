import type {
  CandidateProduct,
  MatchConfidenceLabel,
  NormalizedProduct,
  StructuredProduct,
} from "./types";
import {
  displayPanelsComparable,
  missingCriticalDimensionSignatures,
  runUniversalHardGates,
  scoreUniversalStructured,
  shouldApplyCriticalKindPhraseSoftPenalty,
  shouldApplyDiagonalIncompleteSoftPenalty,
  type UniversalHardGateResult,
} from "./matching/universalMatchEngine";

/** @deprecated Threshold naming retained for external bundles — unused by universal scorer. */
export const MIN_COMPARABLE_SCORE_TV = 85;

/** @deprecated Threshold naming retained for external bundles — unused by universal scorer. */
export const MIN_COMPARABLE_SCORE_OTHER = 75;

/** @deprecated Use `BAND_*` from `matching/confidenceBands` for display tiers. */
export const SCORE_EXACT_MIN = 90;
export const SCORE_EQUIVALENT_MIN = 75;
export const SCORE_ALTERNATIVE_MIN = 55;

export const WEAK_MATCH_MIN_SCORE = SCORE_ALTERNATIVE_MIN;

export {
  BAND_EXACT_MIN,
  BAND_HIGH_CONFIDENCE_MIN,
  BAND_POSSIBLE_MIN,
  classifyConfidenceBand,
  confidenceBandBadgeLabel,
} from "./matching/confidenceBands";

export type HardGateResult = UniversalHardGateResult;

export type EvaluateResult = {
  score: number;
  matchConfidence: MatchConfidenceLabel | "none";
  reasons: string[];
  rejected: boolean;
  rejectionDetail: string | null;
  comparisonReason: string;
};

export function runHardGates(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  return runUniversalHardGates(source, candidate);
}

export function attributeScoreForPair(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): { score: number; reasons: string[] } {
  const r = scoreUniversalStructured(source, candidate);
  return { score: r.score, reasons: r.reasons };
}

export type { UniversalStructuredScore } from "./matching/universalMatchEngine";
export { missingCriticalDimensionSignatures };

/** Re-export for legacy imports — delegates to universal diagonal incomplete heuristic. */
export function shouldApplyTvSizeIncompleteSoftPenalty(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): boolean {
  return shouldApplyDiagonalIncompleteSoftPenalty(source, candidate);
}

export { shouldApplyCriticalKindPhraseSoftPenalty };

export function scoreTvStructured(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): { score: number; reasons: string[] } {
  return attributeScoreForPair(source, candidate);
}

export function displayTechsComparable(
  a: Parameters<typeof displayPanelsComparable>[0],
  b: Parameters<typeof displayPanelsComparable>[1]
): boolean {
  return displayPanelsComparable(a, b);
}

export function logComparisonCandidateDebug(payload: {
  sourceStructured: StructuredProduct;
  candidateStructured: StructuredProduct;
  candidateStore: string;
  rejectionReason: string | null;
  finalScore: number;
  scoreReasons: string[];
}): void {
  if (process.env.DEBUG_COMPARE !== "true") return;
  console.log("[compare-candidate]", {
    candidateStore: payload.candidateStore,
    rejectionReason: payload.rejectionReason,
    finalScore: payload.finalScore,
    scoreReasonsPreview: payload.scoreReasons.slice(0, 5),
    scoreReasonsCount: payload.scoreReasons.length,
  });
}

export function classifyMatchConfidence(score: number): MatchConfidenceLabel | "none" {
  if (score >= SCORE_EXACT_MIN) return "exact";
  if (score >= SCORE_EQUIVALENT_MIN) return "equivalent";
  if (score >= SCORE_ALTERNATIVE_MIN) return "alternative";
  return "none";
}

export function comparisonReasonFor(
  label: MatchConfidenceLabel | "none",
  score: number
): string {
  if (label === "exact") {
    return "Structured attributes align — same product line for a trustworthy price comparison.";
  }
  if (label === "equivalent") {
    return "Structured attributes closely match — suitable for price comparison.";
  }
  if (label === "alternative") {
    return "Related listing in the same category — verify details before buying.";
  }
  return `Below minimum match strength (score=${score}).`;
}

export function isPrimaryComparableTier(label: MatchConfidenceLabel | "none"): boolean {
  return label === "exact" || label === "equivalent";
}

export function isAlternativeTier(label: MatchConfidenceLabel | "none"): boolean {
  return label === "alternative";
}

function confidenceFromStructured(score: number): MatchConfidenceLabel | "none" {
  if (score >= 90) return "exact";
  if (score >= 75) return "equivalent";
  if (score >= 55) return "alternative";
  return "none";
}

/**
 * @deprecated Not used by live `compareProduct`. Use `scoreAttributeMatch` (attributeMatch.ts)
 * and `scoreProductIdentity` (matching/productIdentity.ts). Kept for manual inspection / Phase 2
 * removal. See `LEGACY.md`.
 */
export function evaluateCandidate(
  source: NormalizedProduct,
  candidate: CandidateProduct
): EvaluateResult {
  const gate = runHardGates(source, candidate.normalized);
  if (!gate.ok) {
    logComparisonCandidateDebug({
      sourceStructured: source.structured,
      candidateStructured: candidate.normalized.structured,
      candidateStore: candidate.store,
      rejectionReason: gate.reason,
      finalScore: 0,
      scoreReasons: [`hard_gate:${gate.reason}`],
    });
    return {
      score: 0,
      matchConfidence: "none",
      reasons: [`hard_gate:${gate.reason}`],
      rejected: true,
      rejectionDetail: gate.reason,
      comparisonReason: comparisonReasonFor("none", 0),
    };
  }

  const { score, reasons } = attributeScoreForPair(source, candidate.normalized);
  const minScore = 55;
  if (score < minScore) {
    const detail = `below_structured_threshold(score=${score},need>=${minScore})`;
    logComparisonCandidateDebug({
      sourceStructured: source.structured,
      candidateStructured: candidate.normalized.structured,
      candidateStore: candidate.store,
      rejectionReason: detail,
      finalScore: score,
      scoreReasons: reasons,
    });
    return {
      score,
      matchConfidence: "none",
      reasons: [...reasons, detail],
      rejected: false,
      rejectionDetail: detail,
      comparisonReason: comparisonReasonFor("none", score),
    };
  }

  const matchConfidence = confidenceFromStructured(score);
  logComparisonCandidateDebug({
    sourceStructured: source.structured,
    candidateStructured: candidate.normalized.structured,
    candidateStore: candidate.store,
    rejectionReason: null,
    finalScore: score,
    scoreReasons: reasons,
  });

  return {
    score,
    matchConfidence,
    reasons,
    rejected: false,
    rejectionDetail: null,
    comparisonReason: comparisonReasonFor(matchConfidence, score),
  };
}

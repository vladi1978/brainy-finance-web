import {
  buildCandidateUnderstanding,
  scoreUnderstandingOverlap,
  type ProductUnderstanding,
} from "./aiExtractor";
import {
  missingCriticalDimensionSignatures,
  runUniversalHardGates,
  scoreUniversalStructured,
  shouldApplyCriticalKindPhraseSoftPenalty,
  shouldApplyDiagonalIncompleteSoftPenalty,
} from "./matching/universalMatchEngine";
import type { CompareConfidence, NormalizedProduct, SearchMatchType } from "./types";
import { scoreQueryRelevance } from "./searchRelevance";

export type AttributeMatchResult = {
  confidence: number;
  matchType: SearchMatchType;
  /** Qualitative tier aligned with API `matchConfidenceLabel` */
  matchConfidenceLabel: CompareConfidence;
  relevanceScore: number;
  reasons: string[];
  rejected: boolean;
  rejectionReason: string | null;
};

export type AttributeMatchOptions = {
  /** Phase 1 structured understanding — blends into scoring; gates unchanged. */
  referenceUnderstanding?: ProductUnderstanding | null;
};

export type { ProductUnderstanding } from "./aiExtractor";

/** Obvious mismatches and noise fall below this; weak-similar tier starts at this score. */
const MIN_COMBINED_RELEVANCE = 10;

/** Structured + keyword blend needed for “same product line” tier. */
const TIER1_BLEND_MIN = 36;

/** Blend floor for equivalent alternatives (Tier 2). */
const TIER2_BLEND_MIN = 23;

/** Structured score shortcut for Tier 1 when blend is borderline. */
const TIER1_STRUCTURED_MIN = 86;

const CRITICAL_DIM_SOFT_PENALTY_EACH = 12;
const CRITICAL_DIM_SOFT_PENALTY_CAP = 40;

/** One-sided missing parsed diagonal vs peer structured size — soften instead of rejecting. */
const DIAG_INCOMPLETE_FACTOR = 0.82;

/** Reference kind stems absent from candidate copy — soften vs hard reject. */
const CRITICAL_KIND_PHRASE_MISS_FACTOR = 0.85;

/** Minimum reference extraction confidence before structured understanding affects blending. */
const UNDERSTANDING_BLEND_MIN_CONF = 0.22;

/**
 * Universal attribute matching: profile-driven hard gates, weighted structured similarity,
 * keyword recall blend, optional structured understanding overlap, and three display tiers.
 */
export function scoreAttributeMatch(
  source: NormalizedProduct,
  candidate: NormalizedProduct,
  queryText: string,
  candidateTitle: string,
  options?: AttributeMatchOptions
): AttributeMatchResult {
  const gate = runUniversalHardGates(source, candidate);
  if (!gate.ok) {
    return {
      confidence: 0,
      matchType: "low",
      matchConfidenceLabel: "low",
      relevanceScore: 0,
      reasons: [`hard_gate:${gate.reason}`],
      rejected: true,
      rejectionReason: gate.reason,
    };
  }

  const structured = scoreUniversalStructured(source, candidate);
  let attrScore = structured.score;
  const missingDims = missingCriticalDimensionSignatures(source, candidate);
  const dimPenaltyReasons: string[] = [];
  if (missingDims.length > 0) {
    const deduction = Math.min(
      CRITICAL_DIM_SOFT_PENALTY_CAP,
      missingDims.length * CRITICAL_DIM_SOFT_PENALTY_EACH
    );
    attrScore = Math.max(0, attrScore - deduction);
    for (const dim of missingDims) {
      dimPenaltyReasons.push(
        `soft_penalty:critical_dimension_unconfirmed(${dim})`
      );
    }
  }

  if (shouldApplyDiagonalIncompleteSoftPenalty(source, candidate)) {
    attrScore *= DIAG_INCOMPLETE_FACTOR;
    dimPenaltyReasons.push(
      "soft_penalty:diagonal_structured_unknown_one_side(×0.82)"
    );
  }
  if (shouldApplyCriticalKindPhraseSoftPenalty(source, candidate)) {
    attrScore *= CRITICAL_KIND_PHRASE_MISS_FACTOR;
    dimPenaltyReasons.push(
      "soft_penalty:critical_kind_phrases_unconfirmed(×0.85)"
    );
  }

  const kw = scoreQueryRelevance(queryText, candidateTitle);

  const refU = options?.referenceUnderstanding ?? null;
  let understandingScore = 0;
  let understandingReasons: string[] = [];
  let identityBoost = false;
  let uWeight = 0;

  if (
    refU &&
    refU.extractionConfidence >= UNDERSTANDING_BLEND_MIN_CONF
  ) {
    const candU = buildCandidateUnderstanding(candidate, candidateTitle);
    const ov = scoreUnderstandingOverlap(refU, candU, candidateTitle);
    understandingScore = ov.score;
    identityBoost = ov.exactIdentityMatch;
    understandingReasons = ov.reasons.map((r) => `understanding:${r}`);
    uWeight = Math.min(0.22, refU.extractionConfidence * 0.28);
  }

  const attrFactor = 0.82 - uWeight * 0.55;
  const kwFactor = 0.18 - uWeight * 0.45;
  const blended = Math.round(
    attrScore * attrFactor +
      kw.relevanceScore * kwFactor +
      understandingScore * uWeight
  );

  const reasons = [
    ...structured.reasons,
    ...dimPenaltyReasons,
    ...understandingReasons,
    ...kw.reasons.map((r) => `kw:${r}`),
    uWeight > 0
      ? `blend_weights(attr=${attrFactor.toFixed(3)},kw=${kwFactor.toFixed(3)},understanding=${uWeight.toFixed(3)})`
      : "blend_weights(attr=0.820,kw=0.180)",
    `blended=${blended}`,
  ];

  if (blended < MIN_COMBINED_RELEVANCE) {
    const detail = `below_minimum_relevance(blended=${blended},need>=${MIN_COMBINED_RELEVANCE})`;
    return {
      confidence: blended / 100,
      matchType: "low",
      matchConfidenceLabel: "low",
      relevanceScore: blended,
      reasons: [...reasons, detail],
      rejected: true,
      rejectionReason: detail,
    };
  }

  const tier1 =
    blended >= TIER1_BLEND_MIN &&
    (structured.sameProductLineSignals ||
      structured.score >= TIER1_STRUCTURED_MIN ||
      (identityBoost &&
        understandingScore >= 46 &&
        blended >= TIER2_BLEND_MIN));
  const tier2 = !tier1 && blended >= TIER2_BLEND_MIN;

  let matchType: SearchMatchType;
  let matchConfidenceLabel: CompareConfidence;
  if (tier1) {
    matchType = "high";
    matchConfidenceLabel = "high";
  } else if (tier2) {
    matchType = "equivalent";
    matchConfidenceLabel = "medium";
  } else {
    matchType = "similar_product";
    matchConfidenceLabel = "medium";
    reasons.push("tier:weak_similar(missing_some_critical_specs)");
  }

  const confidence = Math.min(1, blended / 100);

  return {
    confidence,
    matchType,
    matchConfidenceLabel,
    relevanceScore: blended,
    reasons,
    rejected: false,
    rejectionReason: null,
  };
}

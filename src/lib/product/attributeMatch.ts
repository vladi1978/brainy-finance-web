import {
  attributeScoreForPair,
  missingCriticalDimensionSignatures,
  runHardGates,
  shouldApplyCriticalKindPhraseSoftPenalty,
  shouldApplyTvSizeIncompleteSoftPenalty,
} from "./match";
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

/** Below this blended score, reject (cannot confirm a meaningful substitute). */
const MIN_COMBINED_RELEVANCE = 15;

/** At or above: treat as exact / high-confidence same-or-equivalent product for ranking and best-deal logic. */
const TIER_HIGH_CONFIDENCE = 32;

/** Lower structured-component score when reference critical dims are absent from candidate text. */
const CRITICAL_DIM_SOFT_PENALTY_EACH = 12;
const CRITICAL_DIM_SOFT_PENALTY_CAP = 40;

/** One-sided missing parsed TV diagonal vs peer structured size — soften instead of rejecting. */
const TV_SIZE_ONE_SIDE_MISSING_FACTOR = 0.8;

/** Reference kind stems (e.g. smart TV) absent from candidate copy — soften vs hard reject. */
const CRITICAL_KIND_PHRASE_MISS_FACTOR = 0.85;

/**
 * Attribute-first matching: hard filters, structured score, light keyword blend.
 */
export function scoreAttributeMatch(
  source: NormalizedProduct,
  candidate: NormalizedProduct,
  queryText: string,
  candidateTitle: string
): AttributeMatchResult {
  const gate = runHardGates(source, candidate);
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

  const attr = attributeScoreForPair(source, candidate);
  const missingDims = missingCriticalDimensionSignatures(source, candidate);
  let attrScore = attr.score;
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

  if (shouldApplyTvSizeIncompleteSoftPenalty(source, candidate)) {
    attrScore *= TV_SIZE_ONE_SIDE_MISSING_FACTOR;
    dimPenaltyReasons.push(
      "soft_penalty:tv_size_structured_unknown_one_side(×0.8)"
    );
  }
  if (shouldApplyCriticalKindPhraseSoftPenalty(source, candidate)) {
    attrScore *= CRITICAL_KIND_PHRASE_MISS_FACTOR;
    dimPenaltyReasons.push(
      "soft_penalty:critical_kind_phrases_unconfirmed(×0.85)"
    );
  }

  const kw = scoreQueryRelevance(queryText, candidateTitle);
  const blended = Math.round(attrScore * 0.82 + kw.relevanceScore * 0.18);
  const reasons = [
    ...attr.reasons,
    ...dimPenaltyReasons,
    ...kw.reasons.map((r) => `kw:${r}`),
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

  let matchType: SearchMatchType;
  let matchConfidenceLabel: CompareConfidence;
  if (blended >= TIER_HIGH_CONFIDENCE) {
    matchType = "high";
    matchConfidenceLabel = "high";
  } else {
    matchType = "similar_product";
    matchConfidenceLabel = "medium";
    reasons.push("tier:similar_product(cross_retailer_naming)");
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

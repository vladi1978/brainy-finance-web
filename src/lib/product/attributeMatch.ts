import {
  attributeScoreForPair,
  missingCriticalDimensionSignatures,
  runHardGates,
} from "./match";
import type { NormalizedProduct } from "./types";
import type { SearchMatchType } from "./types";
import { scoreQueryRelevance } from "./searchRelevance";

export type AttributeMatchResult = {
  confidence: number;
  matchType: SearchMatchType;
  relevanceScore: number;
  reasons: string[];
  rejected: boolean;
  rejectionReason: string | null;
};

/** Hard gates failed — never surface in UI. */
const MIN_COMBINED_RELEVANCE = 32;

/** Tier thresholds on blended 0–100 score */
const TIER_HIGH = 70;
const TIER_MEDIUM = 46;

/** Lower structured-component score when reference critical dims are absent from candidate text. */
const CRITICAL_DIM_SOFT_PENALTY_EACH = 12;
const CRITICAL_DIM_SOFT_PENALTY_CAP = 40;

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
      relevanceScore: blended,
      reasons: [...reasons, detail],
      rejected: true,
      rejectionReason: detail,
    };
  }

  let matchType: SearchMatchType;
  if (blended >= TIER_HIGH) matchType = "high";
  else if (blended >= TIER_MEDIUM) matchType = "medium";
  else matchType = "low";

  const confidence = Math.min(1, blended / 100);

  return {
    confidence,
    matchType,
    relevanceScore: blended,
    reasons,
    rejected: false,
    rejectionReason: null,
  };
}

import type { CompareFlowDepartment } from "../compareFlowDepartment";
import { getDepartmentConfig } from "./departmentConfig";
import {
  isDepartmentPipelineStrict,
  STRICT_MISSING_CRITICAL_SCORE_CAP,
} from "./departmentPipelineStrict";
import {
  attributeKeyLabel,
  extractDepartmentAttributes,
} from "./attributeExtractor";
import { buildMatchExplanation } from "./departmentExplanation";
import { listMissingCriticalAttributes } from "./missingCriticalAttributes";
import type {
  DepartmentAttributeKey,
  DepartmentMatchTier,
  DepartmentScoringResult,
  DepartmentScoreTierThresholds,
  ExtractedDepartmentAttributes,
} from "./types";
import { screenSizeMatchQuality } from "../matching/displayDimensions";
import type { NormalizedProduct } from "../types";
import {
  isConcreteTvModelSku,
  isElectronicsTvListingPair,
  shouldApplyTvBrandMismatchCap,
  TV_ELECTRONICS_SCORING_WEIGHTS,
  TV_P0_SCORE_CAP,
} from "./tvMatchingPolicy";

type AttributeMatchQualityOptions = {
  strict: boolean;
  isRequired: boolean;
  tvElectronicsPair?: boolean;
};

function attributeMatchQuality(
  key: DepartmentAttributeKey,
  sourceVal: string | null | undefined,
  candidateVal: string | null | undefined,
  options: AttributeMatchQualityOptions
): { q: number; detail: string } {
  const { strict, isRequired, tvElectronicsPair } = options;

  if (!sourceVal && !candidateVal) {
    if (strict && isRequired) {
      return { q: 0.35, detail: "both_unknown_required" };
    }
    return { q: 0.65, detail: "both_unknown" };
  }
  if (sourceVal && !candidateVal) {
    if (strict && isRequired) {
      return { q: 0.2, detail: "candidate_missing_required" };
    }
    return { q: 0.55, detail: "candidate_missing" };
  }
  if (!sourceVal && candidateVal) {
    if (
      tvElectronicsPair &&
      key === "modelNumber" &&
      isConcreteTvModelSku(candidateVal)
    ) {
      return { q: 0.15, detail: "tv_source_missing_candidate_sku" };
    }
    if (strict && isRequired) {
      return { q: 0.45, detail: "source_missing_required" };
    }
    return { q: 0.7, detail: "source_missing" };
  }

  const a = sourceVal!.toLowerCase().replace(/\s+/g, "");
  const b = candidateVal!.toLowerCase().replace(/\s+/g, "");

  if (a === b) return { q: 1, detail: "exact" };

  if (key === "dimensions") {
    const parsePair = (s: string): [number, number] | null => {
      const parts = s.replace(/\s+/g, "").split("x");
      if (parts.length !== 2) return null;
      const x = parseFloat(parts[0]!);
      const y = parseFloat(parts[1]!);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return [x, y];
    };
    const pa = parsePair(a);
    const pb = parsePair(b);
    if (pa && pb) {
      const close = (x: number, y: number) =>
        x === y || Math.abs(x - y) / Math.max(x, y, 1) <= 0.03;
      if (close(pa[0], pb[0]) && close(pa[1], pb[1])) {
        return { q: 0.95, detail: "dimensions_close" };
      }
      const closeOne =
        (close(pa[0], pb[0]) ? 1 : 0) + (close(pa[1], pb[1]) ? 1 : 0);
      if (closeOne === 1) return { q: 0.6, detail: "dimensions_partial" };
      return { q: 0.15, detail: "dimensions_mismatch" };
    }
  }

  if (key === "modelNumber") {
    if (a.includes(b) || b.includes(a)) {
      return { q: 0.92, detail: "model_substring" };
    }
    const prefixLen = Math.min(5, a.length, b.length);
    if (a.slice(0, prefixLen) === b.slice(0, prefixLen)) {
      return { q: 0.78, detail: "model_family" };
    }
    return { q: 0.25, detail: "model_diff" };
  }

  if (key === "screenSize") {
    const na = parseInt(a.replace(/[^0-9]/g, ""), 10);
    const nb = parseInt(b.replace(/[^0-9]/g, ""), 10);
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      const scored = screenSizeMatchQuality(na, nb);
      if (scored.tier === "exact") return { q: 1, detail: "size_exact" };
      if (scored.tier === "moderate") return { q: 0.58, detail: "size_close_moderate" };
      if (scored.tier === "strong") return { q: 0.15, detail: "size_mismatch_strong" };
      return { q: 0.05, detail: "size_mismatch" };
    }
  }

  if (a.includes(b) || b.includes(a)) {
    return { q: 0.85, detail: "partial_match" };
  }

  return { q: 0.3, detail: "mismatch" };
}

function tierFromScore(
  score: number,
  thresholds: DepartmentScoreTierThresholds
): DepartmentMatchTier {
  if (score >= thresholds.exact_match) return "exact_match";
  if (score >= thresholds.high_confidence) return "high_confidence";
  if (score >= thresholds.similar_specs) return "similar_specs";
  if (score >= thresholds.compatible_alternative) return "compatible_alternative";
  return "rejected";
}

/** Weighted department scoring — returns 0–100 score and qualitative tier. */
export function scoreDepartmentMatch(
  departmentId: CompareFlowDepartment,
  sourceNorm: NormalizedProduct,
  candidateNorm: NormalizedProduct,
  sourceTitle: string,
  candidateTitle: string,
  penaltyFactor: number
): DepartmentScoringResult {
  const config = getDepartmentConfig(departmentId);
  const strict = isDepartmentPipelineStrict();
  const sourceAttrs = extractDepartmentAttributes(
    departmentId,
    sourceNorm,
    sourceTitle
  );
  const candidateAttrs = extractDepartmentAttributes(
    departmentId,
    candidateNorm,
    candidateTitle
  );

  const tvElectronicsPair =
    departmentId === "electronics" &&
    isElectronicsTvListingPair(sourceNorm, candidateNorm);
  const scoringWeights = tvElectronicsPair
    ? { ...config.scoringWeights, ...TV_ELECTRONICS_SCORING_WEIGHTS }
    : config.scoringWeights;

  const requiredSet = new Set(config.requiredAttributes);
  const attributeScores: Partial<Record<DepartmentAttributeKey, number>> = {};
  const scoreReasons: string[] = [];
  let weighted = 0;
  let wsum = 0;

  const keys = [
    ...config.requiredAttributes,
    ...config.importantAttributes,
  ];
  const uniqueKeys = [...new Set(keys)] as DepartmentAttributeKey[];

  for (const key of uniqueKeys) {
    const w = scoringWeights[key];
    if (w == null || w <= 0) continue;
    const { q, detail } = attributeMatchQuality(
      key,
      sourceAttrs[key],
      candidateAttrs[key],
      {
        strict,
        isRequired: requiredSet.has(key),
        tvElectronicsPair,
      }
    );
    attributeScores[key] = Math.round(q * 100);
    weighted += q * w;
    wsum += w;
    scoreReasons.push(
      `${attributeKeyLabel(key)}=${(q * w).toFixed(1)}(${detail})`
    );
  }

  let score =
    wsum > 0 ? Math.min(100, Math.round((weighted / wsum) * 100)) : 40;
  score = Math.round(score * penaltyFactor);
  scoreReasons.push(`penalty_factor=${penaltyFactor.toFixed(2)}`);

  if (
    tvElectronicsPair &&
    shouldApplyTvBrandMismatchCap(sourceNorm, candidateNorm, candidateTitle)
  ) {
    const beforeBrandCap = score;
    score = Math.min(score, TV_P0_SCORE_CAP);
    if (beforeBrandCap !== score) {
      scoreReasons.push(
        `tv_brand_mismatch_cap(${TV_P0_SCORE_CAP},before=${beforeBrandCap})`
      );
    }
  }

  const missingCritical = listMissingCriticalAttributes(
    config,
    sourceAttrs,
    candidateAttrs
  );
  let confidenceCappedForMissingData = false;

  if (strict && missingCritical.length > 0) {
    const before = score;
    score = Math.min(score, STRICT_MISSING_CRITICAL_SCORE_CAP);
    confidenceCappedForMissingData = true;
    scoreReasons.push(
      `confidence_capped_missing_data(cap=${STRICT_MISSING_CRITICAL_SCORE_CAP},missing=${missingCritical.join(",")},before=${before})`
    );
    console.log("[CONFIDENCE_CAPPED_MISSING_DATA]", {
      department: departmentId,
      missingCritical,
      scoreBefore: before,
      scoreAfter: score,
    });
  }

  scoreReasons.push(`department_score=${score}`);

  const tier = tierFromScore(score, config.scoreTierThresholds);
  const matchExplanation = buildMatchExplanation(
    config,
    tier,
    sourceAttrs,
    candidateAttrs,
    scoreReasons,
    null,
    { sourceNorm, candidateNorm }
  );

  return {
    score,
    tier,
    attributeScores,
    scoreReasons,
    matchExplanation,
    missingCriticalAttributes:
      missingCritical.length > 0 ? missingCritical : undefined,
    confidenceCappedForMissingData: confidenceCappedForMissingData || undefined,
  };
}

export function departmentTierToSearchMatchType(
  tier: DepartmentMatchTier
): "high" | "equivalent" | "similar_product" | "low" {
  switch (tier) {
    case "exact_match":
    case "high_confidence":
      return "high";
    case "similar_specs":
      return "equivalent";
    case "compatible_alternative":
      return "similar_product";
    case "rejected":
      return "low";
  }
}

export function departmentTierToConfidenceLabel(
  tier: DepartmentMatchTier
): "high" | "medium" | "low" {
  switch (tier) {
    case "exact_match":
    case "high_confidence":
      return "high";
    case "similar_specs":
      return "medium";
    case "compatible_alternative":
      return "medium";
    case "rejected":
      return "low";
  }
}

import {
  buildCandidateUnderstanding,
  scoreUnderstandingOverlap,
  type ProductUnderstanding,
} from "./aiExtractor";
import type { CompareFlowDepartment } from "./compareFlowDepartment";
import { runDepartmentIntelligence } from "./department";
import {
  isDepartmentPipelineStrict,
  STRICT_MISSING_CRITICAL_SCORE_CAP,
} from "./department/departmentPipelineStrict";
import {
  checkDepartmentCriticalSpecsGate,
  checkUniversalCriticalSpecsGate,
  criticalSpecRejectPayload,
  logCriticalSpecRejected,
  type CriticalSpecsGateResult,
} from "./matching/criticalSpecs";
import {
  isDepartmentHardGatesV2,
  logDeptHardReject,
  runPoolsOutdoorHardGateV2,
} from "./matching/gates";
import {
  runUniversalHardGates,
  scoreUniversalStructured,
  shouldApplyCriticalKindPhraseSoftPenalty,
  shouldApplyDiagonalIncompleteSoftPenalty,
} from "./matching/universalMatchEngine";
import {
  classifyAttributeRejectReason,
  logAttributeReject,
} from "./matching/attributeRejectLog";
import { isHardAttributeRejection } from "./matching/confidenceBands";
import { scoreProductIdentity } from "./matching/productIdentity";
import type {
  CompareConfidence,
  NormalizedProduct,
  SearchMatchType,
  SourceScrapedHints,
  UniversalStoreId,
} from "./types";
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
  /** User-facing department intelligence explanation when a department is selected. */
  matchExplanation?: string | null;
  /** 0–100 department-specific score when a department is selected. */
  departmentScore?: number | null;
  /** Department intelligence tier when a department is selected. */
  departmentTier?: string | null;
};

export type AttributeMatchRejectLogContext = {
  store: UniversalStoreId;
  sourceHints?: SourceScrapedHints | null;
};

export type AttributeMatchOptions = {
  /** Phase 1 structured understanding — blends into scoring; gates unchanged. */
  referenceUnderstanding?: ProductUnderstanding | null;
  /** User-selected compare-flow department — activates department intelligence modes. */
  selectedDepartment?: CompareFlowDepartment | null;
  /** Reference product title for department attribute extraction. */
  sourceTitle?: string;
  /** When set, hard attribute rejections emit `[ATTRIBUTE_REJECT]` logs. */
  rejectLogContext?: AttributeMatchRejectLogContext | null;
};

export type { ProductUnderstanding } from "./aiExtractor";

/** Hard floor — below this is debug-only noise, not shown in UI. */
const MIN_COMBINED_RELEVANCE = 55;

/** Structured + keyword blend needed for “same product line” tier. */
const TIER1_BLEND_MIN = 36;

/** Blend floor for equivalent alternatives (Tier 2). */
const TIER2_BLEND_MIN = 23;

/** Structured score shortcut for Tier 1 when blend is borderline. */
const TIER1_STRUCTURED_MIN = 86;

/** One-sided missing parsed diagonal vs peer structured size — soften instead of rejecting. */
const DIAG_INCOMPLETE_FACTOR = 0.82;

/** WxH present on source but missing/unconfirmed on candidate — soften, do not hard reject. */
const DIMENSION_UNCONFIRMED_FACTOR = 0.78;

/** Electronics screen size within ±1–2 inches on both sides. */
const SCREEN_SIZE_MODERATE_FACTOR = 0.72;

/** Electronics screen size within ±3–5 inches on both sides. */
const SCREEN_SIZE_STRONG_FACTOR = 0.42;

/** One-sided missing structured screen size metadata. */
const SCREEN_SIZE_MISSING_SCORE_PENALTY = 10;

/** Both sides missing structured screen size metadata. */
const SCREEN_SIZE_BOTH_MISSING_SCORE_PENALTY = 20;

/** Reference kind stems absent from candidate copy — soften vs hard reject. */
const CRITICAL_KIND_PHRASE_MISS_FACTOR = 0.85;

/** Minimum reference extraction confidence before structured understanding affects blending. */
const UNDERSTANDING_BLEND_MIN_CONF = 0.22;

/** When no department is selected, department weighted score blends into universal structured score. */
const DEPARTMENT_SCORE_BLEND = 0.58;

/** Keyword blend weight when a single compare-flow department is active (department score dominates). */
const DEPARTMENT_EXCLUSIVE_KW_FACTOR = 0.22;

/**
 * User chose exactly one compare-flow department — only that department's gates, scoring axes,
 * and explanations apply (no universal TV/pool attribute bleed).
 */
function isDepartmentExclusiveMode(
  selectedDepartment: CompareFlowDepartment | null
): selectedDepartment is CompareFlowDepartment {
  return selectedDepartment != null;
}

function logHardAttributeReject(
  rawRejectionReason: string,
  source: NormalizedProduct,
  candidate: NormalizedProduct,
  candidateTitle: string,
  scores: { relevanceScore: number; departmentScore?: number | null },
  options?: AttributeMatchOptions
): void {
  const ctx = options?.rejectLogContext;
  if (!ctx) return;

  const identity = scoreProductIdentity(source, candidate, candidateTitle, {
    sourceTitle: options?.sourceTitle,
    sourceHints: ctx.sourceHints ?? null,
  });

  logAttributeReject({
    candidateTitle,
    store: ctx.store,
    relevanceScore: scores.relevanceScore,
    identityScore: identity.identityScore,
    departmentScore: scores.departmentScore ?? null,
    rejectionReason: classifyAttributeRejectReason(rawRejectionReason),
    rawRejectionReason,
  });
}

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
  const selectedDepartment = options?.selectedDepartment ?? null;
  const departmentExclusive = isDepartmentExclusiveMode(selectedDepartment);
  const sourceTitle = options?.sourceTitle ?? source.structured.title;

  const poolsV2Active =
    isDepartmentHardGatesV2() && selectedDepartment === "pools_outdoor";

  let departmentGate: CriticalSpecsGateResult | null = null;
  let poolsV2SoftPenalties: string[] = [];

  if (poolsV2Active) {
    const poolGate = runPoolsOutdoorHardGateV2({
      source,
      candidate,
      sourceTitle,
      candidateTitle,
    });
    if (poolGate.ok === false) {
      logDeptHardReject({
        department: "pools_outdoor",
        reason: poolGate.reason,
        sourceSpec: poolGate.sourceSpec,
        candidateSpec: poolGate.candidateSpec,
      });
      logHardAttributeReject(
        poolGate.reason,
        source,
        candidate,
        candidateTitle,
        { relevanceScore: 0, departmentScore: null },
        options
      );
      return {
        confidence: 0,
        matchType: "low",
        matchConfidenceLabel: "low",
        relevanceScore: 0,
        reasons: [`dept_hard_gate_v2:${poolGate.reason}`],
        rejected: true,
        rejectionReason: poolGate.reason,
        matchExplanation: `Rejected: ${poolGate.reason.split(",")[0]?.replace(/^pool_/, "") ?? poolGate.reason}`,
      };
    }
    poolsV2SoftPenalties = poolGate.softPenalties;
  } else {
    departmentGate = checkDepartmentCriticalSpecsGate(
      source,
      candidate,
      candidateTitle,
      { selectedDepartment }
    );
    if (departmentGate?.ok === false) {
      logCriticalSpecRejected(
        criticalSpecRejectPayload(
          departmentGate.reason,
          source,
          candidate,
          candidateTitle
        )
      );
      logHardAttributeReject(
        departmentGate.reason,
        source,
        candidate,
        candidateTitle,
        { relevanceScore: 0, departmentScore: null },
        options
      );
      return {
        confidence: 0,
        matchType: "low",
        matchConfidenceLabel: "low",
        relevanceScore: 0,
        reasons: [`department_gate:${departmentGate.reason}`],
        rejected: true,
        rejectionReason: departmentGate.reason,
        matchExplanation: `Rejected: ${departmentGate.reason.split("|")[0]?.replace(/^department_[a-z_]+:/, "") ?? departmentGate.reason}`,
      };
    }
  }

  let departmentIntel: ReturnType<typeof runDepartmentIntelligence> | null = null;
  if (selectedDepartment) {
    departmentIntel = runDepartmentIntelligence(source, candidate, {
      selectedDepartment,
      sourceTitle,
      candidateTitle,
    });
    if (
      departmentIntel.rejected &&
      isHardAttributeRejection(departmentIntel.rejectionReason)
    ) {
      if (process.env.DEBUG_COMPARE === "true") {
        console.log("[DEPARTMENT_HARD_REJECT]", {
          reason: departmentIntel.rejectionReason,
          score: departmentIntel.departmentScore,
        });
      }
      logHardAttributeReject(
        departmentIntel.rejectionReason ?? "department_reject_unknown",
        source,
        candidate,
        candidateTitle,
        {
          relevanceScore: departmentIntel.departmentScore,
          departmentScore: departmentIntel.departmentScore,
        },
        options
      );
      return {
        confidence: 0,
        matchType: "low",
        matchConfidenceLabel: "low",
        relevanceScore: departmentIntel.departmentScore,
        reasons: [
          ...departmentIntel.scoreReasons,
          `department_reject:${departmentIntel.rejectionReason}`,
        ],
        rejected: true,
        rejectionReason: departmentIntel.rejectionReason,
        matchExplanation: departmentIntel.matchExplanation,
        departmentScore: departmentIntel.departmentScore,
      };
    }
  }

  let universalCriticalSoftPenalties: string[] = [];

  if (!departmentExclusive) {
    const criticalGate = checkUniversalCriticalSpecsGate(
      source,
      candidate,
      candidateTitle
    );
    if (criticalGate.ok === false) {
      logCriticalSpecRejected(
        criticalSpecRejectPayload(
          criticalGate.reason,
          source,
          candidate,
          candidateTitle
        )
      );
      logHardAttributeReject(
        criticalGate.reason,
        source,
        candidate,
        candidateTitle,
        { relevanceScore: 0, departmentScore: departmentIntel?.departmentScore ?? null },
        options
      );
      return {
        confidence: 0,
        matchType: "low",
        matchConfidenceLabel: "low",
        relevanceScore: 0,
        reasons: [`critical_spec:${criticalGate.reason}`],
        rejected: true,
        rejectionReason: criticalGate.reason,
      };
    }
    universalCriticalSoftPenalties = criticalGate.softPenalties;

    const gate = runUniversalHardGates(source, candidate);
    if (gate.ok === false) {
      logHardAttributeReject(
        gate.reason,
        source,
        candidate,
        candidateTitle,
        { relevanceScore: 0, departmentScore: departmentIntel?.departmentScore ?? null },
        options
      );
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
  }

  const departmentGateSoft = poolsV2Active
    ? poolsV2SoftPenalties
    : departmentGate?.ok === true
      ? departmentGate.softPenalties
      : [];

  let attrScore: number;
  let structuredReasons: string[] = [];
  let sameProductLineSignals = false;

  if (departmentExclusive) {
    attrScore = departmentIntel?.departmentScore ?? 0;
  } else {
    const structured = scoreUniversalStructured(source, candidate);
    attrScore = structured.score;
    structuredReasons = structured.reasons;
    sameProductLineSignals = structured.sameProductLineSignals;
    if (departmentIntel && !departmentIntel.rejected) {
      attrScore = Math.round(
        departmentIntel.departmentScore * DEPARTMENT_SCORE_BLEND +
          structured.score * (1 - DEPARTMENT_SCORE_BLEND)
      );
    }
  }

  const dimPenaltyReasons: string[] = [...departmentGateSoft];
  if (departmentIntel) {
    dimPenaltyReasons.push(
      ...departmentIntel.scoreReasons.map((r) => `dept:${r}`)
    );
    if (departmentIntel.intelligence.validation.penalties.length > 0) {
      dimPenaltyReasons.push(
        `dept_penalties:${departmentIntel.intelligence.validation.penalties.join(",")}`
      );
    }
  }

  if (!departmentExclusive) {
    dimPenaltyReasons.unshift(...universalCriticalSoftPenalties);

    for (const p of dimPenaltyReasons) {
      if (p.startsWith("dimension_pair_unconfirmed")) {
        attrScore *= DIMENSION_UNCONFIRMED_FACTOR;
      }
      if (
        p.includes("screen_size_moderate_penalty") ||
        p.includes("department_screen_size_moderate")
      ) {
        attrScore *= SCREEN_SIZE_MODERATE_FACTOR;
        if (!dimPenaltyReasons.some((r) => r.includes("soft_penalty:screen_size_moderate"))) {
          dimPenaltyReasons.push("soft_penalty:screen_size_moderate(×0.72)");
        }
      }
      if (
        p.includes("screen_size_strong_penalty") ||
        p.includes("department_screen_size_strong")
      ) {
        attrScore *= SCREEN_SIZE_STRONG_FACTOR;
        if (!dimPenaltyReasons.some((r) => r.includes("soft_penalty:screen_size_strong"))) {
          dimPenaltyReasons.push("soft_penalty:screen_size_strong(×0.42)");
        }
      }
      if (p.includes("department_screen_size_missing_soft")) {
        attrScore = Math.max(0, attrScore - SCREEN_SIZE_MISSING_SCORE_PENALTY);
        if (!dimPenaltyReasons.some((r) => r.includes("soft_penalty:screen_size_missing"))) {
          dimPenaltyReasons.push(
            `soft_penalty:screen_size_missing(-${SCREEN_SIZE_MISSING_SCORE_PENALTY})`
          );
        }
      }
      if (p.includes("department_screen_size_both_missing_soft")) {
        attrScore = Math.max(0, attrScore - SCREEN_SIZE_BOTH_MISSING_SCORE_PENALTY);
        if (
          !dimPenaltyReasons.some((r) => r.includes("soft_penalty:screen_size_both_missing"))
        ) {
          dimPenaltyReasons.push(
            `soft_penalty:screen_size_both_missing(-${SCREEN_SIZE_BOTH_MISSING_SCORE_PENALTY})`
          );
        }
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
  } else if (selectedDepartment === "pools_outdoor") {
    for (const p of dimPenaltyReasons) {
      if (p.startsWith("dimension_pair_unconfirmed")) {
        attrScore *= DIMENSION_UNCONFIRMED_FACTOR;
      }
    }
  } else if (selectedDepartment === "electronics") {
    for (const p of dimPenaltyReasons) {
      if (
        p.includes("department_screen_size_moderate") ||
        p.includes("screen_size_moderate_penalty")
      ) {
        attrScore *= SCREEN_SIZE_MODERATE_FACTOR;
        if (!dimPenaltyReasons.some((r) => r.includes("soft_penalty:screen_size_moderate"))) {
          dimPenaltyReasons.push("soft_penalty:screen_size_moderate(×0.72)");
        }
      }
      if (
        p.includes("department_screen_size_strong") ||
        p.includes("screen_size_strong_penalty")
      ) {
        attrScore *= SCREEN_SIZE_STRONG_FACTOR;
        if (!dimPenaltyReasons.some((r) => r.includes("soft_penalty:screen_size_strong"))) {
          dimPenaltyReasons.push("soft_penalty:screen_size_strong(×0.42)");
        }
      }
      if (p.includes("department_screen_size_missing_soft")) {
        attrScore = Math.max(0, attrScore - SCREEN_SIZE_MISSING_SCORE_PENALTY);
        if (!dimPenaltyReasons.some((r) => r.includes("soft_penalty:screen_size_missing"))) {
          dimPenaltyReasons.push(
            `soft_penalty:screen_size_missing(-${SCREEN_SIZE_MISSING_SCORE_PENALTY})`
          );
        }
      }
      if (p.includes("department_screen_size_both_missing_soft")) {
        attrScore = Math.max(0, attrScore - SCREEN_SIZE_BOTH_MISSING_SCORE_PENALTY);
        if (
          !dimPenaltyReasons.some((r) => r.includes("soft_penalty:screen_size_both_missing"))
        ) {
          dimPenaltyReasons.push(
            `soft_penalty:screen_size_both_missing(-${SCREEN_SIZE_BOTH_MISSING_SCORE_PENALTY})`
          );
        }
      }
    }
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

  const attrFactor = departmentExclusive
    ? 1 - DEPARTMENT_EXCLUSIVE_KW_FACTOR - uWeight
    : 0.82 - uWeight * 0.55;
  const kwFactor = departmentExclusive
    ? DEPARTMENT_EXCLUSIVE_KW_FACTOR
    : 0.18 - uWeight * 0.45;
  let blended = Math.round(
    attrScore * attrFactor +
      kw.relevanceScore * kwFactor +
      understandingScore * uWeight
  );

  const strictMissingCap =
    isDepartmentPipelineStrict() &&
    Boolean(departmentIntel?.intelligence.scoring?.confidenceCappedForMissingData);
  if (strictMissingCap) {
    const beforeBlend = blended;
    attrScore = Math.min(attrScore, STRICT_MISSING_CRITICAL_SCORE_CAP);
    blended = Math.min(blended, STRICT_MISSING_CRITICAL_SCORE_CAP);
    if (beforeBlend !== blended) {
      dimPenaltyReasons.push(
        `strict_cap:missing_critical_blend(${STRICT_MISSING_CRITICAL_SCORE_CAP})`
      );
    }
  }

  const reasons = [
    ...structuredReasons,
    ...dimPenaltyReasons,
    ...understandingReasons,
    ...kw.reasons.map((r) => `kw:${r}`),
    departmentExclusive
      ? `blend_weights(department_exclusive,attr=${attrFactor.toFixed(3)},kw=${kwFactor.toFixed(3)},understanding=${uWeight.toFixed(3)})`
      : uWeight > 0
        ? `blend_weights(attr=${attrFactor.toFixed(3)},kw=${kwFactor.toFixed(3)},understanding=${uWeight.toFixed(3)})`
        : "blend_weights(attr=0.820,kw=0.180)",
    `blended=${blended}`,
  ];

  if (blended < MIN_COMBINED_RELEVANCE) {
    const detail = `below_minimum_relevance(blended=${blended},need>=${MIN_COMBINED_RELEVANCE})`;
    if (process.env.DEBUG_COMPARE === "true") {
      console.log("[ATTRIBUTE_SOFT_SUPPRESS]", { blended, detail });
    }
    return {
      confidence: blended / 100,
      matchType: "low",
      matchConfidenceLabel: "low",
      relevanceScore: blended,
      reasons: [...reasons, detail],
      rejected: false,
      rejectionReason: null,
      matchExplanation: departmentExclusive
        ? (departmentIntel?.matchExplanation ?? null)
        : null,
      departmentScore: departmentIntel?.departmentScore ?? null,
    };
  }

  const tier1 =
    blended >= TIER1_BLEND_MIN &&
    (sameProductLineSignals ||
      attrScore >= TIER1_STRUCTURED_MIN ||
      (identityBoost &&
        understandingScore >= 46 &&
        blended >= TIER2_BLEND_MIN));
  const tier2 = !tier1 && blended >= TIER2_BLEND_MIN;

  let matchType: SearchMatchType;
  let matchConfidenceLabel: CompareConfidence;

  const departmentTier = departmentIntel?.tier ?? null;

  if (departmentIntel && !departmentIntel.rejected) {
    matchType = departmentIntel.matchType;
    matchConfidenceLabel = departmentIntel.matchConfidenceLabel;
    reasons.push(`department_tier:${departmentIntel.tier}`);
    if (strictMissingCap && matchConfidenceLabel === "high") {
      matchConfidenceLabel = "medium";
      if (matchType === "high") {
        matchType = "equivalent";
      }
      reasons.push("strict_cap:match_confidence_downgraded_missing_critical");
    }
  } else if (tier1) {
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
    matchExplanation: departmentIntel?.matchExplanation ?? null,
    departmentScore: departmentIntel?.departmentScore ?? null,
    departmentTier,
  };
}

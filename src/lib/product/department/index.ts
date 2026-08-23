import type { CompareFlowDepartment } from "../compareFlowDepartment";
import { compareFlowDepartmentToProductDepartment } from "../compareFlowDepartment";
import type { NormalizedProduct, ProductDepartment } from "../types";
import { getDepartmentConfig } from "./departmentConfig";
import {
  extractDepartmentAttributes,
  summarizeExtractedAttributes,
} from "./attributeExtractor";
import { validateDepartmentMatch } from "./departmentValidator";
import {
  departmentTierToConfidenceLabel,
  departmentTierToSearchMatchType,
  scoreDepartmentMatch,
} from "./departmentScoring";
import { BAND_POSSIBLE_MIN } from "../matching/confidenceBands";
import type { DepartmentIntelligenceResult } from "./types";

export type DepartmentIntelligenceOptions = {
  selectedDepartment: CompareFlowDepartment;
  sourceTitle: string;
  candidateTitle: string;
};

export type DepartmentIntelligenceScore = {
  rejected: boolean;
  rejectionReason: string | null;
  departmentScore: number;
  tier: ReturnType<typeof scoreDepartmentMatch>["tier"];
  matchExplanation: string;
  scoreReasons: string[];
  matchType: ReturnType<typeof departmentTierToSearchMatchType>;
  matchConfidenceLabel: ReturnType<typeof departmentTierToConfidenceLabel>;
  intelligence: DepartmentIntelligenceResult;
};

const DEBUG_DEPARTMENT = process.env.DEBUG_COMPARE === "true";

function logDepartmentIntelligence(payload: Record<string, unknown>): void {
  console.log("[DEPARTMENT_INTELLIGENCE]", JSON.stringify(payload));
}

/**
 * Full department intelligence pipeline: extract → validate → score → explain.
 */
export function runDepartmentIntelligence(
  source: NormalizedProduct,
  candidate: NormalizedProduct,
  options: DepartmentIntelligenceOptions
): DepartmentIntelligenceScore {
  const { selectedDepartment, sourceTitle, candidateTitle } = options;
  const config = getDepartmentConfig(selectedDepartment);

  const sourceAttributes = extractDepartmentAttributes(
    selectedDepartment,
    source,
    sourceTitle
  );
  const candidateAttributes = extractDepartmentAttributes(
    selectedDepartment,
    candidate,
    candidateTitle
  );

  const validation = validateDepartmentMatch(
    selectedDepartment,
    source,
    candidate,
    sourceTitle,
    candidateTitle
  );

  if (validation.rejected) {
    const rejectionReason = validation.rejectionReasons.join("; ");
    const intelligence: DepartmentIntelligenceResult = {
      selectedDepartment,
      sourceAttributes,
      candidateAttributes,
      validation,
      scoring: null,
    };

    const matchExplanation = `Rejected: ${rejectionReason}`;

    logDepartmentIntelligence({
      selectedDepartment,
      displayName: config.displayName,
      extractedAttributes: {
        source: summarizeExtractedAttributes(selectedDepartment, sourceAttributes),
        candidate: summarizeExtractedAttributes(
          selectedDepartment,
          candidateAttributes
        ),
      },
      score: 0,
      tier: "rejected",
      matchExplanation,
      rejectionReasons: validation.rejectionReasons,
    });

    return {
      rejected: true,
      rejectionReason: rejectionReason,
      departmentScore: 0,
      tier: "rejected",
      matchExplanation,
      scoreReasons: validation.rejectionReasons.map((r) => `reject:${r}`),
      matchType: "low",
      matchConfidenceLabel: "low",
      intelligence,
    };
  }

  const scoring = scoreDepartmentMatch(
    selectedDepartment,
    source,
    candidate,
    sourceTitle,
    candidateTitle,
    validation.penaltyFactor
  );

  let tier = scoring.tier;
  if (tier === "rejected" && scoring.score >= BAND_POSSIBLE_MIN) {
    tier = "compatible_alternative";
  }

  const intelligence: DepartmentIntelligenceResult = {
    selectedDepartment,
    sourceAttributes,
    candidateAttributes,
    validation,
    scoring,
  };

  logDepartmentIntelligence({
    selectedDepartment,
    displayName: config.displayName,
    extractedAttributes: {
      source: summarizeExtractedAttributes(selectedDepartment, sourceAttributes),
      candidate: summarizeExtractedAttributes(
        selectedDepartment,
        candidateAttributes
      ),
    },
    score: scoring.score,
    tier,
    matchExplanation: scoring.matchExplanation,
    scoreReasons: scoring.scoreReasons,
    softPenalties: validation.penalties,
    rejectionReasons:
      tier === "rejected"
        ? [`below_department_minimum_score(${scoring.score})`]
        : [],
  });

  if (tier === "rejected" && DEBUG_DEPARTMENT) {
    logDepartmentIntelligence({
      selectedDepartment,
      displayName: config.displayName,
      debugOnlyReject: true,
      score: scoring.score,
      tier,
      note: "soft_score_suppressed_from_ui",
    });
  }

  const displayTier = tier === "rejected" ? "compatible_alternative" : tier;

  return {
    rejected: false,
    rejectionReason: null,
    departmentScore: scoring.score,
    tier: displayTier,
    matchExplanation: scoring.matchExplanation,
    scoreReasons:
      tier === "rejected"
        ? [
            ...scoring.scoreReasons,
            `debug:below_department_display_floor(score=${scoring.score})`,
          ]
        : scoring.scoreReasons,
    matchType: departmentTierToSearchMatchType(displayTier),
    matchConfidenceLabel: departmentTierToConfidenceLabel(displayTier),
    intelligence,
  };
}

/** Resolve active ProductDepartment — user selection overrides auto-detection. */
export function resolveActiveProductDepartment(
  selectedDepartment: CompareFlowDepartment | null | undefined,
  sourceCategoryDepartment: ProductDepartment
): ProductDepartment {
  if (selectedDepartment) {
    return compareFlowDepartmentToProductDepartment(selectedDepartment);
  }
  return sourceCategoryDepartment;
}

export {
  getDepartmentConfig,
  DEPARTMENT_CONFIGS,
} from "./departmentConfig";
export type {
  DepartmentConfig,
  DepartmentMatchTier,
  DepartmentIntelligenceResult,
} from "./types";

export function buildDepartmentSearchQueryHints(
  selectedDepartment: CompareFlowDepartment,
  norm: NormalizedProduct
): string[] {
  const config = getDepartmentConfig(selectedDepartment);
  const attrs = extractDepartmentAttributes(
    selectedDepartment,
    norm,
    norm.structured.title
  );
  const hints: string[] = [];

  switch (config.searchStrategy) {
    case "model_spec_focused":
      if (attrs.brand) hints.push(attrs.brand);
      if (attrs.modelNumber) hints.push(attrs.modelNumber);
      if (attrs.screenSize) hints.push(attrs.screenSize.replace("inch", " inch"));
      if (attrs.storage) hints.push(attrs.storage);
      break;
    case "dimension_focused":
      if (attrs.dimensions) hints.push(attrs.dimensions.replace("x", "x"));
      if (attrs.capacity) hints.push(attrs.capacity);
      if (attrs.poolType) hints.push(attrs.poolType);
      if (attrs.frameType) hints.push(attrs.frameType);
      break;
    case "tool_platform_focused":
      if (attrs.brand) hints.push(attrs.brand);
      if (attrs.modelNumber) hints.push(attrs.modelNumber);
      if (attrs.voltage) hints.push(attrs.voltage);
      if (attrs.batteryPlatform) hints.push(attrs.batteryPlatform);
      if (attrs.toolType) hints.push(attrs.toolType);
      break;
  }

  return hints.filter(Boolean);
}

if (DEBUG_DEPARTMENT) {
  // noop — flag read at runtime in runDepartmentIntelligence
}

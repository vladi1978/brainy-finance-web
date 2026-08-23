import type { CompareFlowDepartment } from "../compareFlowDepartment";
import type { ProductDepartment } from "../types";

/** Attribute keys used across department configs — extend when adding departments. */
export type DepartmentAttributeKey =
  | "brand"
  | "modelNumber"
  | "screenSize"
  | "storage"
  | "refreshRate"
  | "smartTvPlatform"
  | "productType"
  | "dimensions"
  | "shape"
  | "depth"
  | "capacity"
  | "frameType"
  | "linerCompatibility"
  | "poolType"
  | "voltage"
  | "batteryPlatform"
  | "toolType"
  | "kitVsBare"
  | "brushlessVsBrushed";

export type SearchStrategy =
  | "model_spec_focused"
  | "dimension_focused"
  | "tool_platform_focused";

export type DepartmentMatchTier =
  | "exact_match"
  | "high_confidence"
  | "similar_specs"
  | "compatible_alternative"
  | "rejected";

export type DepartmentRejectRuleId =
  | "wrong_screen_size"
  | "different_model_series"
  | "accessory_only"
  | "refurbished_unlabeled"
  | "unrelated_product"
  | "pool_chemicals"
  | "cover_liner_only"
  | "wrong_dimensions"
  | "frame_type_mismatch"
  | "wrong_voltage"
  | "incompatible_battery_platform"
  | "different_tool_type"
  | "bare_tool_when_kit_expected";

export type DepartmentRejectRule = {
  id: DepartmentRejectRuleId;
  /** Human-readable label for explanations. */
  label: string;
  /** When true, candidate is hard-rejected. When false, a heavy score penalty applies. */
  hardReject: boolean;
  penaltyWeight: number;
};

export type DepartmentExplanationRule = {
  tier: DepartmentMatchTier;
  /** Template with `{attribute}` placeholders resolved from match context. */
  template: string;
};

export type DepartmentScoreTierThresholds = {
  exact_match: number;
  high_confidence: number;
  similar_specs: number;
  compatible_alternative: number;
};

export type DepartmentConfig = {
  departmentId: CompareFlowDepartment;
  displayName: string;
  searchStrategy: SearchStrategy;
  productDepartment: ProductDepartment;
  requiredAttributes: DepartmentAttributeKey[];
  importantAttributes: DepartmentAttributeKey[];
  rejectRules: DepartmentRejectRule[];
  scoringWeights: Partial<Record<DepartmentAttributeKey, number>>;
  explanationRules: DepartmentExplanationRule[];
  scoreTierThresholds: DepartmentScoreTierThresholds;
};

export type ExtractedDepartmentAttributes = Partial<
  Record<DepartmentAttributeKey, string | null>
>;

export type DepartmentValidationResult = {
  rejected: boolean;
  rejectionReasons: string[];
  penalties: string[];
  /** Multiplicative score factor from soft penalties (0–1). */
  penaltyFactor: number;
};

export type DepartmentScoringResult = {
  score: number;
  tier: DepartmentMatchTier;
  attributeScores: Partial<Record<DepartmentAttributeKey, number>>;
  scoreReasons: string[];
  matchExplanation: string;
  /** Populated when strict pipeline caps score for missing required attributes. */
  missingCriticalAttributes?: DepartmentAttributeKey[];
  confidenceCappedForMissingData?: boolean;
};

export type DepartmentIntelligenceResult = {
  selectedDepartment: CompareFlowDepartment;
  sourceAttributes: ExtractedDepartmentAttributes;
  candidateAttributes: ExtractedDepartmentAttributes;
  validation: DepartmentValidationResult;
  scoring: DepartmentScoringResult | null;
};

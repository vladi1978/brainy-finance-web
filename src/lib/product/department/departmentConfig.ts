import type { CompareFlowDepartment } from "../compareFlowDepartment";
import type { DepartmentConfig } from "./types";

const ELECTRONICS_REJECT_RULES: DepartmentConfig["rejectRules"] = [
  {
    id: "wrong_screen_size",
    label: "wrong screen size",
    hardReject: true,
    penaltyWeight: 1,
  },
  {
    id: "different_model_series",
    label: "different model series",
    hardReject: false,
    penaltyWeight: 0.45,
  },
  {
    id: "accessory_only",
    label: "accessory only",
    hardReject: true,
    penaltyWeight: 1,
  },
  {
    id: "refurbished_unlabeled",
    label: "refurbished/open-box without clear labeling",
    hardReject: false,
    penaltyWeight: 0.55,
  },
  {
    id: "unrelated_product",
    label: "unrelated electronics",
    hardReject: true,
    penaltyWeight: 1,
  },
];

const POOLS_REJECT_RULES: DepartmentConfig["rejectRules"] = [
  {
    id: "pool_chemicals",
    label: "pool chemicals",
    hardReject: true,
    penaltyWeight: 1,
  },
  {
    id: "accessory_only",
    label: "accessory only",
    hardReject: true,
    penaltyWeight: 1,
  },
  {
    id: "cover_liner_only",
    label: "cover/liner when searching for a full pool",
    hardReject: true,
    penaltyWeight: 1,
  },
  {
    id: "wrong_dimensions",
    label: "wrong dimensions",
    hardReject: true,
    penaltyWeight: 1,
  },
  {
    id: "frame_type_mismatch",
    label: "incompatible frame type",
    hardReject: false,
    penaltyWeight: 0.5,
  },
];

const TOOLS_REJECT_RULES: DepartmentConfig["rejectRules"] = [
  {
    id: "wrong_voltage",
    label: "wrong voltage",
    hardReject: true,
    penaltyWeight: 1,
  },
  {
    id: "incompatible_battery_platform",
    label: "incompatible battery platform",
    hardReject: true,
    penaltyWeight: 1,
  },
  {
    id: "accessory_only",
    label: "accessory only",
    hardReject: true,
    penaltyWeight: 1,
  },
  {
    id: "different_tool_type",
    label: "different tool type",
    hardReject: true,
    penaltyWeight: 1,
  },
  {
    id: "bare_tool_when_kit_expected",
    label: "bare tool when kit expected",
    hardReject: false,
    penaltyWeight: 0.6,
  },
];

export const DEPARTMENT_CONFIGS: Record<CompareFlowDepartment, DepartmentConfig> = {
  electronics: {
    departmentId: "electronics",
    displayName: "Electronics",
    searchStrategy: "model_spec_focused",
    productDepartment: "screen",
    requiredAttributes: ["brand", "modelNumber", "screenSize", "productType"],
    importantAttributes: [
      "storage",
      "refreshRate",
      "smartTvPlatform",
      "screenSize",
      "modelNumber",
      "brand",
    ],
    rejectRules: ELECTRONICS_REJECT_RULES,
    scoringWeights: {
      brand: 12,
      modelNumber: 20,
      screenSize: 32,
      storage: 8,
      refreshRate: 6,
      smartTvPlatform: 4,
      productType: 10,
    },
    explanationRules: [
      { tier: "exact_match", template: "Same screen size and model family" },
      { tier: "high_confidence", template: "Same screen size with matching brand and specs" },
      { tier: "similar_specs", template: "Similar screen size and product type" },
      { tier: "compatible_alternative", template: "Related electronics — verify model and specs" },
      { tier: "rejected", template: "Rejected: {reason}" },
    ],
    scoreTierThresholds: {
      exact_match: 88,
      high_confidence: 72,
      similar_specs: 55,
      compatible_alternative: 38,
    },
  },
  pools_outdoor: {
    departmentId: "pools_outdoor",
    displayName: "Pools & Outdoor",
    searchStrategy: "dimension_focused",
    productDepartment: "pool",
    requiredAttributes: ["dimensions", "poolType"],
    importantAttributes: [
      "dimensions",
      "shape",
      "depth",
      "capacity",
      "frameType",
      "linerCompatibility",
      "poolType",
    ],
    rejectRules: POOLS_REJECT_RULES,
    scoringWeights: {
      dimensions: 28,
      shape: 10,
      depth: 12,
      capacity: 14,
      frameType: 12,
      linerCompatibility: 8,
      poolType: 16,
    },
    explanationRules: [
      { tier: "exact_match", template: "Dimensions match exactly" },
      { tier: "high_confidence", template: "Dimensions match closely" },
      { tier: "similar_specs", template: "Similar pool size and type" },
      { tier: "compatible_alternative", template: "Related pool/outdoor item — verify dimensions" },
      { tier: "rejected", template: "Rejected: {reason}" },
    ],
    scoreTierThresholds: {
      exact_match: 85,
      high_confidence: 70,
      similar_specs: 52,
      compatible_alternative: 36,
    },
  },
  tools: {
    departmentId: "tools",
    displayName: "Tools",
    searchStrategy: "tool_platform_focused",
    productDepartment: "tools",
    requiredAttributes: ["brand", "voltage", "toolType"],
    importantAttributes: [
      "brand",
      "voltage",
      "batteryPlatform",
      "toolType",
      "modelNumber",
      "kitVsBare",
      "brushlessVsBrushed",
    ],
    rejectRules: TOOLS_REJECT_RULES,
    scoringWeights: {
      brand: 12,
      voltage: 20,
      batteryPlatform: 18,
      toolType: 16,
      modelNumber: 14,
      kitVsBare: 10,
      brushlessVsBrushed: 6,
    },
    explanationRules: [
      { tier: "exact_match", template: "Same voltage and battery platform" },
      { tier: "high_confidence", template: "Same voltage, model, and tool type" },
      { tier: "similar_specs", template: "Same voltage and compatible tool type" },
      { tier: "compatible_alternative", template: "Related tool — verify voltage and battery platform" },
      { tier: "rejected", template: "Rejected: {reason}" },
    ],
    scoreTierThresholds: {
      exact_match: 86,
      high_confidence: 70,
      similar_specs: 54,
      compatible_alternative: 38,
    },
  },
};

export function getDepartmentConfig(
  departmentId: CompareFlowDepartment
): DepartmentConfig {
  return DEPARTMENT_CONFIGS[departmentId];
}

export function isCompareFlowDepartment(
  value: unknown
): value is CompareFlowDepartment {
  return (
    value === "electronics" ||
    value === "pools_outdoor" ||
    value === "tools"
  );
}

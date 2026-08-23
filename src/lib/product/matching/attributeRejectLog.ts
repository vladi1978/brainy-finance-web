import type { UniversalStoreId } from "../types";

/** Canonical attribute rejection categories surfaced in compare logs. */
export type AttributeRejectKind =
  | "brand_mismatch"
  | "model_mismatch"
  | "size_mismatch"
  | "storage_mismatch"
  | "bundle_mismatch"
  | "family_mismatch"
  | "category_mismatch"
  | "other";

export type AttributeRejectLogPayload = {
  candidateTitle: string;
  store: UniversalStoreId;
  relevanceScore: number;
  identityScore: number | null;
  departmentScore: number | null;
  /** Canonical rejection category for quick scanning. */
  rejectionReason: AttributeRejectKind;
  /** Original gate / validator reason string. */
  rawRejectionReason: string;
};

/**
 * Map a detailed gate reason to a canonical ATTRIBUTE_REJECT category.
 * Order matters — more specific families are checked before generic model/size rules.
 */
export function classifyAttributeRejectReason(
  raw: string | null | undefined
): AttributeRejectKind {
  if (!raw?.trim()) return "other";
  const r = raw.toLowerCase();

  if (
    r.includes("comparison_category_mismatch") ||
    r.includes("category_mismatch") ||
    r.includes("apparel_type_mismatch") ||
    r.includes("different_tool_type") ||
    r.includes("pool_chemical") ||
    r.includes("accessory_only") ||
    r.includes("accessory only") ||
    r.includes("cover_liner") ||
    r.includes("cover/liner") ||
    r.includes("unrelated_product") ||
    r.includes("unrelated electronics")
  ) {
    return "category_mismatch";
  }

  if (
    r.includes("incompatible_product_family") ||
    r.includes("model_family_mismatch") ||
    r.includes("family_mismatch") ||
    r.includes("model_family_token_mismatch") ||
    r.includes("model_family_unknown") ||
    r.includes("model_identifier_asymmetric")
  ) {
    return "family_mismatch";
  }

  if (
    (r.includes("brand") &&
      (r.includes("mismatch") ||
        r.includes("incomplete") ||
        r.includes("diff") ||
        r.includes("cap"))) ||
    r.includes("apparel_gender_mismatch") ||
    r.includes("display_panel_mismatch") ||
    r.includes("resolution_bucket_mismatch")
  ) {
    return "brand_mismatch";
  }

  if (
    r.includes("storage") ||
    r.includes("capacity_mismatch") ||
    r.includes("department_tools_voltage") ||
    r.includes("wrong_voltage") ||
    r.includes("wrong voltage") ||
    r.includes("battery_platform") ||
    r.includes("battery kit") ||
    r.includes("frame_type_mismatch")
  ) {
    return "storage_mismatch";
  }

  if (
    r.includes("pack_count") ||
    r.includes("bundle") ||
    r.includes("bare_tool") ||
    r.includes("bare tool") ||
    r.includes("critical_accessory_missing")
  ) {
    return "bundle_mismatch";
  }

  if (
    r.includes("screen_size") ||
    r.includes("size_mismatch") ||
    r.includes("wrong screen size") ||
    r.includes("wrong_dimensions") ||
    r.includes("wrong dimensions") ||
    r.includes("dimension") ||
    r.includes("shoe_size") ||
    r.includes("size_label") ||
    r.includes("diagonal") ||
    r.includes("pool_shape") ||
    r.includes("pool_dimension") ||
    r.includes("apparel_shoe_size") ||
    r.includes("apparel_size_label")
  ) {
    return "size_mismatch";
  }

  if (
    r.includes("model") ||
    r.includes("different_model") ||
    r.includes("different model") ||
    r.includes("footwear_model") ||
    r.includes("department_tools_model") ||
    r.includes("monitor_model") ||
    r.includes("tv_full_model") ||
    r.includes("condition_mismatch") ||
    r.includes("refurbished") ||
    r.includes("llm_exclusion")
  ) {
    return "model_mismatch";
  }

  return "other";
}

export function logAttributeReject(payload: AttributeRejectLogPayload): void {
  console.log("[ATTRIBUTE_REJECT]", JSON.stringify(payload));
}

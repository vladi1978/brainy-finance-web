import type { ProductCategory } from "../types";
import type { UniversalAttributeKey } from "./attributeKeys";

/**
 * Tunable per-category behavior. Add rows here (or load from config/DB later)
 * instead of branching inside the matcher.
 */
export type CategoryGateFlags = {
  /** Require same brand when both parsed (typical for panels / serialized electronics). */
  strictBrandWhenBothKnown: boolean;
  /** Reject when both sides have a parsed diagonal and values differ. */
  rejectDiagonalMismatchWhenBothKnown: boolean;
  /** Reject when exactly one diagonal is unknown — softened via scoring elsewhere when false. */
  rejectDiagonalOneSideUnknown: boolean;
  /** Reject resolution bucket mismatch when both sides resolved. */
  rejectResolutionMismatchWhenBothKnown: boolean;
  /** Reject incompatible display panel buckets when both resolved. */
  rejectDisplayPanelMismatchWhenBothKnown: boolean;
  /**
   * When reference has rich model identifiers, require fuzzy/substring model compatibility.
   * Applies to serialized CE; footwear uses `footwearModelOverlapStrict`.
   */
  enforceModelLineWhenReferenceRich: boolean;
  /** Footwear: both sides have model tokens → require at least one normalized overlap. */
  footwearModelOverlapStrict: boolean;
  /** Monitor-style: require token overlap or cross-title substring when both have model tokens. */
  monitorStyleModelGate: boolean;
  /** New/refurb/used: block refurbished/used candidate when reference reads as new. */
  rejectUsedWhenReferenceNew: boolean;
  /** Multipack count — reuse pack gate thresholds from legacy matcher. */
  rejectPackFarMismatch: boolean;
};

export type CategoryMatchProfile = {
  weights: Partial<Record<UniversalAttributeKey, number>>;
  gates: CategoryGateFlags;
  /** When true, unmatched competitor brand still earns partial credit (private-label / lifestyle goods). */
  softBrandScoring: boolean;
};

const SCREEN_GATES: CategoryGateFlags = {
  strictBrandWhenBothKnown: false,
  rejectDiagonalMismatchWhenBothKnown: true,
  rejectDiagonalOneSideUnknown: false,
  rejectResolutionMismatchWhenBothKnown: true,
  rejectDisplayPanelMismatchWhenBothKnown: true,
  enforceModelLineWhenReferenceRich: false,
  footwearModelOverlapStrict: false,
  monitorStyleModelGate: false,
  rejectUsedWhenReferenceNew: true,
  rejectPackFarMismatch: true,
};

const MONITOR_GATES: CategoryGateFlags = {
  ...SCREEN_GATES,
  rejectResolutionMismatchWhenBothKnown: false,
  rejectDisplayPanelMismatchWhenBothKnown: false,
  enforceModelLineWhenReferenceRich: false,
  monitorStyleModelGate: true,
};

const FOOTWEAR_GATES: CategoryGateFlags = {
  strictBrandWhenBothKnown: false,
  rejectDiagonalMismatchWhenBothKnown: false,
  rejectDiagonalOneSideUnknown: false,
  rejectResolutionMismatchWhenBothKnown: false,
  rejectDisplayPanelMismatchWhenBothKnown: false,
  enforceModelLineWhenReferenceRich: false,
  footwearModelOverlapStrict: true,
  monitorStyleModelGate: false,
  rejectUsedWhenReferenceNew: true,
  rejectPackFarMismatch: true,
};

const APPAREL_FAMILY_GATES: CategoryGateFlags = {
  strictBrandWhenBothKnown: false,
  rejectDiagonalMismatchWhenBothKnown: false,
  rejectDiagonalOneSideUnknown: false,
  rejectResolutionMismatchWhenBothKnown: false,
  rejectDisplayPanelMismatchWhenBothKnown: false,
  enforceModelLineWhenReferenceRich: false,
  footwearModelOverlapStrict: false,
  monitorStyleModelGate: false,
  rejectUsedWhenReferenceNew: false,
  rejectPackFarMismatch: true,
};

const GENERIC_GATES: CategoryGateFlags = {
  strictBrandWhenBothKnown: false,
  rejectDiagonalMismatchWhenBothKnown: false,
  rejectDiagonalOneSideUnknown: false,
  rejectResolutionMismatchWhenBothKnown: false,
  rejectDisplayPanelMismatchWhenBothKnown: false,
  enforceModelLineWhenReferenceRich: false,
  footwearModelOverlapStrict: false,
  monitorStyleModelGate: false,
  rejectUsedWhenReferenceNew: true,
  rejectPackFarMismatch: true,
};

/** Relative weights — the engine normalizes to sum to 100 internally. */
export const CATEGORY_MATCH_PROFILES: Record<ProductCategory, CategoryMatchProfile> = {
  tv: {
    softBrandScoring: false,
    gates: SCREEN_GATES,
    weights: {
      category_bucket: 6,
      brand: 6,
      model_line: 8,
      diagonal_inches: 18,
      resolution_tier: 12,
      display_panel: 12,
      smart_features: 4,
      condition: 6,
      title_overlap: 20,
    },
  },
  monitor: {
    softBrandScoring: false,
    gates: MONITOR_GATES,
    weights: {
      category_bucket: 6,
      brand: 20,
      model_line: 22,
      diagonal_inches: 22,
      resolution_tier: 8,
      display_panel: 6,
      condition: 6,
      title_overlap: 10,
    },
  },
  footwear: {
    softBrandScoring: true,
    gates: FOOTWEAR_GATES,
    weights: {
      category_bucket: 8,
      brand: 16,
      model_line: 26,
      size_label: 18,
      apparel_gender: 14,
      color: 10,
      condition: 4,
      title_overlap: 4,
    },
  },
  audio: {
    softBrandScoring: true,
    gates: { ...GENERIC_GATES, rejectDiagonalMismatchWhenBothKnown: false },
    weights: {
      category_bucket: 10,
      brand: 18,
      model_line: 24,
      color: 8,
      condition: 8,
      title_overlap: 32,
    },
  },
  socks: {
    softBrandScoring: true,
    gates: APPAREL_FAMILY_GATES,
    weights: {
      category_bucket: 8,
      brand: 14,
      pack_quantity: 22,
      apparel_gender: 14,
      color: 12,
      size_label: 10,
      title_overlap: 20,
    },
  },
  apparel: {
    softBrandScoring: true,
    gates: APPAREL_FAMILY_GATES,
    weights: {
      category_bucket: 8,
      brand: 16,
      pack_quantity: 18,
      apparel_gender: 18,
      color: 14,
      size_label: 12,
      title_overlap: 14,
    },
  },
  household: {
    softBrandScoring: true,
    gates: GENERIC_GATES,
    weights: {
      category_bucket: 10,
      brand: 14,
      pack_quantity: 22,
      condition: 6,
      title_overlap: 48,
    },
  },
  general: {
    softBrandScoring: true,
    gates: {
      ...GENERIC_GATES,
      /** Two uncategorized screen-like listings with different diagonals — reject. */
      rejectDiagonalMismatchWhenBothKnown: true,
    },
    weights: {
      category_bucket: 12,
      brand: 16,
      model_line: 14,
      diagonal_inches: 10,
      pack_quantity: 12,
      condition: 8,
      title_overlap: 28,
    },
  },
};

export function profileForCategory(cat: ProductCategory): CategoryMatchProfile {
  return CATEGORY_MATCH_PROFILES[cat] ?? CATEGORY_MATCH_PROFILES.general;
}

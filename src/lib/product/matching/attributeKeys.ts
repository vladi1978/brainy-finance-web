/**
 * Universal attribute axes for cross-category comparison.
 * Category-specific importance lives in {@link CATEGORY_MATCH_PROFILES}, not in gate code.
 */
export type UniversalAttributeKey =
  | "category_bucket"
  | "brand"
  | "model_line"
  | "diagonal_inches"
  | "size_label"
  | "resolution_tier"
  | "display_panel"
  | "smart_features"
  | "condition"
  | "pack_quantity"
  | "apparel_gender"
  | "color"
  /** Token overlap between normalized titles — semantic-ish recall helper */
  | "title_overlap";

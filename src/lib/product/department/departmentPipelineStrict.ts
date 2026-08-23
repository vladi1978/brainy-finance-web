/**
 * Phase 1 department pipeline — opt-in via env.
 * Default off: legacy scoring, bands, and cross-department reason lines unchanged.
 */
export const STRICT_MISSING_CRITICAL_SCORE_CAP = 65;

/** Max visible/sort score when outbound is a retailer search URL (strict mode). */
export const STRICT_SEARCH_URL_DISPLAY_SCORE_CAP = 65;

export function isDepartmentPipelineStrict(): boolean {
  return process.env.DEPARTMENT_PIPELINE_STRICT === "true";
}

/**
 * Presentation-only copy helpers for dual-statement scope clarity.
 * Does not alter comparison math, totals, or Health Scores.
 */

export const REMOVE_COMPARISON_STATEMENT_LABEL = "Remove comparison statement";

export function formatStatementPeriodRange(
  period: { start: string; end: string } | null | undefined,
  fallbackLabel?: string | null
): string {
  if (period?.start && period?.end) {
    const start = period.start <= period.end ? period.start : period.end;
    const end = period.start <= period.end ? period.end : period.start;
    return `${start} → ${end}`;
  }
  const fallback = fallbackLabel?.trim();
  if (fallback) return fallback;
  return "this uploaded statement";
}

/**
 * Persistent notice placed before single-statement sections that sit
 * outside / below the two-statement comparison panel.
 */
export function singleStatementScopeNotice(periodRange: string): string {
  return `Single-statement details below are for ${periodRange}. The chronological comparison above uses both statement periods.`;
}

export function singleStatementSectionCaption(periodRange: string): string {
  return `From the uploaded statement for ${periodRange}. This is not the chronological comparison summary.`;
}

export function askBrainySingleStatementPreface(periodRange: string): string {
  return `Based on the single statement for ${periodRange} (not the two-statement comparison):`;
}

import type { StatementPeriod } from "../types";

export function statementPeriodDays(period: StatementPeriod | null): number {
  if (!period?.start || !period?.end) return 30;
  const t0 = Date.parse(period.start + "T00:00:00Z");
  const t1 = Date.parse(period.end + "T00:00:00Z");
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return 30;
  return Math.max(1, Math.round((t1 - t0) / 86400000) + 1);
}

/** Scale a period total to an estimated annual figure. */
export function annualizePeriodAmount(
  periodTotal: number,
  period: StatementPeriod | null
): number {
  const days = statementPeriodDays(period);
  return Math.round((periodTotal * (365 / days)) * 100) / 100;
}

import type { MerchantCluster, StatementPeriod, Transaction } from "../types";

/** Strict YYYY-MM-DD that round-trips through UTC midnight. */
export function isValidTransactionDate(date: string | null | undefined): boolean {
  if (!date || typeof date !== "string") return false;
  const trimmed = date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
  const ms = Date.parse(`${trimmed}T00:00:00Z`);
  if (!Number.isFinite(ms)) return false;
  return new Date(ms).toISOString().slice(0, 10) === trimmed;
}

/**
 * Detected window = min → max of valid transaction dates.
 * Never depends on statement-line order. Returns null when no valid dates exist.
 */
export function deriveStatementPeriodFromDates(
  dates: Iterable<string>
): StatementPeriod | null {
  let minMs = Number.POSITIVE_INFINITY;
  let maxMs = Number.NEGATIVE_INFINITY;
  let start = "";
  let end = "";
  for (const raw of dates) {
    if (!isValidTransactionDate(raw)) continue;
    const date = raw.trim();
    const ms = Date.parse(`${date}T00:00:00Z`);
    if (ms < minMs) {
      minMs = ms;
      start = date;
    }
    if (ms > maxMs) {
      maxMs = ms;
      end = date;
    }
  }
  if (!start || !end || minMs > maxMs) return null;
  return { start, end };
}

export function deriveStatementPeriod(
  transactions: Transaction[]
): StatementPeriod | null {
  return deriveStatementPeriodFromDates(transactions.map((t) => t.date));
}

/** Enforce start ≤ end; omit fabricated windows. */
export function normalizeStatementPeriod(
  period: StatementPeriod | null | undefined
): StatementPeriod | null {
  if (!period) return null;
  if (
    !isValidTransactionDate(period.start) ||
    !isValidTransactionDate(period.end)
  ) {
    return null;
  }
  if (period.start <= period.end) return { start: period.start, end: period.end };
  return { start: period.end, end: period.start };
}

export function statementPeriodDays(period: StatementPeriod | null): number {
  const normalized = normalizeStatementPeriod(period);
  if (!normalized) return 30;
  const t0 = Date.parse(normalized.start + "T00:00:00Z");
  const t1 = Date.parse(normalized.end + "T00:00:00Z");
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return 30;
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

/** Monday (UTC) ISO date for the week containing `isoDate`. */
export function weekStartIso(isoDate: string): string | null {
  if (!isValidTransactionDate(isoDate)) return null;
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  const dt = new Date(ms);
  const day = dt.getUTCDay(); // 0 Sun … 6 Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(ms + mondayOffset * 86400000);
  return monday.toISOString().slice(0, 10);
}

/**
 * Chronological weekly debit totals (sorted by week start ascending).
 * Invalid dates are ignored.
 */
export function chronologicalWeeklyDebitTotals(
  clusters: MerchantCluster[]
): number[] {
  const byWeek = new Map<string, number>();
  for (const c of clusters) {
    for (const ch of c.charges) {
      if (ch.type !== "debit") continue;
      const wk = weekStartIso(ch.date);
      if (!wk) continue;
      byWeek.set(wk, (byWeek.get(wk) ?? 0) + ch.amount);
    }
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, total]) => total);
}

/**
 * Half-period spending trends require a valid ascending window with enough
 * calendar span and at least 3 chronological week buckets.
 */
export function canEmitHalfPeriodTrend(
  period: StatementPeriod | null,
  weekBucketCount: number
): boolean {
  const normalized = normalizeStatementPeriod(period);
  if (!normalized) return false;
  if (normalized.start > normalized.end) return false;
  const days = statementPeriodDays(normalized);
  // Need more than a single day and room for two comparison halves.
  if (days < 7) return false;
  if (weekBucketCount < 3) return false;
  return true;
}

export function halfPeriodAverages(weekTotals: number[]): {
  first: number;
  second: number;
} | null {
  if (weekTotals.length < 3) return null;
  const mid = Math.floor(weekTotals.length / 2);
  const first = weekTotals.slice(0, mid);
  const second = weekTotals.slice(mid);
  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
  const a0 = avg(first);
  const a1 = avg(second);
  if (a0 <= 0 && a1 <= 0) return null;
  return { first: a0, second: a1 };
}

import { annualizePeriodAmount, statementPeriodDays } from "../intelligence/period";
import type { StatementPeriod } from "../types";

/** Round currency to two decimals. */
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Scale a period total to an estimated monthly figure. */
export function periodTotalToMonthly(
  periodTotal: number,
  period: StatementPeriod | null
): number {
  const days = statementPeriodDays(period);
  return roundMoney((periodTotal / days) * 30);
}

/** Conservative fraction of recurring spend that could be saved. */
export function conservativeRecurringCut(
  monthlyAmount: number,
  fraction: number,
  cap: number
): number {
  return roundMoney(Math.min(monthlyAmount * fraction, cap));
}

export function monthlyAndYearlyFromPeriod(
  periodSavings: number,
  period: StatementPeriod | null
): { monthly: number; yearly: number } {
  const monthly = periodTotalToMonthly(periodSavings, period);
  return {
    monthly,
    yearly: annualizePeriodAmount(periodSavings, period),
  };
}

export function monthlyAndYearlyFromMonthlyAmount(monthly: number): {
  monthly: number;
  yearly: number;
} {
  const m = roundMoney(monthly);
  return { monthly: m, yearly: roundMoney(m * 12) };
}

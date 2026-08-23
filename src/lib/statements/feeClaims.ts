/**
 * Singular vs repeated fee claim copy — shared across insights, copilot, health,
 * recommendations, and trends. Repeated wording requires ≥2 distinct fee events
 * after dedupe (never multiple signals from one transaction).
 */

import type { DedupedFeeSet } from "./feeDedupe";
import { isValidTransactionDate } from "./intelligence/period";

/** Distinct fee events that carry a valid posting date. */
export function distinctDatedFeeCount(feeSet: DedupedFeeSet): number {
  const keys = new Set<string>();
  for (const e of feeSet.events) {
    if (!isValidTransactionDate(e.date)) continue;
    keys.add(`${e.date}|${e.amount.toFixed(2)}|${e.clusterId}`);
  }
  return keys.size;
}

export function isRepeatedFeeClaim(feeSet: DedupedFeeSet): boolean {
  return distinctDatedFeeCount(feeSet) >= 2;
}

export function isRepeatedOverdraftClaim(feeSet: DedupedFeeSet): boolean {
  if (!feeSet.hasOverdraft) return false;
  const keys = new Set<string>();
  for (const e of feeSet.events) {
    if (!e.isOverdraft || !isValidTransactionDate(e.date)) continue;
    keys.add(`${e.date}|${e.amount.toFixed(2)}|${e.clusterId}`);
  }
  return keys.size >= 2;
}

export function overdraftFeeTitle(feeSet: DedupedFeeSet): string {
  return isRepeatedOverdraftClaim(feeSet)
    ? "Repeated overdraft fees detected"
    : "Overdraft fee detected";
}

export function overdraftFeeExplanation(feeSet: DedupedFeeSet): string {
  if (isRepeatedOverdraftClaim(feeSet)) {
    return "Overdraft or NSF-style fees appear repeatedly on this statement.";
  }
  return "One overdraft or NSF-style fee was observed in this statement.";
}

export function overdraftNarrativeCopy(feeSet: DedupedFeeSet): {
  title: string;
  insight: string;
  recommendation: string;
} {
  if (isRepeatedOverdraftClaim(feeSet)) {
    return {
      title: "Overdraft pattern detected",
      insight:
        "Repeated overdraft or NSF-style fees appeared — these are urgent to address.",
      recommendation:
        "Enable low-balance alerts and link a small buffer account to avoid the next fee cycle.",
    };
  }
  return {
    title: "Overdraft fee detected",
    insight:
      "One overdraft or NSF-style fee was observed in this statement.",
    recommendation:
      "Enable low-balance alerts and review fee-free account options before the next cycle.",
  };
}

export function bankFeeTitle(feeSet: DedupedFeeSet): string {
  return isRepeatedFeeClaim(feeSet) ? "Bank fees detected" : "Bank fee detected";
}

export function bankFeeExplanation(feeSet: DedupedFeeSet, observedAmt: string): string {
  if (isRepeatedFeeClaim(feeSet)) {
    return "Account or service fees were identified in your debits.";
  }
  return `$${observedAmt} observed in this statement. Annual estimate unavailable.`;
}

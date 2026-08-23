/**
 * Shared evidence thresholds for recurrence claims and savings annualization.
 * Presentation and totals must not invent monthly/annual figures from thin evidence.
 */

import type { MerchantCluster, SubscriptionFrequency } from "./types";

/** Confirmed subscription / recurring-language claims need ≥2 dated debits. */
export const MIN_CHARGES_FOR_RECURRENCE = 2;

/** Weekly cadence claims need denser evidence than monthly. */
export const MIN_CHARGES_FOR_WEEKLY_CADENCE = 3;

/** Avoidable-fee annualization needs a repeated fee pattern. */
export const MIN_CHARGES_FOR_FEE_ANNUALIZATION = 2;

export const OBSERVED_ONLY_SAVINGS_NOTE =
  "Observed amount only · annual savings not estimated";

export function debitChargeCount(
  cluster: MerchantCluster | null | undefined
): number {
  if (!cluster) return 0;
  return cluster.charges.filter((c) => c.type === "debit").length;
}

/**
 * When cluster charge lists are unavailable, infer a conservative count from totals.
 */
export function resolveChargeCount(args: {
  cluster?: MerchantCluster | null;
  periodTotal: number;
  latestCharge: number;
}): number {
  const fromCluster = debitChargeCount(args.cluster);
  if (fromCluster > 0) return fromCluster;
  const latest = args.latestCharge;
  const total = args.periodTotal;
  if (!(latest > 0) || !(total > 0)) return 1;
  const ratio = total / latest;
  if (ratio < 1.2) return 1;
  return Math.max(1, Math.round(ratio));
}

export function hasRecurrenceEvidence(chargeCount: number): boolean {
  return chargeCount >= MIN_CHARGES_FOR_RECURRENCE;
}

/** Strong billing-pattern claims (Confirmed subscription / monthly cadence UI). */
export function hasConfirmedRecurrenceEvidence(args: {
  chargeCount: number;
  frequency: SubscriptionFrequency | string;
}): boolean {
  if (!hasRecurrenceEvidence(args.chargeCount)) return false;
  if (args.frequency === "weekly") {
    return args.chargeCount >= MIN_CHARGES_FOR_WEEKLY_CADENCE;
  }
  if (args.frequency === "monthly" || args.frequency === "annual") {
    return true;
  }
  // Unknown cadence with 2+ charges is still not "confirmed monthly".
  return false;
}

export function canPresentMonthlyCadence(args: {
  chargeCount: number;
  frequency: SubscriptionFrequency | string;
}): boolean {
  return hasConfirmedRecurrenceEvidence(args);
}

/** Savings may be annualized only when recurrence evidence supports a cadence. */
export function canAnnualizeFromRecurrence(args: {
  chargeCount: number;
  frequency: SubscriptionFrequency | string;
}): boolean {
  return hasConfirmedRecurrenceEvidence(args);
}

export function canAnnualizeFeePattern(chargeCount: number): boolean {
  return chargeCount >= MIN_CHARGES_FOR_FEE_ANNUALIZATION;
}

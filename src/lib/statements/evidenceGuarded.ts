/**
 * Shared evidence-gated totals and claim helpers for every statement surface.
 * Presentation cards, health, insights, copilot, recommendations, and summary
 * totals must all derive from these guards — never re-annualize independently.
 */

import type {
  MerchantCluster,
  SubscriptionFrequency,
  SubscriptionInsight,
} from "./types";
import {
  OBSERVED_ONLY_SAVINGS_NOTE,
  canAnnualizeFeePattern,
  canAnnualizeFromRecurrence,
  hasConfirmedRecurrenceEvidence,
  hasRecurrenceEvidence,
  resolveChargeCount,
} from "./recurrenceEvidence";

export {
  OBSERVED_ONLY_SAVINGS_NOTE,
  canAnnualizeFeePattern,
  canAnnualizeFromRecurrence,
  hasConfirmedRecurrenceEvidence,
  hasRecurrenceEvidence,
  resolveChargeCount,
};

export const ANNUAL_ESTIMATE_UNAVAILABLE = "Annual estimate unavailable";
export const NO_ANNUAL_ESTIMATE_AVAILABLE = "No annual estimate available";

/** Minimum earlier-period baseline ($) for a meaningful spending % change. */
export const MIN_TREND_BASELINE_AMOUNT = 25;

/** Max absolute % shown when a ratio is mathematically valid but extreme. */
export const MAX_DISPLAY_TREND_PCT = 200;

/** Duplicate posting window (days) for same/near-identical amounts. */
export const DUPLICATE_POSTING_WINDOW_DAYS = 2;

/** Near-identical amount tolerance for duplicate claims. */
export const DUPLICATE_AMOUNT_ABS_TOLERANCE = 0.5;
export const DUPLICATE_AMOUNT_REL_TOLERANCE = 0.02;

export type EvidenceSubscriptionClass = "confirmed" | "possible" | "excluded";

export function chargeCountForSubscription(
  sub: Pick<SubscriptionInsight, "clusterId" | "totalSpentInPeriod" | "amount">,
  clusters: Map<string, MerchantCluster> | MerchantCluster[]
): number {
  const map =
    clusters instanceof Map
      ? clusters
      : new Map(clusters.map((c) => [c.id, c]));
  return resolveChargeCount({
    cluster: map.get(sub.clusterId),
    periodTotal: sub.totalSpentInPeriod,
    latestCharge: sub.amount,
  });
}

export function isEvidenceConfirmedSubscription(
  sub: SubscriptionInsight,
  chargeCount: number
): boolean {
  if (!sub.flags.confirmed) return false;
  return hasConfirmedRecurrenceEvidence({
    chargeCount,
    frequency: sub.frequency,
  });
}

import { isExpectedBillSubscription } from "./expectedBills";

export function classifySubscriptionEvidence(
  sub: SubscriptionInsight,
  chargeCount: number
): EvidenceSubscriptionClass {
  // Expected bills are exclusive of subscription counts.
  if (isExpectedBillSubscription(sub)) return "excluded";
  if (isEvidenceConfirmedSubscription(sub, chargeCount)) return "confirmed";
  if (sub.trueSubscriptionScore >= 0.7 || sub.confidence >= 0.72) {
    return "possible";
  }
  return "excluded";
}

/** Zero monthly/annual equivalents when cadence evidence is insufficient. */
export function clampSubscriptionEquivalents(
  sub: SubscriptionInsight,
  chargeCount: number
): SubscriptionInsight {
  if (
    canAnnualizeFromRecurrence({
      chargeCount,
      frequency: sub.frequency,
    }) &&
    sub.flags.confirmed
  ) {
    return sub;
  }
  return {
    ...sub,
    monthlyEquivalent: 0,
    annualEquivalent: 0,
  };
}

export type GuardedSubscriptionTotals = {
  confirmedCount: number;
  possibleCount: number;
  /** Confirmed evidence-backed monthly equivalents only. */
  confirmedMonthlySpend: number;
  confirmedAnnualSpend: number;
  /** Observed period totals for possible (non-confirmed) rows. */
  possibleObservedTotal: number;
  /** Flagged confirmed subs only — monthly savings hint. */
  confirmedSavingsMonthly: number;
  confirmedSavingsAnnual: number;
};

export function buildGuardedSubscriptionTotals(
  subscriptions: SubscriptionInsight[],
  clusters: MerchantCluster[] | Map<string, MerchantCluster>
): GuardedSubscriptionTotals {
  const map =
    clusters instanceof Map
      ? clusters
      : new Map(clusters.map((c) => [c.id, c]));

  let confirmedCount = 0;
  let possibleCount = 0;
  let confirmedMonthlySpend = 0;
  let confirmedAnnualSpend = 0;
  let possibleObservedTotal = 0;
  let confirmedSavingsMonthly = 0;

  for (const sub of subscriptions) {
    const chargeCount = chargeCountForSubscription(sub, map);
    const klass = classifySubscriptionEvidence(sub, chargeCount);
    if (klass === "confirmed") {
      confirmedCount += 1;
      confirmedMonthlySpend += sub.monthlyEquivalent;
      confirmedAnnualSpend += sub.annualEquivalent;
      if (
        sub.flags.forgotten ||
        sub.flags.duplicate ||
        sub.flags.suspicious ||
        sub.flags.priceIncreased
      ) {
        confirmedSavingsMonthly += sub.monthlyEquivalent;
      }
    } else if (klass === "possible") {
      possibleCount += 1;
      possibleObservedTotal += sub.totalSpentInPeriod;
    }
  }

  return {
    confirmedCount,
    possibleCount,
    confirmedMonthlySpend: round2(confirmedMonthlySpend),
    confirmedAnnualSpend: round2(confirmedAnnualSpend),
    possibleObservedTotal: round2(possibleObservedTotal),
    confirmedSavingsMonthly: round2(confirmedSavingsMonthly),
    confirmedSavingsAnnual: round2(confirmedSavingsMonthly * 12),
  };
}

export function filterEvidenceConfirmedSubscriptions(
  subscriptions: SubscriptionInsight[],
  clusters: MerchantCluster[] | Map<string, MerchantCluster>
): SubscriptionInsight[] {
  const map =
    clusters instanceof Map
      ? clusters
      : new Map(clusters.map((c) => [c.id, c]));
  return subscriptions.filter((s) =>
    isEvidenceConfirmedSubscription(s, chargeCountForSubscription(s, map))
  );
}

export function amountsNearIdentical(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return (
    diff <= DUPLICATE_AMOUNT_ABS_TOLERANCE ||
    diff / scale <= DUPLICATE_AMOUNT_REL_TOLERANCE
  );
}

/**
 * True only when two (or more) debits share near-identical amounts and
 * same-day or narrow posting-window proximity — merchant match alone is not enough.
 */
export function hasGenuineDuplicateCharges(
  charges: Array<{ date: string; amount: number; type?: string }>
): boolean {
  const debits = charges.filter((c) => (c.type ?? "debit") === "debit");
  if (debits.length < 2) return false;
  for (let i = 0; i < debits.length; i++) {
    for (let j = i + 1; j < debits.length; j++) {
      const a = debits[i]!;
      const b = debits[j]!;
      if (!amountsNearIdentical(a.amount, b.amount)) continue;
      const t0 = Date.parse(a.date + "T00:00:00Z");
      const t1 = Date.parse(b.date + "T00:00:00Z");
      if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
      const days = Math.abs(t1 - t0) / 86400000;
      if (days <= DUPLICATE_POSTING_WINDOW_DAYS) return true;
    }
  }
  return false;
}

export type TrendPctResult = {
  /** Null when baseline is too small or ratio is not product-meaningful. */
  pct: number | null;
  first: number;
  second: number;
  useNeutralWording: boolean;
};

/**
 * Suppress % when earlier baseline is zero/tiny; optionally cap extreme ratios.
 */
export function computeMeaningfulTrendPct(
  first: number,
  second: number
): TrendPctResult {
  if (!(first > 0) || first < MIN_TREND_BASELINE_AMOUNT) {
    return {
      pct: null,
      first,
      second,
      useNeutralWording: second > first,
    };
  }
  const raw = ((second - first) / first) * 100;
  if (!Number.isFinite(raw)) {
    return { pct: null, first, second, useNeutralWording: second > first };
  }
  if (Math.abs(raw) > MAX_DISPLAY_TREND_PCT) {
    return {
      pct: null,
      first,
      second,
      useNeutralWording: second > first,
    };
  }
  return {
    pct: Math.round(raw),
    first,
    second,
    useNeutralWording: false,
  };
}

export function annualizeMonthlyAmount(monthly: number): number {
  return round2(monthly * 12);
}

/**
 * Annualize a period total only when fee (or similar) repeat cadence is supported.
 * Otherwise yearly = 0 and callers should show ANNUAL_ESTIMATE_UNAVAILABLE.
 */
export function guardedFeeAnnualization(args: {
  periodTotal: number;
  chargeCount: number;
  annualize: (periodTotal: number) => number;
}): { yearly: number; annualizeEligible: boolean; note: string | null } {
  if (!(args.periodTotal > 0)) {
    return { yearly: 0, annualizeEligible: false, note: ANNUAL_ESTIMATE_UNAVAILABLE };
  }
  if (!canAnnualizeFeePattern(args.chargeCount)) {
    return {
      yearly: 0,
      annualizeEligible: false,
      note: `${OBSERVED_ONLY_SAVINGS_NOTE}. ${ANNUAL_ESTIMATE_UNAVAILABLE}`,
    };
  }
  return {
    yearly: args.annualize(args.periodTotal),
    annualizeEligible: true,
    note: null,
  };
}

export function frequencySupportsAnnualClaim(
  frequency: SubscriptionFrequency | string,
  chargeCount: number
): boolean {
  return canAnnualizeFromRecurrence({ frequency, chargeCount });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

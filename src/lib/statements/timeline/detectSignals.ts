import type { IntelligenceInput } from "../intelligence/types";
import type { MerchantCluster, SpendingInsight } from "../types";
import type { TimelineSignal, TimelineSignalKind } from "./types";
import {
  computeMeaningfulTrendPct,
  filterEvidenceConfirmedSubscriptions,
  resolveChargeCount,
} from "../evidenceGuarded";
import { collectDedupedFees } from "../feeDedupe";
import {
  distinctDatedFeeCount,
  isRepeatedFeeClaim,
  isRepeatedOverdraftClaim,
} from "../feeClaims";
import {
  canEmitHalfPeriodTrend,
  chronologicalWeeklyDebitTotals,
  halfPeriodAverages,
} from "../intelligence/period";

function halfDelta(
  values: number[],
  period: IntelligenceInput["statementPeriod"]
): {
  pct: number | null;
  first: number;
  second: number;
  useNeutralWording: boolean;
} | null {
  if (!canEmitHalfPeriodTrend(period, values.length)) return null;
  const halves = halfPeriodAverages(values);
  if (!halves) return null;
  const { first: a0, second: a1 } = halves;
  const trend = computeMeaningfulTrendPct(a0, a1);
  return {
    pct: trend.pct,
    first: a0,
    second: a1,
    useNeutralWording: trend.useNeutralWording || trend.pct == null,
  };
}

function dominantCurrency(
  rows: Array<{ currency: string }>,
  fallback = "USD"
): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const c = r.currency?.length === 3 ? r.currency : "USD";
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  if (!counts.size) return fallback;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function spendChargeCount(
  row: SpendingInsight,
  byCluster: Map<string, MerchantCluster>
): number {
  return resolveChargeCount({
    cluster: byCluster.get(row.clusterId),
    periodTotal: row.totalSpentInPeriod,
    latestCharge: row.amount,
  });
}

function isWeekend(isoDate: string): boolean {
  const d = Date.parse(isoDate + "T00:00:00Z");
  if (!Number.isFinite(d)) return false;
  const day = new Date(d).getUTCDay();
  return day === 0 || day === 6;
}

function weekendDiningHigherLater(clusters: MerchantCluster[]): boolean {
  let first = 0;
  let second = 0;
  const dates: string[] = [];
  for (const c of clusters) {
    const blob = `${c.descriptions.join(" ")} ${c.key}`.toUpperCase();
    const dining =
      /\b(RESTAURANT|DOORDASH|UBER\s*EATS|GRUBHUB|STARBUCKS|DINER)\b/u.test(blob);
    if (!dining) continue;
    for (const ch of c.charges) {
      if (ch.type !== "debit" || !isWeekend(ch.date)) continue;
      dates.push(ch.date);
    }
  }
  if (dates.length < 2) return false;

  const sorted = [...new Set(dates)].sort();
  const mid = sorted[Math.floor(sorted.length / 2)] ?? sorted[0];
  const midT = Date.parse(mid + "T00:00:00Z");

  for (const c of clusters) {
    const blob = `${c.descriptions.join(" ")} ${c.key}`.toUpperCase();
    const dining =
      /\b(RESTAURANT|DOORDASH|UBER\s*EATS|GRUBHUB|STARBUCKS|DINER)\b/u.test(blob);
    if (!dining) continue;
    for (const ch of c.charges) {
      if (ch.type !== "debit" || !isWeekend(ch.date)) continue;
      const t = Date.parse(ch.date + "T00:00:00Z");
      if (!Number.isFinite(t) || !Number.isFinite(midT)) continue;
      if (t < midT) first += ch.amount;
      else second += ch.amount;
    }
  }
  return second > first;
}

function pushSignal(
  out: TimelineSignal[],
  signal: Omit<TimelineSignal, "currency"> & { currency?: string },
  currency: string
): void {
  if (out.some((s) => s.id === signal.id)) return;
  out.push({ ...signal, currency: signal.currency ?? currency });
}

export function detectTimelineSignals(input: IntelligenceInput): TimelineSignal[] {
  const signals: TimelineSignal[] = [];
  const { clusters, subscriptions, recurringExpenses, spendingInsights } =
    input;
  const byCluster = new Map(clusters.map((c) => [c.id, c]));
  const allSpend = [...recurringExpenses, ...spendingInsights];
  const currency = dominantCurrency([...subscriptions, ...allSpend]);
  const confirmedSubs = filterEvidenceConfirmedSubscriptions(
    subscriptions,
    byCluster
  );

  const weekTotals = chronologicalWeeklyDebitTotals(clusters);
  const weekDelta = halfDelta(weekTotals, input.statementPeriod);
  if (weekDelta && weekDelta.second > weekDelta.first) {
    pushSignal(
      signals,
      {
        id: "spending-increase-weekly",
        kind: "spending_increase",
        deltaPct: weekDelta.pct ?? undefined,
        amount: weekDelta.second - weekDelta.first,
        evidence: weekDelta.useNeutralWording
          ? "Spending was higher in the second half of detected weeks."
          : "Debit totals trend higher in the second half of detected weeks.",
        tags: ["trend", "priority"],
        baseConfidence: weekTotals.length >= 4 ? 0.75 : 0.6,
      },
      currency
    );
  } else if (weekDelta && weekDelta.pct != null && weekDelta.pct <= -12) {
    pushSignal(
      signals,
      {
        id: "spending-decrease-weekly",
        kind: "spending_decrease",
        deltaPct: Math.abs(weekDelta.pct),
        amount: weekDelta.first - weekDelta.second,
        evidence: "Overall debit activity declined in the second half of the period.",
        tags: ["trend"],
        baseConfidence: 0.65,
      },
      currency
    );
  }

  const diningKeys = ["restaurants", "cafes"] as const;
  for (const key of diningKeys) {
    const rows = allSpend.filter(
      (r) => r.categoryKey === key && spendChargeCount(r, byCluster) >= 2
    );
    const total = rows.reduce((s, r) => s + r.totalSpentInPeriod, 0);
    if (total <= 0 || rows.length < 2) continue;
    pushSignal(
      signals,
      {
        id: `category-increase-${key}`,
        kind: "spending_increase",
        categoryKey: key,
        amount: total,
        evidence: `${rows.length} ${key === "restaurants" ? "dining" : "cafe"} merchants with repeat activity.`,
        tags: ["trend"],
        baseConfidence: 0.7,
      },
      currency
    );
  }

  if (weekendDiningHigherLater(clusters)) {
    pushSignal(
      signals,
      {
        id: "weekend-dining-up",
        kind: "spending_increase",
        categoryKey: "restaurants",
        amount: 0,
        evidence:
          "Weekend dining debits look higher later in the statement — percentage omitted without a stable baseline.",
        tags: ["trend", "priority"],
        baseConfidence: 0.68,
      },
      currency
    );
  }

  const weeklyRecurring = allSpend.filter(
    (r) =>
      spendChargeCount(r, byCluster) >= 3 &&
      (r.frequency === "weekly" ||
        (r.recurringExpenseScore >= 0.5 && r.kind === "frequent_spending"))
  );
  if (weeklyRecurring.length >= 1) {
    const total = weeklyRecurring.reduce((s, r) => s + r.totalSpentInPeriod, 0);
    pushSignal(
      signals,
      {
        id: "recurring-weekly",
        kind: "recurring_weekly",
        amount: total,
        evidence: `${weeklyRecurring.length} merchant(s) show weekly or high-frequency patterns.`,
        tags: ["recurring", "trend"],
        baseConfidence: 0.72,
      },
      currency
    );
  }

  const monthlySubs = confirmedSubs.filter(
    (s) => s.frequency === "monthly" || s.frequency === "annual"
  );
  const monthlyRecurring = recurringExpenses.filter(
    (r) =>
      r.recurringExpenseScore >= 0.55 && spendChargeCount(r, byCluster) >= 2
  );
  if (monthlySubs.length + monthlyRecurring.length >= 2) {
    const total = monthlySubs.reduce((s, x) => s + x.monthlyEquivalent, 0);
    pushSignal(
      signals,
      {
        id: "recurring-monthly",
        kind: "recurring_monthly",
        amount: total,
        evidence: `${monthlySubs.length} confirmed subscriptions and ${monthlyRecurring.length} recurring expense patterns.`,
        tags: ["recurring"],
        baseConfidence: 0.8,
      },
      currency
    );
  }

  const telecom = confirmedSubs.filter((s) => s.category === "utilities");
  const telecomSpend = telecom.reduce((s, x) => s + x.monthlyEquivalent, 0);
  if (telecom.length > 0 && telecomSpend > 0) {
    pushSignal(
      signals,
      {
        id: "telecom-recurring-high",
        kind: "recurring_monthly",
        categoryKey: "utilities",
        merchantReference: telecom[0]?.normalizedName,
        amount: telecomSpend,
        evidence: "Phone, internet, or utility bills with confirmed cadence.",
        tags: ["recurring", "priority"],
        baseConfidence: Math.max(...telecom.map((t) => t.confidence), 0.7),
      },
      currency
    );
  }

  const feeSet = collectDedupedFees({
    recurringExpenses,
    spendingInsights,
    clusters,
  });
  const feeTotal = feeSet.observedPeriodTotal;
  const feeCharges = distinctDatedFeeCount(feeSet);
  if (feeSet.hasOverdraft) {
    const repeated = isRepeatedOverdraftClaim(feeSet);
    pushSignal(
      signals,
      {
        id: repeated ? "overdraft-pattern" : "overdraft-fee",
        kind: "overdraft_pattern",
        amount: feeSet.events
          .filter((e) => e.isOverdraft)
          .reduce((s, e) => s + e.amount, 0),
        evidence: repeated
          ? `${feeSet.overdraftCount} overdraft or NSF-style fee charges detected.`
          : "One overdraft or NSF-style fee was observed in this statement.",
        tags: ["fee", "priority"],
        baseConfidence: 0.9,
        eventCount: feeCharges,
      },
      currency
    );
  }

  if (isRepeatedFeeClaim(feeSet) && feeTotal > 0) {
    pushSignal(
      signals,
      {
        id: "fee-escalation",
        kind: "fee_escalation",
        amount: feeTotal,
        evidence: `Multiple fee charges (${feeCharges}) totaling ${feeTotal.toFixed(2)} in this window.`,
        tags: ["fee", "priority"],
        baseConfidence: 0.85,
        eventCount: feeCharges,
      },
      currency
    );
  } else if (feeTotal > 0 && !feeSet.hasOverdraft) {
    pushSignal(
      signals,
      {
        id: "bank-fees",
        kind: "fee_escalation",
        amount: feeTotal,
        evidence:
          "Account or service fee identified on this statement (single-period observation).",
        tags: ["fee"],
        baseConfidence: 0.75,
        eventCount: feeCharges,
      },
      currency
    );
  }

  const streaming = confirmedSubs.filter((s) => s.category === "streaming");
  const streamingMonthly = streaming.reduce((s, x) => s + x.monthlyEquivalent, 0);
  const priceUp = confirmedSubs.filter((s) => s.flags.priceIncreased);
  if (streaming.length >= 2) {
    pushSignal(
      signals,
      {
        id: "subscription-growth-streaming",
        kind: "subscription_growth",
        categoryKey: "streaming",
        amount: streamingMonthly,
        evidence: `${streaming.length} confirmed streaming services with combined recurring spend.`,
        tags: ["subscription", "trend", "priority"],
        baseConfidence: 0.78,
      },
      currency
    );
  } else if (priceUp.length > 0) {
    pushSignal(
      signals,
      {
        id: "subscription-price-increase",
        kind: "subscription_growth",
        amount: priceUp.reduce((s, x) => s + x.monthlyEquivalent, 0),
        evidence: `${priceUp.length} confirmed subscription(s) flagged for possible price increases.`,
        tags: ["subscription", "priority"],
        baseConfidence: 0.7,
      },
      currency
    );
  }

  const subCount =
    confirmedSubs.length +
    recurringExpenses.filter(
      (r) =>
        r.recurringExpenseScore >= 0.5 && spendChargeCount(r, byCluster) >= 2
    ).length;
  if (subCount >= 5) {
    pushSignal(
      signals,
      {
        id: "subscription-growth-count",
        kind: "subscription_growth",
        amount: confirmedSubs.reduce((s, x) => s + x.monthlyEquivalent, 0),
        evidence: `${subCount} confirmed recurring merchants and subscriptions detected — review for overlap.`,
        tags: ["subscription"],
        baseConfidence: 0.65,
      },
      currency
    );
  }

  for (const c of clusters) {
    const debits = c.charges.filter((ch) => ch.type === "debit");
    if (debits.length < 2) continue;
    const amounts = debits.map((d) => d.amount);
    const max = Math.max(...amounts);
    const sorted = [...amounts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? max;
    if (median > 0 && max >= median * 2.5 && max >= 75) {
      pushSignal(
        signals,
        {
          id: `spike-${c.id}`,
          kind: "unusual_spike",
          merchantReference: c.descriptions[0] ?? c.key,
          amount: max,
          evidence: `A ${max.toFixed(2)} charge is unusually large vs typical ${median.toFixed(2)} for this merchant.`,
          tags: ["priority"],
          baseConfidence: 0.62,
        },
        currency
      );
      break;
    }
  }

  const convenienceRows = allSpend.filter(
    (r) =>
      r.categoryKey === "convenience" && spendChargeCount(r, byCluster) >= 2
  );
  const convenience = convenienceRows.reduce(
    (s, r) => s + r.totalSpentInPeriod,
    0
  );
  if (convenience > 0 && convenienceRows.length >= 3) {
    pushSignal(
      signals,
      {
        id: "convenience-trend",
        kind: "spending_increase",
        categoryKey: "convenience",
        amount: convenience,
        evidence: `Convenience-store spending appears across ${convenienceRows.length} merchants in this window.`,
        tags: ["trend"],
        baseConfidence: 0.66,
      },
      currency
    );
  }

  return signals;
}

export function signalSeverity(
  kind: TimelineSignalKind
): import("../intelligence/types").InsightSeverity {
  switch (kind) {
    case "overdraft_pattern":
    case "fee_escalation":
      return "important";
    case "spending_increase":
    case "subscription_growth":
    case "unusual_spike":
      return "moderate";
    case "spending_decrease":
      return "positive";
    default:
      return "informational";
  }
}

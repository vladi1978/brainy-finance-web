import type { IntelligenceInput } from "../intelligence/types";
import type { MerchantCluster, SpendingInsight } from "../types";
import type { TimelineSignal, TimelineSignalKind } from "./types";
import {
  computeMeaningfulTrendPct,
  filterEvidenceConfirmedSubscriptions,
  hasRecurrenceEvidence,
  resolveChargeCount,
} from "../evidenceGuarded";

function weekKey(isoDate: string): string | null {
  const d = Date.parse(isoDate + "T00:00:00Z");
  if (!Number.isFinite(d)) return null;
  const dt = new Date(d);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-W${String(Math.ceil(dt.getUTCDate() / 7)).padStart(2, "0")}`;
}

function weeklyDebitTotals(clusters: MerchantCluster[]): number[] {
  const byWeek = new Map<string, number>();
  for (const c of clusters) {
    for (const ch of c.charges) {
      if (ch.type !== "debit") continue;
      const wk = weekKey(ch.date);
      if (!wk) continue;
      byWeek.set(wk, (byWeek.get(wk) ?? 0) + ch.amount);
    }
  }
  return [...byWeek.values()].sort((a, b) => a - b);
}

function halfDelta(values: number[]): {
  pct: number | null;
  first: number;
  second: number;
  useNeutralWording: boolean;
} | null {
  if (values.length < 3) return null;
  const mid = Math.floor(values.length / 2);
  const first = values.slice(0, mid);
  const second = values.slice(mid);
  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
  const a0 = avg(first);
  const a1 = avg(second);
  if (a0 <= 0 && a1 <= 0) return null;
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

  const weekTotals = weeklyDebitTotals(clusters);
  const weekDelta = halfDelta(weekTotals);
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

  const fees = allSpend.filter(
    (r) => r.categoryKey === "fees" || r.kind === "fee"
  );
  const feeTotal = fees.reduce((s, r) => s + r.totalSpentInPeriod, 0);
  const feeCharges = fees.reduce(
    (n, r) => n + spendChargeCount(r, byCluster),
    0
  );
  const overdraft = fees.filter((r) =>
    /\b(OVERDRAFT|OD\s+F|NSF)\b/ui.test(`${r.merchant} ${r.normalizedName}`)
  );
  if (overdraft.length > 0) {
    pushSignal(
      signals,
      {
        id: "overdraft-pattern",
        kind: "overdraft_pattern",
        amount: overdraft.reduce((s, r) => s + r.totalSpentInPeriod, 0),
        evidence: `${overdraft.length} overdraft or NSF-style fee charge(s) detected.`,
        tags: ["fee", "priority"],
        baseConfidence: 0.9,
      },
      currency
    );
  }

  if (hasRecurrenceEvidence(feeCharges) && feeTotal > 0) {
    pushSignal(
      signals,
      {
        id: "fee-escalation",
        kind: "fee_escalation",
        amount: feeTotal,
        evidence: `Multiple fee charges (${fees.length}) totaling ${feeTotal.toFixed(2)} in this window.`,
        tags: ["fee", "priority"],
        baseConfidence: 0.85,
      },
      currency
    );
  } else if (feeTotal > 0 && overdraft.length === 0) {
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

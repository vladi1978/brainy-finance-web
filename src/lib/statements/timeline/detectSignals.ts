import type { IntelligenceInput } from "../intelligence/types";
import type { MerchantCluster, SpendingInsight } from "../types";
import type { TimelineSignal, TimelineSignalKind } from "./types";

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

function halfDelta(values: number[]): { pct: number; first: number; second: number } | null {
  if (values.length < 3) return null;
  const mid = Math.floor(values.length / 2);
  const first = values.slice(0, mid);
  const second = values.slice(mid);
  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
  const a0 = avg(first);
  const a1 = avg(second);
  if (a0 <= 0) return null;
  return { pct: ((a1 - a0) / a0) * 100, first: a0, second: a1 };
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

function sumCategory(
  rows: SpendingInsight[],
  key: string
): number {
  return rows
    .filter((r) => r.categoryKey === key)
    .reduce((s, r) => s + r.totalSpentInPeriod, 0);
}

function isWeekend(isoDate: string): boolean {
  const d = Date.parse(isoDate + "T00:00:00Z");
  if (!Number.isFinite(d)) return false;
  const day = new Date(d).getUTCDay();
  return day === 0 || day === 6;
}

function weekendDiningDelta(clusters: MerchantCluster[]): number | null {
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
      const t = Date.parse(ch.date + "T00:00:00Z");
      if (!Number.isFinite(t)) continue;
    }
  }
  if (dates.length < 2) return null;

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
  if (first <= 0 && second <= 0) return null;
  if (first <= 0) return 100;
  return ((second - first) / first) * 100;
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
  const allSpend = [...recurringExpenses, ...spendingInsights];
  const currency = dominantCurrency([...subscriptions, ...allSpend]);

  const weekTotals = weeklyDebitTotals(clusters);
  const weekDelta = halfDelta(weekTotals);
  if (weekDelta && weekDelta.pct >= 15) {
    pushSignal(
      signals,
      {
        id: "spending-increase-weekly",
        kind: "spending_increase",
        deltaPct: Math.round(weekDelta.pct),
        amount: weekDelta.second - weekDelta.first,
        evidence: "Debit totals trend higher in the second half of detected weeks.",
        tags: ["trend", "priority"],
        baseConfidence: weekTotals.length >= 4 ? 0.75 : 0.6,
      },
      currency
    );
  } else if (weekDelta && weekDelta.pct <= -12) {
    pushSignal(
      signals,
      {
        id: "spending-decrease-weekly",
        kind: "spending_decrease",
        deltaPct: Math.round(Math.abs(weekDelta.pct)),
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
    const total = sumCategory(allSpend, key);
    if (total <= 0) continue;
    const rows = allSpend.filter((r) => r.categoryKey === key);
    if (rows.length < 2) continue;
    pushSignal(
      signals,
      {
        id: `category-increase-${key}`,
        kind: "spending_increase",
        categoryKey: key,
        amount: total,
        deltaPct: rows.length >= 3 ? 18 : 12,
        evidence: `${rows.length} ${key === "restaurants" ? "dining" : "cafe"} merchants with repeat activity.`,
        tags: ["trend"],
        baseConfidence: 0.7,
      },
      currency
    );
  }

  const weekendDining = weekendDiningDelta(clusters);
  if (weekendDining != null && weekendDining >= 10) {
    pushSignal(
      signals,
      {
        id: "weekend-dining-up",
        kind: "spending_increase",
        categoryKey: "restaurants",
        deltaPct: Math.round(weekendDining),
        amount: 0,
        evidence: "Weekend dining debits are higher in the latter part of the statement.",
        tags: ["trend", "priority"],
        baseConfidence: 0.68,
      },
      currency
    );
  }

  const weeklyRecurring = allSpend.filter(
    (r) =>
      r.frequency === "weekly" ||
      (r.recurringExpenseScore >= 0.5 && r.kind === "frequent_spending")
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

  const monthlySubs = subscriptions.filter(
    (s) => s.frequency === "monthly" || s.frequency === "annual"
  );
  const monthlyRecurring = recurringExpenses.filter(
    (r) => r.recurringExpenseScore >= 0.55
  );
  if (monthlySubs.length + monthlyRecurring.length >= 2) {
    const total =
      monthlySubs.reduce((s, x) => s + x.monthlyEquivalent, 0) +
      monthlyRecurring.reduce((s, r) => s + r.totalSpentInPeriod, 0);
    pushSignal(
      signals,
      {
        id: "recurring-monthly",
        kind: "recurring_monthly",
        amount: total,
        evidence: `${monthlySubs.length} subscriptions and ${monthlyRecurring.length} recurring expense patterns.`,
        tags: ["recurring"],
        baseConfidence: 0.8,
      },
      currency
    );
  }

  const telecom = subscriptions.filter((s) => s.category === "utilities");
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
        evidence: "Phone, internet, or utility bills rank among top recurring debits.",
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

  if (fees.length >= 2 && feeTotal > 0) {
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
        evidence: "Account or service fees identified on this statement.",
        tags: ["fee"],
        baseConfidence: 0.75,
      },
      currency
    );
  }

  const streaming = subscriptions.filter((s) => s.category === "streaming");
  const streamingMonthly = streaming.reduce((s, x) => s + x.monthlyEquivalent, 0);
  const priceUp = subscriptions.filter((s) => s.flags.priceIncreased);
  if (streaming.length >= 2) {
    const growthPct =
      priceUp.length > 0
        ? 18
        : streaming.length >= 3
          ? 12
          : 8;
    pushSignal(
      signals,
      {
        id: "subscription-growth-streaming",
        kind: "subscription_growth",
        categoryKey: "streaming",
        deltaPct: growthPct,
        amount: streamingMonthly,
        evidence: `${streaming.length} streaming services with combined recurring spend.`,
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
        deltaPct: 15,
        amount: priceUp.reduce((s, x) => s + x.monthlyEquivalent, 0),
        evidence: `${priceUp.length} subscription(s) flagged for possible price increases.`,
        tags: ["subscription", "priority"],
        baseConfidence: 0.7,
      },
      currency
    );
  }

  const subCount =
    subscriptions.length +
    recurringExpenses.filter((r) => r.recurringExpenseScore >= 0.5).length;
  if (subCount >= 5) {
    pushSignal(
      signals,
      {
        id: "subscription-growth-count",
        kind: "subscription_growth",
        amount: subscriptions.reduce((s, x) => s + x.monthlyEquivalent, 0),
        evidence: `${subCount} recurring merchants and subscriptions detected — review for overlap.`,
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

  const convenience = sumCategory(allSpend, "convenience");
  if (convenience > 0) {
    const count = allSpend.filter((r) => r.categoryKey === "convenience").length;
    if (count >= 3) {
      pushSignal(
        signals,
        {
          id: "convenience-trend",
          kind: "spending_increase",
          categoryKey: "convenience",
          amount: convenience,
          deltaPct: 14,
          evidence: `Convenience-store spending appears ${count} times in this window.`,
          tags: ["trend"],
          baseConfidence: 0.66,
        },
        currency
      );
    }
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

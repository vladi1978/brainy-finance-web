import type { FinancialInsightCard, IntelligenceInput } from "./types";
import { annualizePeriodAmount } from "./period";

function sumCategory(
  rows: IntelligenceInput["recurringExpenses"],
  key: string
): { count: number; total: number } {
  let count = 0;
  let total = 0;
  for (const r of rows) {
    if (r.categoryKey !== key) continue;
    const debits = r.totalSpentInPeriod > 0 ? 1 : 0;
    count += debits;
    total += r.totalSpentInPeriod;
  }
  const clusters = rows.filter((r) => r.categoryKey === key);
  const txnEstimate = clusters.reduce(
    (s, r) => s + (r.recurringExpenseScore >= 0.45 ? 2 : 1),
    0
  );
  return { count: Math.max(count, txnEstimate), total };
}

function weeklyDebitTotals(
  clusters: IntelligenceInput["clusters"]
): number[] {
  const byWeek = new Map<string, number>();
  for (const c of clusters) {
    for (const ch of c.charges) {
      if (ch.type !== "debit") continue;
      const d = Date.parse(ch.date + "T00:00:00Z");
      if (!Number.isFinite(d)) continue;
      const week = new Date(d).toISOString().slice(0, 10).slice(0, 7) + "-W" + String(Math.ceil(new Date(d).getUTCDate() / 7));
      byWeek.set(week, (byWeek.get(week) ?? 0) + ch.amount);
    }
  }
  return [...byWeek.values()].sort((a, b) => a - b);
}

function hasRisingWeeklyPattern(weekTotals: number[]): boolean {
  if (weekTotals.length < 3) return false;
  const first = weekTotals.slice(0, Math.floor(weekTotals.length / 2));
  const second = weekTotals.slice(Math.floor(weekTotals.length / 2));
  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
  return avg(second) > avg(first) * 1.2;
}

export function buildInsightsFeed(input: IntelligenceInput): FinancialInsightCard[] {
  const cards: FinancialInsightCard[] = [];
  const { statementPeriod, subscriptions, recurringExpenses, spendingInsights, clusters } =
    input;

  const allSpend = [...recurringExpenses, ...spendingInsights];
  const convenience = sumCategory(allSpend, "convenience");
  if (convenience.total > 0 && convenience.count >= 3) {
    cards.push({
      id: "convenience-up",
      title: "Frequent convenience purchases",
      explanation: `Convenience-store spending appears ${convenience.count >= 4 ? "often" : "repeatedly"} in this statement window.`,
      severity: "moderate",
      annualImpact: annualizePeriodAmount(convenience.total, statementPeriod),
    });
  }

  const streaming = subscriptions.filter((s) => s.category === "streaming");
  if (streaming.length >= 2) {
    cards.push({
      id: "streaming-load",
      title: "Multiple streaming subscriptions",
      explanation: `${streaming.length} streaming services detected with combined recurring spend.`,
      severity: streaming.length >= 4 ? "moderate" : "informational",
      annualImpact: streaming.reduce((s, x) => s + x.annualEquivalent, 0),
    });
  } else if (streaming.length === 1) {
    cards.push({
      id: "streaming-single",
      title: "Streaming subscription active",
      explanation: `${streaming[0].normalizedName} is classified as a recurring streaming bill.`,
      severity: "informational",
      annualImpact: streaming[0].annualEquivalent,
    });
  }

  const fees = allSpend.filter(
    (r) => r.categoryKey === "fees" || r.kind === "fee"
  );
  const feeTotal = fees.reduce((s, r) => s + r.totalSpentInPeriod, 0);
  if (feeTotal > 0) {
    const overdraft = fees.some((r) =>
      /\b(OVERDRAFT|OD\s+F|NSF)\b/ui.test(
        `${r.merchant} ${r.normalizedName}`
      )
    );
    cards.push({
      id: overdraft ? "overdraft-fees" : "bank-fees",
      title: overdraft
        ? "Repeated overdraft fees detected"
        : "Bank fees detected",
      explanation: overdraft
        ? "Overdraft or NSF-style fees appear on this statement."
        : "Account or service fees were identified in your debits.",
      severity: "important",
      annualImpact: annualizePeriodAmount(feeTotal, statementPeriod),
    });
  }

  const dining = allSpend.filter(
    (r) =>
      r.categoryKey === "restaurants" ||
      r.categoryKey === "cafes" ||
      /\b(DOORDASH|UBER\s*EATS|GRUBHUB)\b/ui.test(r.normalizedName)
  );
  const diningTotal = dining.reduce((s, r) => s + r.totalSpentInPeriod, 0);
  if (dining.length >= 2 && diningTotal > 0) {
    const delivery = dining.some((r) =>
      /\b(DOORDASH|UBER\s*EATS|GRUBHUB)\b/ui.test(r.normalizedName)
    );
    cards.push({
      id: delivery ? "delivery-activity" : "dining-activity",
      title: delivery
        ? "Frequent food delivery activity"
        : "Dining spending trend",
      explanation: delivery
        ? "Delivery platforms show repeated charges in this period."
        : "Restaurant and cafe merchants appear multiple times.",
      severity: "moderate",
      annualImpact: annualizePeriodAmount(diningTotal, statementPeriod),
    });
  }

  const retail = allSpend.filter((r) => r.categoryKey === "retail");
  const retailTotal = retail.reduce((s, r) => s + r.totalSpentInPeriod, 0);
  if (retail.length >= 2 && retailTotal > 0) {
    cards.push({
      id: "retail-recurring",
      title: "Recurring retail spending detected",
      explanation: `${retail.length} retail merchants show repeat purchase patterns.`,
      severity: "informational",
      annualImpact: annualizePeriodAmount(retailTotal, statementPeriod),
    });
  }

  const insurance = subscriptions.filter((s) => s.category === "insurance");
  if (insurance.length > 0) {
    const annual = insurance.reduce((s, x) => s + x.annualEquivalent, 0);
    if (annual >= 1200) {
      cards.push({
        id: "insurance-high",
        title: "Insurance cost appears high",
        explanation: `Insurance-related recurring bills total about ${insurance.length} service(s) in this window.`,
        severity: "moderate",
        annualImpact: annual,
      });
    }
  }

  const recurringMerchants =
    recurringExpenses.filter((r) => r.recurringExpenseScore >= 0.5).length +
    subscriptions.length;
  if (recurringMerchants >= 4) {
    cards.push({
      id: "many-recurring",
      title: "Multiple recurring merchants found",
      explanation: `${recurringMerchants} merchants show subscription or repeat-spend patterns.`,
      severity: "informational",
    });
  }

  const weekTotals = weeklyDebitTotals(clusters);
  if (hasRisingWeeklyPattern(weekTotals)) {
    cards.push({
      id: "weekly-rise",
      title: "Rising weekly spending pattern",
      explanation:
        "Debit totals trend higher in the second half of the detected weeks.",
      severity: "moderate",
    });
  }

  const aiSubs = subscriptions.filter((s) => s.category === "ai_tools");
  const aiSpend = allSpend.filter((r) =>
    /\b(OPEN\s*AI|OPENAI|CHATGPT|ANTHROPIC|CURSOR)\b/ui.test(r.normalizedName)
  );
  if (aiSubs.length > 0 || aiSpend.length > 0) {
    const total =
      aiSubs.reduce((s, x) => s + x.annualEquivalent, 0) +
      aiSpend.reduce((s, r) => s + r.totalSpentInPeriod, 0);
    cards.push({
      id: "ai-tools",
      title: "AI tools recurring spend",
      explanation: "AI or developer-tool subscriptions appear on this statement.",
      severity: "informational",
      annualImpact: total > 0 ? annualizePeriodAmount(total, statementPeriod) : undefined,
    });
  }

  if (subscriptions.length > 0 && feeTotal === 0) {
    const stable = subscriptions.filter((s) => s.flags.confirmed).length;
    if (stable >= 2) {
      cards.push({
        id: "subs-stable",
        title: "Recurring bills look stable",
        explanation: `${stable} subscriptions show strong confidence and fit scores.`,
        severity: "positive",
      });
    }
  }

  const severityOrder: Record<FinancialInsightCard["severity"], number> = {
    important: 0,
    moderate: 1,
    informational: 2,
    positive: 3,
  };

  return cards.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );
}

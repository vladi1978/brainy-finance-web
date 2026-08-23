import type { FinancialInsightCard, IntelligenceInput } from "./types";
import { annualizePeriodAmount } from "./period";
import {
  ANNUAL_ESTIMATE_UNAVAILABLE,
  chargeCountForSubscription,
  filterEvidenceConfirmedSubscriptions,
  hasRecurrenceEvidence,
  isEvidenceConfirmedSubscription,
  resolveChargeCount,
} from "../evidenceGuarded";
import { collectDedupedFees } from "../feeDedupe";
import {
  bankFeeExplanation,
  bankFeeTitle,
  isRepeatedFeeClaim,
  overdraftFeeExplanation,
  overdraftFeeTitle,
} from "../feeClaims";
import {
  INSURANCE_OBSERVED_NEUTRAL,
  isInsuranceRelatedText,
} from "../insuranceClassify";
import {
  canEmitHalfPeriodTrend,
  chronologicalWeeklyDebitTotals,
  halfPeriodAverages,
} from "./period";

function sumCategory(
  rows: IntelligenceInput["recurringExpenses"],
  key: string,
  clusters: Map<string, import("../types").MerchantCluster>
): { count: number; total: number; chargeCount: number } {
  const matched = rows.filter((r) => r.categoryKey === key);
  let total = 0;
  let chargeCount = 0;
  for (const r of matched) {
    total += r.totalSpentInPeriod;
    chargeCount += resolveChargeCount({
      cluster: clusters.get(r.clusterId),
      periodTotal: r.totalSpentInPeriod,
      latestCharge: r.amount,
    });
  }
  return { count: matched.length, total, chargeCount };
}

function hasRisingWeeklyPattern(
  weekTotals: number[],
  period: IntelligenceInput["statementPeriod"]
): boolean {
  if (!canEmitHalfPeriodTrend(period, weekTotals.length)) return false;
  const halves = halfPeriodAverages(weekTotals);
  if (!halves || halves.first <= 0) return false;
  return halves.second > halves.first * 1.2;
}

export function buildInsightsFeed(input: IntelligenceInput): FinancialInsightCard[] {
  const cards: FinancialInsightCard[] = [];
  const { statementPeriod, subscriptions, recurringExpenses, spendingInsights, clusters } =
    input;
  const byCluster = new Map(clusters.map((c) => [c.id, c]));

  const allSpend = [...recurringExpenses, ...spendingInsights];
  const confirmedSubs = filterEvidenceConfirmedSubscriptions(
    subscriptions,
    byCluster
  );

  const convenience = sumCategory(allSpend, "convenience", byCluster);
  if (
    convenience.total > 0 &&
    convenience.count >= 3 &&
    hasRecurrenceEvidence(convenience.chargeCount)
  ) {
    cards.push({
      id: "convenience-up",
      title: "Frequent convenience purchases",
      explanation: `Convenience-store spending appears ${convenience.count >= 4 ? "often" : "repeatedly"} in this statement window. ${ANNUAL_ESTIMATE_UNAVAILABLE}.`,
      severity: "moderate",
    });
  }

  const streamingAll = subscriptions.filter((s) => s.category === "streaming");
  const streamingConfirmed = streamingAll.filter((s) =>
    isEvidenceConfirmedSubscription(
      s,
      chargeCountForSubscription(s, byCluster)
    )
  );
  const streamingPossible = streamingAll.filter(
    (s) => !streamingConfirmed.includes(s)
  );

  if (streamingConfirmed.length >= 2) {
    cards.push({
      id: "streaming-load",
      title: "Multiple streaming subscriptions",
      explanation: `${streamingConfirmed.length} confirmed streaming services with evidence-backed recurring spend.`,
      severity: streamingConfirmed.length >= 4 ? "moderate" : "informational",
      annualImpact: streamingConfirmed.reduce((s, x) => s + x.annualEquivalent, 0),
    });
  } else if (streamingConfirmed.length === 1) {
    cards.push({
      id: "streaming-single",
      title: "Confirmed streaming subscription",
      explanation: `${streamingConfirmed[0]!.normalizedName} shows a confirmed recurring billing pattern.`,
      severity: "informational",
      annualImpact: streamingConfirmed[0]!.annualEquivalent,
    });
  } else if (streamingPossible.length === 1) {
    const s = streamingPossible[0]!;
    cards.push({
      id: "streaming-possible",
      title: "Possible subscription · recurrence not confirmed",
      explanation: `${s.normalizedName}: observed ${s.totalSpentInPeriod.toFixed(2)} ${s.currency} in this window. ${ANNUAL_ESTIMATE_UNAVAILABLE}.`,
      severity: "informational",
    });
  } else if (streamingPossible.length >= 2) {
    cards.push({
      id: "streaming-possible-multi",
      title: "Possible streaming subscriptions",
      explanation: `${streamingPossible.length} streaming merchants without confirmed cadence. ${ANNUAL_ESTIMATE_UNAVAILABLE}.`,
      severity: "informational",
    });
  }

  const fees = collectDedupedFees({
    recurringExpenses,
    spendingInsights,
    clusters,
  });
  if (fees.observedPeriodTotal > 0) {
    const amt = fees.observedPeriodTotal.toFixed(2);
    cards.push({
      id: fees.hasOverdraft ? "overdraft-fees" : "bank-fees",
      title: fees.hasOverdraft
        ? overdraftFeeTitle(fees)
        : bankFeeTitle(fees),
      explanation: fees.hasOverdraft
        ? overdraftFeeExplanation(fees)
        : bankFeeExplanation(fees, amt),
      severity: "important",
      annualImpact: isRepeatedFeeClaim(fees)
        ? annualizePeriodAmount(fees.observedPeriodTotal, statementPeriod)
        : undefined,
    });
  }

  const dining = allSpend.filter((r) => {
    const n = resolveChargeCount({
      cluster: byCluster.get(r.clusterId),
      periodTotal: r.totalSpentInPeriod,
      latestCharge: r.amount,
    });
    if (n < 2) return false;
    return (
      r.categoryKey === "restaurants" ||
      r.categoryKey === "cafes" ||
      /\b(DOORDASH|UBER\s*EATS|GRUBHUB)\b/ui.test(r.normalizedName)
    );
  });
  const diningTotal = dining.reduce((s, r) => s + r.totalSpentInPeriod, 0);
  if (dining.length >= 2 && diningTotal > 0) {
    const delivery = dining.some((r) =>
      /\b(DOORDASH|UBER\s*EATS|GRUBHUB)\b/ui.test(r.normalizedName)
    );
    cards.push({
      id: delivery ? "delivery-activity" : "dining-activity",
      title: delivery
        ? "Frequent food delivery activity"
        : "Dining spending pattern",
      explanation: delivery
        ? `Delivery platforms show repeated charges in this period. ${ANNUAL_ESTIMATE_UNAVAILABLE}.`
        : `Restaurant and cafe merchants appear multiple times. ${ANNUAL_ESTIMATE_UNAVAILABLE}.`,
      severity: "moderate",
    });
  }

  const retail = allSpend.filter((r) => {
    const n = resolveChargeCount({
      cluster: byCluster.get(r.clusterId),
      periodTotal: r.totalSpentInPeriod,
      latestCharge: r.amount,
    });
    return r.categoryKey === "retail" && n >= 2;
  });
  const retailTotal = retail.reduce((s, r) => s + r.totalSpentInPeriod, 0);
  if (retail.length >= 2 && retailTotal > 0) {
    cards.push({
      id: "retail-recurring",
      title: "Repeated retail spending",
      explanation: `${retail.length} retail merchants show repeat purchase patterns. ${ANNUAL_ESTIMATE_UNAVAILABLE}.`,
      severity: "informational",
    });
  }

  // Insurance: neutral observation only — never "cost appears high" or invented savings.
  const insuranceSubs = subscriptions.filter((s) => s.category === "insurance");
  const insuranceSpend = allSpend.filter((r) =>
    isInsuranceRelatedText(
      `${r.categoryKey} ${r.categoryLabel} ${r.normalizedName} ${r.merchant}`
    )
  );
  if (insuranceSubs.length > 0 || insuranceSpend.length > 0) {
    cards.push({
      id: "insurance-observed",
      title: "Insurance payment observed",
      explanation: INSURANCE_OBSERVED_NEUTRAL,
      severity: "informational",
    });
  }

  const recurringMerchants =
    recurringExpenses.filter((r) => {
      const n = resolveChargeCount({
        cluster: byCluster.get(r.clusterId),
        periodTotal: r.totalSpentInPeriod,
        latestCharge: r.amount,
      });
      return r.recurringExpenseScore >= 0.5 && n >= 2;
    }).length + confirmedSubs.length;
  if (recurringMerchants >= 4) {
    cards.push({
      id: "many-recurring",
      title: "Multiple recurring merchants found",
      explanation: `${recurringMerchants} merchants show confirmed subscription or repeat-spend patterns.`,
      severity: "informational",
    });
  }

  const weekTotals = chronologicalWeeklyDebitTotals(clusters);
  if (hasRisingWeeklyPattern(weekTotals, statementPeriod)) {
    cards.push({
      id: "weekly-rise",
      title: "Spending was higher in the second half",
      explanation:
        "Debit totals look higher later in the detected weeks — percentage change is omitted when the baseline is too small to interpret.",
      severity: "moderate",
    });
  }

  const aiSubs = confirmedSubs.filter((s) => s.category === "ai_tools");
  const aiSpend = allSpend.filter((r) => {
    const n = resolveChargeCount({
      cluster: byCluster.get(r.clusterId),
      periodTotal: r.totalSpentInPeriod,
      latestCharge: r.amount,
    });
    return (
      n >= 2 &&
      /\b(OPEN\s*AI|OPENAI|CHATGPT|ANTHROPIC|CURSOR)\b/ui.test(r.normalizedName)
    );
  });
  if (aiSubs.length > 0 || aiSpend.length > 0) {
    const annualFromSubs = aiSubs.reduce((s, x) => s + x.annualEquivalent, 0);
    cards.push({
      id: "ai-tools",
      title: "AI tools recurring spend",
      explanation:
        aiSubs.length > 0
          ? "Confirmed AI or developer-tool subscriptions appear on this statement."
          : `AI or developer-tool charges appear, without confirmed annualization. ${ANNUAL_ESTIMATE_UNAVAILABLE}.`,
      severity: "informational",
      annualImpact: annualFromSubs > 0 ? annualFromSubs : undefined,
    });
  }

  if (confirmedSubs.length >= 2 && fees.observedPeriodTotal === 0) {
    cards.push({
      id: "subs-stable",
      title: "Recurring bills look stable",
      explanation: `${confirmedSubs.length} subscriptions show confirmed cadence evidence.`,
      severity: "positive",
    });
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

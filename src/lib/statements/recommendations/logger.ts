import type { ActionRecommendation } from "./types";

export function logRecommendationGeneration(
  items: ActionRecommendation[],
  meta: {
    subscriptionCount: number;
    recurringExpenseCount: number;
    spendingInsightCount: number;
    currency: string;
    totalMonthlySavings: number;
  }
): void {
  console.log("[recommendations/engine] generated", {
    count: items.length,
    totalMonthlySavings: meta.totalMonthlySavings,
    currency: meta.currency,
    subscriptionCount: meta.subscriptionCount,
    recurringExpenseCount: meta.recurringExpenseCount,
    spendingInsightCount: meta.spendingInsightCount,
    actions: items.map((r) => ({
      id: r.id,
      actionType: r.actionType,
      severity: r.severity,
      confidence: Math.round(r.confidence * 100),
      monthlySavings: r.estimatedMonthlySavings,
      merchantReference: r.merchantReference ?? null,
    })),
  });
}

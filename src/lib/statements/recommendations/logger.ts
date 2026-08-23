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
  const production = process.env.NODE_ENV === "production";
  console.log("[recommendations/engine] generated", {
    count: items.length,
    currency: meta.currency,
    subscriptionCount: meta.subscriptionCount,
    recurringExpenseCount: meta.recurringExpenseCount,
    spendingInsightCount: meta.spendingInsightCount,
    ...(production
      ? {}
      : { totalMonthlySavings: meta.totalMonthlySavings }),
    actions: items.map((r) => ({
      id: r.id,
      actionType: r.actionType,
      severity: r.severity,
      confidence: Math.round(r.confidence * 100),
      ...(production
        ? {}
        : {
            monthlySavings: r.estimatedMonthlySavings,
            merchantReference: r.merchantReference ?? null,
          }),
    })),
  });
}

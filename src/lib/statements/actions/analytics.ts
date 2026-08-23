import type { FinancialActionAnalyticsEvent } from "./types";

export function logFinancialAction(event: FinancialActionAnalyticsEvent): void {
  const production = process.env.NODE_ENV === "production";
  console.log("[statements/actions]", {
    recommendationId: event.recommendationId,
    actionType: event.actionType,
    actionId: event.actionId,
    status: event.status,
    severity: event.severity,
    confidence: Math.round(event.confidence * 100),
    ...(production
      ? {}
      : {
          merchant: event.merchant ?? null,
          estimatedMonthlySavings: event.estimatedMonthlySavings,
        }),
  });
}

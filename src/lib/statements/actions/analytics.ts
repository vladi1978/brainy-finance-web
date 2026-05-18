import type { FinancialActionAnalyticsEvent } from "./types";

export function logFinancialAction(event: FinancialActionAnalyticsEvent): void {
  console.log("[statements/actions]", {
    recommendationId: event.recommendationId,
    actionType: event.actionType,
    actionId: event.actionId,
    status: event.status,
    merchant: event.merchant ?? null,
    estimatedMonthlySavings: event.estimatedMonthlySavings,
    severity: event.severity,
    confidence: Math.round(event.confidence * 100),
  });
}

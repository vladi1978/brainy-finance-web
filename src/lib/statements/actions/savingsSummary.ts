import type { AcceptedSavingsSummary, EnrichedRecommendation } from "./types";

export function computeAcceptedSavings(
  items: EnrichedRecommendation[]
): AcceptedSavingsSummary {
  const accepted = items.filter((r) => r.status === "accepted");
  if (!accepted.length) {
    return { count: 0, monthly: 0, yearly: 0, currency: "USD" };
  }
  const currency = accepted[0]?.currency ?? "USD";
  return {
    count: accepted.length,
    monthly: accepted.reduce((s, r) => s + r.estimatedMonthlySavings, 0),
    yearly: accepted.reduce((s, r) => s + r.estimatedYearlySavings, 0),
    currency,
  };
}

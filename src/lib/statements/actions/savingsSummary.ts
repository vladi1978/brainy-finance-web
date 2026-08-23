import type { SavingsLedgerSummary, EnrichedRecommendation } from "./types";

export function computeAcceptedSavings(
  items: EnrichedRecommendation[]
): SavingsLedgerSummary {
  const planned = items.filter((r) => r.status === "accepted");
  const confirmed = items.filter((r) => r.status === "completed");
  const currency = confirmed[0]?.currency ?? planned[0]?.currency ?? "USD";
  return {
    plannedCount: planned.length,
    plannedMonthly: planned.reduce((s, r) => s + r.estimatedMonthlySavings, 0),
    plannedYearly: planned.reduce((s, r) => s + r.estimatedYearlySavings, 0),
    confirmedCount: confirmed.length,
    confirmedMonthly: confirmed.reduce((s, r) => s + r.estimatedMonthlySavings, 0),
    confirmedYearly: confirmed.reduce((s, r) => s + r.estimatedYearlySavings, 0),
    currency,
  };
}

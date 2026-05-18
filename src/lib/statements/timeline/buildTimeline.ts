import type { IntelligenceInput } from "../intelligence/types";
import { detectTimelineSignals } from "./detectSignals";
import { narrativeForSignal } from "./narratives";
import {
  estimateYearlyPotential,
  toCopilotFeedItem,
} from "./scorePriority";
import type { CopilotTimelineResult } from "./types";

function dominantCurrency(
  input: IntelligenceInput,
  fallback = "USD"
): string {
  const pool = [
    ...input.subscriptions,
    ...input.recurringExpenses,
    ...input.spendingInsights,
  ];
  const counts = new Map<string, number>();
  for (const r of pool) {
    const c = r.currency?.length === 3 ? r.currency : "USD";
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  if (!counts.size) return fallback;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function buildCopilotTimeline(
  input: IntelligenceInput,
  options?: { existingYearlySavings?: number }
): CopilotTimelineResult {
  const signals = detectTimelineSignals(input);
  const feed = signals
    .map((s) => toCopilotFeedItem(s, input, narrativeForSignal(s)))
    .sort((a, b) => b.priority.overall - a.priority.overall);

  const behaviorTrends = feed.filter((i) => i.tags.includes("trend"));
  const topPriorities = [...feed]
    .sort((a, b) => b.priority.overall - a.priority.overall)
    .slice(0, 5);

  const existingYearly = options?.existingYearlySavings ?? 0;
  const yearlyOptimizationPotential = estimateYearlyPotential(
    feed,
    existingYearly
  );

  return {
    feed,
    topPriorities,
    behaviorTrends,
    yearlyOptimizationPotential,
    currency: dominantCurrency(input),
    generatedAt: new Date().toISOString(),
  };
}

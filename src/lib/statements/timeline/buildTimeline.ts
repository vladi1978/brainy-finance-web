import type { IntelligenceInput } from "../intelligence/types";
import { detectTimelineSignals } from "./detectSignals";
import { narrativeForSignal } from "./narratives";
import type { FinancialIntelligenceSummary } from "../intelligence/financialCategories";
import {
  estimateOptimizationRange,
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
  options?: { financialSummary?: FinancialIntelligenceSummary }
): CopilotTimelineResult {
  const signals = detectTimelineSignals(input);
  const feed = signals
    .map((s) => toCopilotFeedItem(s, input, narrativeForSignal(s)))
    .sort((a, b) => b.priority.overall - a.priority.overall);

  const behaviorTrends = feed.filter((i) => i.tags.includes("trend"));
  const topPriorities = [...feed]
    .sort((a, b) => b.priority.overall - a.priority.overall)
    .slice(0, 5);

  const feedOptimization = estimateOptimizationRange(feed);
  const summaryOptimization = options?.financialSummary?.optimization;
  const optimizationPotential = {
    yearlyLow: Math.max(
      feedOptimization.yearlyLow,
      summaryOptimization?.yearlyLow ?? 0
    ),
    yearlyHigh: Math.max(
      feedOptimization.yearlyHigh,
      summaryOptimization?.yearlyHigh ?? 0
    ),
    confidence: Math.max(
      feedOptimization.confidence,
      summaryOptimization?.confidence ?? 0
    ),
  };
  const actionableYearlySavings =
    options?.financialSummary?.actionableYearly ?? 0;
  const yearlyOptimizationPotential = estimateYearlyPotential(feed, 0);

  return {
    feed,
    topPriorities,
    behaviorTrends,
    yearlyOptimizationPotential,
    optimizationPotential,
    actionableYearlySavings,
    currency: dominantCurrency(input),
    generatedAt: new Date().toISOString(),
  };
}

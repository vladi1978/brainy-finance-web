import type { IntelligenceInput } from "../intelligence/types";
import type { MerchantGroupSummary } from "../intelligence/types";
import { logRecommendationGeneration } from "./logger";
import { enrichRecommendationsWording } from "./openaiWording";
import { applyRecommendationRules } from "./rules";
import { roundMoney } from "./savingsEstimate";
import type { ActionRecommendation, RecommendationsResult } from "./types";

export type { ActionRecommendation, RecommendationsResult } from "./types";
export type {
  RecommendationActionType,
  RecommendationSeverity,
} from "./types";
export { enrichRecommendationsWording } from "./openaiWording";

const severityRank: Record<ActionRecommendation["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function dedupeRecommendations(
  items: ActionRecommendation[]
): ActionRecommendation[] {
  const seen = new Map<string, ActionRecommendation>();
  for (const item of items) {
    const key = `${item.actionType}:${item.merchantReference ?? item.id}`;
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, item);
      continue;
    }
    if (item.estimatedMonthlySavings > prev.estimatedMonthlySavings) {
      seen.set(key, item);
    }
  }
  return [...seen.values()].sort((a, b) => {
    const sev = severityRank[a.severity] - severityRank[b.severity];
    if (sev !== 0) return sev;
    return b.estimatedMonthlySavings - a.estimatedMonthlySavings;
  });
}

export function buildRecommendations(
  input: IntelligenceInput & { merchantGroups?: MerchantGroupSummary[] }
): RecommendationsResult {
  const items = dedupeRecommendations(applyRecommendationRules(input));
  const currency =
    items[0]?.currency ??
    input.subscriptions[0]?.currency ??
    input.recurringExpenses[0]?.currency ??
    "USD";

  const totalMonthlySavings = roundMoney(
    items.reduce((s, r) => s + r.estimatedMonthlySavings, 0)
  );
  const totalYearlySavings = roundMoney(
    items.reduce((s, r) => s + r.estimatedYearlySavings, 0)
  );

  logRecommendationGeneration(items, {
    subscriptionCount: input.subscriptions.length,
    recurringExpenseCount: input.recurringExpenses.length,
    spendingInsightCount: input.spendingInsights.length,
    currency,
    totalMonthlySavings,
  });

  return {
    items,
    totalMonthlySavings,
    totalYearlySavings,
    currency,
  };
}

/** Build recommendations and optionally enrich copy with OpenAI when enabled. */
export async function buildRecommendationsAsync(
  input: IntelligenceInput & { merchantGroups?: MerchantGroupSummary[] },
  options?: { signal?: AbortSignal }
): Promise<RecommendationsResult> {
  const base = buildRecommendations(input);
  const enriched = await enrichRecommendationsWording(base.items, options);
  if (enriched === base.items) return base;
  return {
    ...base,
    items: enriched,
  };
}

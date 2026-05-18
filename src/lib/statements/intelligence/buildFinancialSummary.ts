import type { RecommendationsResult } from "../recommendations/types";
import {
  categoryForActionType,
  categoryForSavingsId,
  mergeCategoryTotals,
  roundMoney,
  type FinancialIntelligenceSummary,
} from "./financialCategories";
import type { SavingsOpportunity } from "./types";

function recommendationLineItems(
  recommendations: RecommendationsResult
): Array<{
  monthly: number;
  yearly: number;
  confidence: number;
  category: ReturnType<typeof categoryForActionType>;
  key: string;
}> {
  return recommendations.items.map((rec) => ({
    monthly: rec.estimatedMonthlySavings,
    yearly: rec.estimatedYearlySavings,
    confidence: rec.confidence,
    category: categoryForActionType(rec.actionType),
    key: `rec:${rec.actionType}:${rec.id}`,
  }));
}

function savingsLineItems(
  savings: SavingsOpportunity[]
): Array<{
  monthly: number;
  yearly: number;
  confidence: number;
  category: ReturnType<typeof categoryForSavingsId>;
  key: string;
}> {
  return savings.map((opp) => ({
    monthly: opp.monthlySavings,
    yearly: opp.yearlySavings,
    confidence: opp.confidence,
    category: categoryForSavingsId(opp.id),
    key: `sav:${opp.id}`,
  }));
}

/** Dedupe overlapping savings cards and recommendations by semantic key prefix. */
function dedupeLineItems<
  T extends {
    monthly: number;
    yearly: number;
    confidence: number;
    category: ReturnType<typeof categoryForSavingsId>;
    key: string;
  },
>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const semantic = item.key.replace(/^(rec|sav):/, "").split(":")[0] ?? item.key;
    const dedupeKey = `${item.category}:${semantic}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(item);
  }
  return out;
}

export function buildFinancialSummary(
  savings: SavingsOpportunity[],
  recommendations: RecommendationsResult
): FinancialIntelligenceSummary {
  const currency = recommendations.currency;
  const recItems = recommendationLineItems(recommendations);
  const savItems = savingsLineItems(savings);
  const merged = dedupeLineItems([...recItems, ...savItems]);

  const { confirmed, avoidableFees, optimization } = mergeCategoryTotals(merged);

  const actionableMonthly = roundMoney(
    confirmed.monthlyHigh + avoidableFees.monthlyHigh
  );
  const actionableYearly = roundMoney(
    confirmed.yearlyHigh + avoidableFees.yearlyHigh
  );

  return {
    confirmed,
    avoidableFees,
    optimization,
    actionableMonthly,
    actionableYearly,
    currency,
  };
}

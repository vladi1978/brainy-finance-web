import type { RecommendationsResult } from "../recommendations/types";
import {
  categoryForActionType,
  categoryForSavingsId,
  mergeCategoryTotals,
  roundMoney,
  type FinancialIntelligenceSummary,
} from "./financialCategories";
import type { SavingsOpportunity } from "./types";

/** Map overlapping fee action/savings ids onto one semantic bucket. */
function feeSemanticKey(raw: string): string {
  if (
    raw === "reduce-fees" ||
    raw === "setup_balance_alerts" ||
    raw === "switch_banking" ||
    raw.includes("overdraft") ||
    raw.includes("bank-fee") ||
    raw.includes("fee")
  ) {
    return "fees";
  }
  return raw;
}

function recommendationLineItems(
  recommendations: RecommendationsResult
): Array<{
  monthly: number;
  yearly: number;
  confidence: number;
  category: ReturnType<typeof categoryForActionType>;
  key: string;
  observedPeriod?: number;
}> {
  return recommendations.items.map((rec) => ({
    monthly: rec.estimatedMonthlySavings,
    yearly: rec.estimatedYearlySavings,
    confidence: rec.confidence,
    category: categoryForActionType(rec.actionType),
    key: `rec:${rec.actionType}:${rec.id}`,
    observedPeriod: rec.observedPeriodAmount,
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
  observedPeriod?: number;
}> {
  return savings.map((opp) => ({
    monthly: opp.monthlySavings,
    yearly: opp.yearlySavings,
    confidence: opp.confidence,
    category: categoryForSavingsId(opp.id),
    key: `sav:${opp.id}`,
    observedPeriod: opp.observedPeriodAmount,
  }));
}

/** Dedupe overlapping savings cards and recommendations by semantic key. */
function dedupeLineItems<
  T extends {
    monthly: number;
    yearly: number;
    confidence: number;
    category: ReturnType<typeof categoryForSavingsId>;
    key: string;
    observedPeriod?: number;
  },
>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const semanticRaw =
      item.key.replace(/^(rec|sav):/, "").split(":")[0] ?? item.key;
    const semantic = feeSemanticKey(semanticRaw);
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
  // Prefer savings rows first so fee observedPeriodAmount is preserved when deduping.
  const merged = dedupeLineItems([...savItems, ...recItems]);

  const { confirmed, avoidableFees, optimization } = mergeCategoryTotals(merged);

  // Observed one-time fees live outside monthly/annual actionable math.
  const observedCandidates = [
    ...merged
      .filter((i) => i.category === "avoidable_fees")
      .map((i) => i.observedPeriod ?? 0),
    ...savings
      .filter((s) => categoryForSavingsId(s.id) === "avoidable_fees")
      .map((s) => s.observedPeriodAmount ?? 0),
    ...recommendations.items
      .filter(
        (r) =>
          r.actionType === "setup_balance_alerts" ||
          r.actionType === "switch_banking"
      )
      .map((r) => r.observedPeriodAmount ?? 0),
  ];
  const observedAvoidableFeesPeriod = roundMoney(
    Math.max(0, ...observedCandidates)
  );

  // Monthly actionable = confirmed recurring only (never observed period fees).
  const actionableMonthly = roundMoney(
    confirmed.monthlyHigh +
      (avoidableFees.yearlyHigh > 0 ? avoidableFees.monthlyHigh : 0)
  );
  const actionableYearly = roundMoney(
    confirmed.yearlyHigh + avoidableFees.yearlyHigh
  );

  // Zero monthly display for observed-only fees in the avoidableFees bucket.
  const avoidableFeesDisplay =
    avoidableFees.yearlyHigh > 0
      ? avoidableFees
      : {
          ...avoidableFees,
          monthlyLow: 0,
          monthlyHigh: 0,
          yearlyLow: 0,
          yearlyHigh: 0,
          itemCount:
            observedAvoidableFeesPeriod > 0
              ? Math.max(avoidableFees.itemCount, 1)
              : avoidableFees.itemCount,
        };

  return {
    confirmed,
    avoidableFees: avoidableFeesDisplay,
    optimization,
    actionableMonthly,
    actionableYearly,
    observedAvoidableFeesPeriod,
    currency,
  };
}

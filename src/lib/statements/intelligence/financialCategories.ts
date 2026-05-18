import type { RecommendationActionType } from "../recommendations/types";

export type SavingsCategory =
  | "confirmed"
  | "avoidable_fees"
  | "optimization";

export type CategoryTotals = {
  monthlyLow: number;
  monthlyHigh: number;
  yearlyLow: number;
  yearlyHigh: number;
  /** Weighted average confidence 0–1 */
  confidence: number;
  itemCount: number;
};

export type FinancialIntelligenceSummary = {
  confirmed: CategoryTotals;
  avoidableFees: CategoryTotals;
  optimization: CategoryTotals;
  /** Confirmed + avoidable fees only — never includes optimization */
  actionableMonthly: number;
  actionableYearly: number;
  currency: string;
};

const SAVINGS_ID_CATEGORY: Record<string, SavingsCategory> = {
  "reduce-fees": "avoidable_fees",
  "compare-insurance": "optimization",
  "streaming-bundle": "optimization",
  "reduce-delivery": "optimization",
  "convenience-cut": "optimization",
  "review-flagged-subs": "confirmed",
};

const ACTION_TYPE_CATEGORY: Record<RecommendationActionType, SavingsCategory> =
  {
    setup_balance_alerts: "avoidable_fees",
    switch_banking: "avoidable_fees",
    review_subscription: "confirmed",
    reduce_streaming: "optimization",
    compare_telecom: "optimization",
    consolidate_ai_tools: "optimization",
    reduce_convenience_spend: "optimization",
    compare_insurance: "optimization",
    reduce_delivery: "optimization",
    review_recurring: "optimization",
    review_merchant_group: "optimization",
  };

/** Optimization estimates use a conservative band — not guaranteed savings. */
export const OPTIMIZATION_LOW_FRACTION = 0.25;
export const OPTIMIZATION_HIGH_FRACTION = 0.55;

export function categoryForSavingsId(id: string): SavingsCategory {
  return SAVINGS_ID_CATEGORY[id] ?? "optimization";
}

export function categoryForActionType(
  actionType: RecommendationActionType
): SavingsCategory {
  return ACTION_TYPE_CATEGORY[actionType];
}

export function emptyCategoryTotals(): CategoryTotals {
  return {
    monthlyLow: 0,
    monthlyHigh: 0,
    yearlyLow: 0,
    yearlyHigh: 0,
    confidence: 0,
    itemCount: 0,
  };
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function pointTotals(
  monthly: number,
  yearly: number,
  confidence: number,
  count: number
): CategoryTotals {
  const m = roundMoney(monthly);
  const y = roundMoney(yearly);
  return {
    monthlyLow: m,
    monthlyHigh: m,
    yearlyLow: y,
    yearlyHigh: y,
    confidence: roundMoney(confidence * 100) / 100,
    itemCount: count,
  };
}

function rangeTotals(
  monthlyEstimates: number[],
  yearlyEstimates: number[],
  confidences: number[]
): CategoryTotals {
  if (!monthlyEstimates.length) return emptyCategoryTotals();
  const monthlyLow = roundMoney(
    monthlyEstimates.reduce((s, m) => s + m * OPTIMIZATION_LOW_FRACTION, 0)
  );
  const monthlyHigh = roundMoney(
    monthlyEstimates.reduce((s, m) => s + m * OPTIMIZATION_HIGH_FRACTION, 0)
  );
  const yearlyLow = roundMoney(
    yearlyEstimates.reduce((s, y) => s + y * OPTIMIZATION_LOW_FRACTION, 0)
  );
  const yearlyHigh = roundMoney(
    yearlyEstimates.reduce((s, y) => s + y * OPTIMIZATION_HIGH_FRACTION, 0)
  );
  const confidence =
    confidences.reduce((s, c) => s + c, 0) / confidences.length;
  return {
    monthlyLow,
    monthlyHigh,
    yearlyLow,
    yearlyHigh,
    confidence: roundMoney(confidence * 100) / 100,
    itemCount: monthlyEstimates.length,
  };
}

export function mergeCategoryTotals(
  items: Array<{
    monthly: number;
    yearly: number;
    confidence: number;
    category: SavingsCategory;
  }>
): Pick<
  FinancialIntelligenceSummary,
  "confirmed" | "avoidableFees" | "optimization"
> {
  const confirmed: Array<{ monthly: number; yearly: number; confidence: number }> =
    [];
  const fees: Array<{ monthly: number; yearly: number; confidence: number }> = [];
  const optimization: Array<{
    monthly: number;
    yearly: number;
    confidence: number;
  }> = [];

  for (const item of items) {
    const row = {
      monthly: item.monthly,
      yearly: item.yearly,
      confidence: item.confidence,
    };
    if (item.category === "confirmed") confirmed.push(row);
    else if (item.category === "avoidable_fees") fees.push(row);
    else optimization.push(row);
  }

  const confirmedTotals = confirmed.length
    ? pointTotals(
        confirmed.reduce((s, r) => s + r.monthly, 0),
        confirmed.reduce((s, r) => s + r.yearly, 0),
        confirmed.reduce((s, r) => s + r.confidence, 0) / confirmed.length,
        confirmed.length
      )
    : emptyCategoryTotals();

  const feeTotals = fees.length
    ? pointTotals(
        fees.reduce((s, r) => s + r.monthly, 0),
        fees.reduce((s, r) => s + r.yearly, 0),
        fees.reduce((s, r) => s + r.confidence, 0) / fees.length,
        fees.length
      )
    : emptyCategoryTotals();

  const optimizationTotals = optimization.length
    ? rangeTotals(
        optimization.map((r) => r.monthly),
        optimization.map((r) => r.yearly),
        optimization.map((r) => r.confidence)
      )
    : emptyCategoryTotals();

  return {
    confirmed: confirmedTotals,
    avoidableFees: feeTotals,
    optimization: optimizationTotals,
  };
}

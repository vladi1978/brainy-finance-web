export type RecommendationSeverity = "low" | "medium" | "high";

export type RecommendationActionType =
  | "switch_banking"
  | "setup_balance_alerts"
  | "reduce_streaming"
  | "compare_telecom"
  | "consolidate_ai_tools"
  | "reduce_convenience_spend"
  | "review_subscription"
  | "compare_insurance"
  | "reduce_delivery"
  | "review_recurring"
  | "review_merchant_group";

export type ActionRecommendation = {
  id: string;
  title: string;
  description: string;
  estimatedMonthlySavings: number;
  estimatedYearlySavings: number;
  severity: RecommendationSeverity;
  /** 0–1 confidence in the underlying pattern */
  confidence: number;
  actionType: RecommendationActionType;
  merchantReference?: string;
  currency: string;
  sourceInsightId?: string;
};

export type OptimizationRange = {
  monthlyLow: number;
  monthlyHigh: number;
  yearlyLow: number;
  yearlyHigh: number;
};

export type RecommendationsResult = {
  items: ActionRecommendation[];
  /** Confirmed + avoidable fees only — excludes optimization estimates */
  totalMonthlySavings: number;
  totalYearlySavings: number;
  /** Same as totalMonthlySavings — actionable, not optimization */
  actionableMonthlySavings: number;
  actionableYearlySavings: number;
  optimizationRange: OptimizationRange;
  currency: string;
};

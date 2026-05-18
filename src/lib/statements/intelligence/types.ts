import type {
  MerchantCluster,
  SpendingInsight,
  StatementPeriod,
  SubscriptionInsight,
} from "../types";

export type InsightSeverity =
  | "positive"
  | "moderate"
  | "important"
  | "informational";

export type FinancialInsightCard = {
  id: string;
  title: string;
  explanation: string;
  severity: InsightSeverity;
  annualImpact?: number;
};

export type ConfidenceTier = "confirmed" | "recurring_pattern" | "hidden";

export type MerchantGroupSummary = {
  groupKey: string;
  displayName: string;
  clusterIds: string[];
  transactionCount: number;
  totalAmount: number;
  currency: string;
  recurringPatternScore: number;
  categoryKeys: string[];
};

export type EnrichedSpendingRow = SpendingInsight & {
  smartSignal: string;
  rowConfidence: number;
  confidenceTier: ConfidenceTier;
};

export type SavingsOpportunity = {
  id: string;
  title: string;
  explanation: string;
  monthlySavings: number;
  yearlySavings: number;
  currency: string;
};

export type HealthScoreLabel =
  | "Excellent"
  | "Good"
  | "Fair"
  | "Needs Attention";

export type HealthScoreResult = {
  score: number;
  label: HealthScoreLabel;
  factors: Array<{ id: string; label: string; impact: number }>;
};

export type StatementIntelligence = {
  insights: FinancialInsightCard[];
  healthScore: HealthScoreResult;
  savings: SavingsOpportunity[];
  merchantGroups: MerchantGroupSummary[];
  visibleRecurring: EnrichedSpendingRow[];
  visibleInsights: EnrichedSpendingRow[];
  lowConfidenceRows: EnrichedSpendingRow[];
};

export type IntelligenceInput = {
  statementPeriod: StatementPeriod | null;
  clusters: MerchantCluster[];
  subscriptions: SubscriptionInsight[];
  recurringExpenses: SpendingInsight[];
  spendingInsights: SpendingInsight[];
  transfers: SpendingInsight[];
  merchantNormByClusterId?: Map<
    string,
    import("../merchantNormalization").MerchantNormalizationResult
  >;
};

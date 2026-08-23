import type { CopilotAssistantContext } from "../copilot/types";
import type { CopilotTimelineResult } from "../timeline/types";
import type { RecommendationsResult } from "../recommendations/types";
import type { FinancialIntelligenceSummary } from "./financialCategories";
import type { SavingsCategory } from "./financialCategories";
import type {
  MerchantCluster,
  SpendingInsight,
  StatementPeriod,
  SubscriptionInsight,
} from "../types";
import type { ActivityPresentationGroups } from "./presentationGroups";

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
  category: SavingsCategory;
  /** 0–1 confidence in the underlying pattern */
  confidence: number;
  /**
   * Observed period fee total when cadence is insufficient for monthly/annual claims.
   * Not included in actionable monthly totals.
   */
  observedPeriodAmount?: number;
};

export type { FinancialIntelligenceSummary, SavingsCategory };

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
  financialSummary: FinancialIntelligenceSummary;
  recommendations: RecommendationsResult;
  copilot: CopilotTimelineResult;
  copilotAssistant: CopilotAssistantContext;
  merchantGroups: MerchantGroupSummary[];
  visibleRecurring: EnrichedSpendingRow[];
  visibleInsights: EnrichedSpendingRow[];
  lowConfidenceRows: EnrichedSpendingRow[];
  /** Consumer-facing presentation partitions (no new detection). */
  presentationGroups: ActivityPresentationGroups;
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

import type { FinancialIntelligenceSummary } from "../intelligence/financialCategories";
import type { HealthScoreResult } from "../intelligence/types";
import type { CopilotTimelineResult } from "../timeline/types";

export type SubscriptionHighlight = {
  name: string;
  monthly: number;
  category: string;
  flags: string[];
};

export type CopilotAssistantContext = {
  copilot: CopilotTimelineResult;
  healthScore: HealthScoreResult;
  financialSummary: FinancialIntelligenceSummary;
  subscriptions: {
    count: number;
    monthlyTotal: number;
    streaming: SubscriptionHighlight[];
    telecom: SubscriptionHighlight[];
    flagged: SubscriptionHighlight[];
    topBySpend: SubscriptionHighlight[];
  };
  fees: {
    total: number;
    overdraftCount: number;
    currency: string;
  };
  recurringMerchants: Array<{ name: string; monthly: number; currency: string }>;
  hasStatement: boolean;
};

export type CopilotIntent =
  | "cancel_first"
  | "score_low"
  | "trend_worry"
  | "reduce_bills"
  | "fees"
  | "subscriptions"
  | "telecom"
  | "overdraft"
  | "savings"
  | "general";

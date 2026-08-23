import type { InsightSeverity } from "../intelligence/types";

export type TimelineSignalKind =
  | "spending_increase"
  | "spending_decrease"
  | "recurring_weekly"
  | "recurring_monthly"
  | "overdraft_pattern"
  | "fee_escalation"
  | "subscription_growth"
  | "unusual_spike";

export type TimelineSignal = {
  id: string;
  kind: TimelineSignalKind;
  categoryKey?: string;
  merchantReference?: string;
  deltaPct?: number;
  amount: number;
  currency: string;
  evidence: string;
  tags: Array<"trend" | "priority" | "recurring" | "fee" | "subscription">;
  baseConfidence: number;
  /** Distinct dated fee events when kind is overdraft/fee (after dedupe). */
  eventCount?: number;
};

export type PriorityScores = {
  urgency: number;
  savingsImpact: number;
  confidence: number;
  effort: number;
  overall: number;
};

export type CopilotFeedItem = {
  id: string;
  signalId: string;
  title: string;
  insight: string;
  recommendation: string;
  estimatedMonthlySavings?: number;
  estimatedYearlySavings?: number;
  currency: string;
  severity: InsightSeverity;
  tags: TimelineSignal["tags"];
  priority: PriorityScores;
};

export type OptimizationPotentialRange = {
  yearlyLow: number;
  yearlyHigh: number;
  confidence: number;
};

export type CopilotTimelineResult = {
  feed: CopilotFeedItem[];
  topPriorities: CopilotFeedItem[];
  behaviorTrends: CopilotFeedItem[];
  /** @deprecated Use optimizationPotential — kept for backward compatibility */
  yearlyOptimizationPotential: number;
  optimizationPotential: OptimizationPotentialRange;
  actionableYearlySavings: number;
  currency: string;
  generatedAt: string;
};

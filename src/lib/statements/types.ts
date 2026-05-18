export type Transaction = {
  date: string;
  description: string;
  amount: number;
  type: "debit" | "credit";
  currency: string;
};

export type SubscriptionCategory =
  | "streaming"
  | "music"
  | "fitness"
  | "insurance"
  | "software"
  | "cloud_storage"
  | "ai_tools"
  | "shopping"
  | "utilities"
  | "other";

export type SubscriptionFrequency =
  | "monthly"
  | "annual"
  | "weekly"
  | "unknown";

/** UX classification — never presented as “subscription”. */
export type SpendingInsightKind =
  | "frequent_spending"
  | "one_time_expense"
  | "possible_recurring_expense"
  | "fee"
  | "income_transfer"
  | "needs_review";

export type SpendingInsightRecommendation =
  | "Review this expense"
  | "Possible savings opportunity"
  | "Frequent spending"
  | "Not a subscription";

export type SpendingInsightCategory =
  | "groceries"
  | "liquor"
  | "restaurants"
  | "cafes"
  | "retail"
  | "gas"
  | "convenience"
  | "transfers"
  | "fees"
  | "payroll"
  | "one_time_purchase"
  | "other";

export type SpendingInsight = {
  clusterId: string;
  merchant: string;
  normalizedName: string;
  categoryLabel: string;
  categoryKey: SpendingInsightCategory;
  kind: SpendingInsightKind;
  recommendation: SpendingInsightRecommendation;
  amount: number;
  currency: string;
  frequency: SubscriptionFrequency;
  totalSpentInPeriod: number;
  lastCharged: string;
  /** Weighted repeat-pattern + category fit (non-subscription recurring spend) */
  recurringExpenseScore: number;
  /** Notability for one-off / transfer / fee / review signals */
  spendingInsightScore: number;
};

export type SubscriptionFlags = {
  forgotten: boolean;
  duplicate: boolean;
  priceIncreased: boolean;
  trialConverted: boolean;
  suspicious: boolean;
  /** Ambiguous cadence, weak merchant match, or borderline confidence */
  reviewSuggested: boolean;
  /** Strong recurring-bill signals with healthy confidence */
  confirmed: boolean;
};

/** Normalized AI + merged heuristic shape */
export type SubscriptionInsight = {
  merchant: string;
  normalizedName: string;
  category: SubscriptionCategory;
  amount: number;
  currency: string;
  frequency: SubscriptionFrequency;
  lastCharged: string;
  monthlyEquivalent: number;
  annualEquivalent: number;
  confidence: number;
  /** 0–1 composite: merchant fit, cadence, category, model confidence */
  trueSubscriptionScore: number;
  flags: SubscriptionFlags;
  clusterId: string;
  /** Sum of matching debit amounts within parsed statement window */
  totalSpentInPeriod: number;
  /** Days between statement reference date and last charge */
  daysSinceLastCharge: number | null;
};

export type MerchantCluster = {
  id: string;
  key: string;
  descriptions: string[];
  charges: Array<{
    date: string;
    amount: number;
    type: "debit" | "credit";
    currency: string;
  }>;
};

export type StatementPeriod = {
  start: string;
  end: string;
};

/** Server-side structured diagnostics for the transaction pipeline */
export type ParsePipelineDebug = {
  totalExtractedChars: number;
  physicalLineCount: number;
  cleanedLineCount: number;
  reconstructedLineCount: number;
  candidateCount: number;
  highConfidenceParsed: number;
  acceptedCount: number;
  rejectedCount: number;
  aiDisambiguatedCount: number;
  fullTextAiFallbackUsed: boolean;
  rejected: Array<{ line: string; reasons: string[] }>;
  firstTenTransactions: Array<{
    date: string;
    description: string;
    amount: number;
    type: string;
    currency: string;
    source: string;
  }>;
};

import type { MerchantNormalizationDiagnostic } from "./merchantNormalization";

export type { MerchantNormalizationDiagnostic } from "./merchantNormalization";

export type SubscriptionDiagnostics = {
  subscriptionCount: number;
  spendingInsightCount: number;
  recurringExpenseCount: number;
  /** Cluster IDs whose subscription rows were produced or reinforced by OpenAI */
  aiAssistedSubscriptionClusterIds: string[];
  excludedFromSubscriptions: Array<{
    clusterId: string;
    merchantLabel: string;
    reasons: string[];
  }>;
  /** Raw statement descriptors vs normalized merchant labels (diagnostics only) */
  merchantNormalizations: MerchantNormalizationDiagnostic[];
};

export type { StatementIntelligence } from "./intelligence/types";

export type AnalyzeStatementResult = {
  textChars: number;
  pageCount: number;
  transactions: Transaction[];
  statementPeriod: StatementPeriod | null;
  clusters: MerchantCluster[];
  subscriptions: SubscriptionInsight[];
  /** Repeated everyday / transfer / fee patterns — excluded from subscription totals */
  recurringExpenses: SpendingInsight[];
  /** One-off or notable flows — excluded from subscription totals */
  spendingInsights: SpendingInsight[];
  /**
   * Zelle and peer-transfer flows — excluded from all expense totals,
   * subscriptions, recurring expenses, and spending insights.
   * Presented in a separate collapsed section only when present.
   */
  transfers: SpendingInsight[];
  summary: {
    monthlySpend: number;
    annualSpend: number;
    subscriptionCount: number;
    estimatedSavings: number;
    /** Sum of `spendingInsights` period totals only */
    spendingInsightsTotal: number;
  };
  diagnostics: SubscriptionDiagnostics;
  openAiUsed: boolean;
  openAiError: string | null;
  fallbackUsed: boolean;
  parseDebug: ParsePipelineDebug | null;
  intelligence: import("./intelligence/types").StatementIntelligence;
};

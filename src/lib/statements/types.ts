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
};

export type SubscriptionFlags = {
  forgotten: boolean;
  duplicate: boolean;
  priceIncreased: boolean;
  trialConverted: boolean;
  suspicious: boolean;
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

export type SubscriptionDiagnostics = {
  subscriptionCount: number;
  spendingInsightCount: number;
  excludedFromSubscriptions: Array<{
    clusterId: string;
    merchantLabel: string;
    reasons: string[];
  }>;
};

export type AnalyzeStatementResult = {
  textChars: number;
  pageCount: number;
  transactions: Transaction[];
  statementPeriod: StatementPeriod | null;
  clusters: MerchantCluster[];
  subscriptions: SubscriptionInsight[];
  spendingInsights: SpendingInsight[];
  summary: {
    monthlySpend: number;
    annualSpend: number;
    subscriptionCount: number;
    estimatedSavings: number;
    spendingInsightsTotal: number;
  };
  diagnostics: SubscriptionDiagnostics;
  openAiUsed: boolean;
  openAiError: string | null;
  fallbackUsed: boolean;
  parseDebug: ParsePipelineDebug | null;
};

import type {
  RecommendationActionType,
  RecommendationSeverity,
} from "../recommendations/types";

export type RecommendationStatus =
  | "pending"
  | "dismissed"
  | "accepted"
  | "tracked"
  | "essential";

export type FinancialActionId = string;

export type ActionModalKind = "provider_compare" | "fee_education";

export type StoredRecommendationState = {
  recommendationId: string;
  status: RecommendationStatus;
  lastActionId?: FinancialActionId;
  updatedAt: string;
};

export type FinancialActionDefinition = {
  id: FinancialActionId;
  label: string;
  kind: "primary" | "secondary" | "ghost";
  resolvesTo?: RecommendationStatus;
  opensModal?: ActionModalKind;
};

export type RecommendationInput = {
  id: string;
  title: string;
  description: string;
  estimatedMonthlySavings: number;
  estimatedYearlySavings: number;
  severity: RecommendationSeverity;
  confidence: number;
  actionType: RecommendationActionType;
  merchantReference?: string;
  currency: string;
  observedPeriodAmount?: number;
};

export type EnrichedRecommendation = RecommendationInput & {
  merchant?: string;
  status: RecommendationStatus;
  actions: FinancialActionDefinition[];
};

export type FinancialActionAnalyticsEvent = {
  recommendationId: string;
  actionType: RecommendationActionType;
  actionId: FinancialActionId;
  status: RecommendationStatus;
  merchant?: string;
  estimatedMonthlySavings: number;
  severity: RecommendationSeverity;
  confidence: number;
};

export type AcceptedSavingsSummary = {
  count: number;
  monthly: number;
  yearly: number;
  currency: string;
};

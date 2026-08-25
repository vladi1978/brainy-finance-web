import type { AnalyzeStatementResult, SpendingInsight } from "../types";
import { CONFIDENCE_VISIBLE_MIN, confidenceTier, rowConfidence } from "./confidence";
import { buildMerchantGroups } from "./merchantGroups";
import { buildHealthScore } from "./healthScore";
import { buildInsightsFeed } from "./insightsFeed";
import { buildRecommendations } from "../recommendations";
import { buildFinancialSummary } from "./buildFinancialSummary";
import { buildSavingsOpportunities } from "./savings";
import { deriveSmartSignal } from "./smartSignals";
import { buildActivityPresentationGroups } from "./presentationGroups";
import { buildStatementActivitySummary } from "./statementActivity";
import { buildCopilotAssistantContext } from "../copilot/buildAssistantContext";
import { buildCopilotTimeline } from "../timeline/buildTimeline";
import type {
  EnrichedSpendingRow,
  IntelligenceInput,
  StatementIntelligence,
} from "./types";

function enrichRows(
  rows: SpendingInsight[],
  clusterById: Map<string, AnalyzeStatementResult["clusters"][0]>
): EnrichedSpendingRow[] {
  const out: EnrichedSpendingRow[] = [];
  for (const row of rows) {
    const cluster = clusterById.get(row.clusterId);
    if (!cluster) continue;
    const conf = rowConfidence(row);
    const tier = confidenceTier(conf);
    out.push({
      ...row,
      rowConfidence: conf,
      confidenceTier: tier,
      smartSignal: deriveSmartSignal(cluster, row),
    });
  }
  return out;
}

function partitionVisible(
  rows: EnrichedSpendingRow[]
): {
  visible: EnrichedSpendingRow[];
  hidden: EnrichedSpendingRow[];
} {
  const visible: EnrichedSpendingRow[] = [];
  const hidden: EnrichedSpendingRow[] = [];
  for (const row of rows) {
    if (row.rowConfidence >= CONFIDENCE_VISIBLE_MIN) {
      visible.push(row);
    } else {
      hidden.push(row);
    }
  }
  return { visible, hidden };
}

export function buildStatementIntelligence(
  result: Pick<
    AnalyzeStatementResult,
    | "statementPeriod"
    | "clusters"
    | "subscriptions"
    | "recurringExpenses"
    | "spendingInsights"
    | "transfers"
    | "transactions"
  > & {
    merchantNormByClusterId?: Map<
      string,
      import("../merchantNormalization").MerchantNormalizationResult
    >;
    statementSummary?: {
      depositsTotal: number | null;
      withdrawalsTotal: number | null;
    } | null;
  }
): StatementIntelligence {
  const clusterById = new Map(result.clusters.map((c) => [c.id, c]));

  const input: IntelligenceInput = {
    statementPeriod: result.statementPeriod,
    clusters: result.clusters,
    subscriptions: result.subscriptions,
    recurringExpenses: result.recurringExpenses,
    spendingInsights: result.spendingInsights,
    transfers: result.transfers,
    merchantNormByClusterId: result.merchantNormByClusterId,
  };

  const allSpendRows = [...result.recurringExpenses, ...result.spendingInsights];
  const enrichedRecurring = enrichRows(result.recurringExpenses, clusterById);
  const enrichedInsights = enrichRows(result.spendingInsights, clusterById);

  const recurringParts = partitionVisible(enrichedRecurring);
  const insightParts = partitionVisible(enrichedInsights);

  const lowConfidenceRows = [
    ...recurringParts.hidden,
    ...insightParts.hidden,
  ].sort((a, b) => b.totalSpentInPeriod - a.totalSpentInPeriod);

  const visibleRecurring = recurringParts.visible.sort(
    (a, b) => b.totalSpentInPeriod - a.totalSpentInPeriod
  );
  const visibleInsights = insightParts.visible.sort(
    (a, b) => b.spendingInsightScore - a.spendingInsightScore
  );

  const merchantGroups = buildMerchantGroups({
    clusters: result.clusters,
    spendingRows: allSpendRows,
    merchantNormByClusterId: result.merchantNormByClusterId,
  });

  const recommendations = buildRecommendations({ ...input, merchantGroups });
  const savings = buildSavingsOpportunities(input);
  const financialSummary = buildFinancialSummary(savings, recommendations);
  const copilot = buildCopilotTimeline(input, { financialSummary });
  const statementActivity = buildStatementActivitySummary({
    transactions: result.transactions,
    clusters: result.clusters,
    subscriptions: result.subscriptions,
    statementPeriod: result.statementPeriod,
    merchantNormByClusterId: result.merchantNormByClusterId,
    statementSummary: result.statementSummary ?? null,
  });

  const healthScore = buildHealthScore(input, {
    ledgerStatus: statementActivity.ledger.status,
  });
  const copilotAssistant = buildCopilotAssistantContext(input, {
    copilot,
    healthScore,
    financialSummary,
  });

  const presentationGroups = buildActivityPresentationGroups({
    subscriptions: result.subscriptions,
    visibleRecurring,
    visibleInsights,
    clusters: result.clusters,
  });

  return {
    insights: buildInsightsFeed(input),
    healthScore,
    savings,
    financialSummary,
    recommendations,
    copilot,
    copilotAssistant,
    merchantGroups,
    visibleRecurring,
    visibleInsights,
    lowConfidenceRows,
    presentationGroups,
    statementActivity,
  };
}

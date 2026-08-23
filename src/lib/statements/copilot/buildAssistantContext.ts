import type { IntelligenceInput } from "../intelligence/types";
import type { SubscriptionInsight } from "../types";
import type { CopilotAssistantContext, SubscriptionHighlight } from "./types";
import type { CopilotTimelineResult } from "../timeline/types";
import type { FinancialIntelligenceSummary } from "../intelligence/financialCategories";
import type { HealthScoreResult } from "../intelligence/types";
import { isExpectedBillSubscription } from "../expectedBills";
import {
  buildGuardedSubscriptionTotals,
  chargeCountForSubscription,
  isEvidenceConfirmedSubscription,
  resolveChargeCount,
} from "../evidenceGuarded";
import { collectDedupedFees } from "../feeDedupe";

function subscriptionFlags(s: SubscriptionInsight): string[] {
  const out: string[] = [];
  if (s.flags.duplicate) out.push("duplicate");
  if (s.flags.forgotten) out.push("possibly unused");
  if (s.flags.priceIncreased) out.push("price increase");
  if (s.flags.trialConverted) out.push("trial converted");
  if (s.flags.suspicious) out.push("needs review");
  if (s.flags.reviewSuggested) out.push("review suggested");
  if (!s.flags.confirmed) out.push("recurrence not confirmed");
  return out;
}

function toHighlight(
  s: SubscriptionInsight,
  monthly: number
): SubscriptionHighlight {
  return {
    name: s.normalizedName || s.merchant,
    monthly,
    category: s.category,
    flags: subscriptionFlags(s),
  };
}

export function buildCopilotAssistantContext(
  input: IntelligenceInput,
  parts: {
    copilot: CopilotTimelineResult;
    healthScore: HealthScoreResult;
    financialSummary: FinancialIntelligenceSummary;
  }
): CopilotAssistantContext {
  const { subscriptions, recurringExpenses } = input;
  const byCluster = new Map(input.clusters.map((c) => [c.id, c]));
  const currency = parts.copilot.currency;
  const guarded = buildGuardedSubscriptionTotals(subscriptions, byCluster);

  const streaming = subscriptions
    .filter((s) => s.category === "streaming")
    .map((s) => {
      const n = chargeCountForSubscription(s, byCluster);
      const monthly = isEvidenceConfirmedSubscription(s, n)
        ? s.monthlyEquivalent
        : 0;
      return toHighlight(s, monthly);
    })
    .sort((a, b) => b.monthly - a.monthly);

  const telecom = subscriptions
    .filter((s) => s.category === "utilities")
    .map((s) => {
      const n = chargeCountForSubscription(s, byCluster);
      const monthly = isEvidenceConfirmedSubscription(s, n)
        ? s.monthlyEquivalent
        : 0;
      return toHighlight(s, monthly);
    })
    .sort((a, b) => b.monthly - a.monthly);

  const flagged = subscriptions
    .filter(
      (s) =>
        !isExpectedBillSubscription(s) &&
        (s.flags.forgotten ||
          s.flags.duplicate ||
          s.flags.priceIncreased ||
          s.flags.suspicious ||
          s.flags.reviewSuggested)
    )
    .map((s) => {
      const n = chargeCountForSubscription(s, byCluster);
      const monthly = isEvidenceConfirmedSubscription(s, n)
        ? s.monthlyEquivalent
        : 0;
      return toHighlight(s, monthly);
    })
    .sort((a, b) => b.monthly - a.monthly);

  const topBySpend = [...subscriptions]
    .filter((s) => !isExpectedBillSubscription(s))
    .map((s) => {
      const n = chargeCountForSubscription(s, byCluster);
      const monthly = isEvidenceConfirmedSubscription(s, n)
        ? s.monthlyEquivalent
        : s.totalSpentInPeriod;
      return toHighlight(s, monthly);
    })
    .sort((a, b) => b.monthly - a.monthly)
    .slice(0, 5);

  const feeSet = collectDedupedFees({
    recurringExpenses: input.recurringExpenses,
    spendingInsights: input.spendingInsights,
    clusters: input.clusters,
  });
  const feeTotal = feeSet.observedPeriodTotal;
  const overdraftCount = feeSet.overdraftCount;

  const recurringMerchants = recurringExpenses
    .filter((r) => {
      const n = resolveChargeCount({
        cluster: byCluster.get(r.clusterId),
        periodTotal: r.totalSpentInPeriod,
        latestCharge: r.amount,
      });
      return r.recurringExpenseScore >= 0.5 && n >= 2;
    })
    .sort((a, b) => b.totalSpentInPeriod - a.totalSpentInPeriod)
    .slice(0, 4)
    .map((r) => ({
      name: r.normalizedName || r.merchant,
      monthly: r.totalSpentInPeriod,
      currency: r.currency?.length === 3 ? r.currency : currency,
    }));

  return {
    copilot: parts.copilot,
    healthScore: parts.healthScore,
    financialSummary: parts.financialSummary,
    subscriptions: {
      count: guarded.confirmedCount,
      monthlyTotal: guarded.confirmedMonthlySpend,
      streaming,
      telecom,
      flagged,
      topBySpend,
    },
    fees: {
      total: feeTotal,
      overdraftCount,
      currency,
    },
    recurringMerchants,
    hasStatement: parts.copilot.feed.length > 0,
  };
}

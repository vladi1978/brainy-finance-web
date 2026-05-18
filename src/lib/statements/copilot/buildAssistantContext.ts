import type { IntelligenceInput } from "../intelligence/types";
import type { SubscriptionInsight } from "../types";
import type { CopilotAssistantContext, SubscriptionHighlight } from "./types";
import type { CopilotTimelineResult } from "../timeline/types";
import type { FinancialIntelligenceSummary } from "../intelligence/financialCategories";
import type { HealthScoreResult } from "../intelligence/types";

function subscriptionFlags(s: SubscriptionInsight): string[] {
  const out: string[] = [];
  if (s.flags.duplicate) out.push("duplicate");
  if (s.flags.forgotten) out.push("possibly unused");
  if (s.flags.priceIncreased) out.push("price increase");
  if (s.flags.trialConverted) out.push("trial converted");
  if (s.flags.suspicious) out.push("needs review");
  if (s.flags.reviewSuggested) out.push("review suggested");
  return out;
}

function toHighlight(s: SubscriptionInsight): SubscriptionHighlight {
  return {
    name: s.normalizedName || s.merchant,
    monthly: s.monthlyEquivalent,
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
  const allSpend = [...input.recurringExpenses, ...input.spendingInsights];
  const currency = parts.copilot.currency;

  const streaming = subscriptions
    .filter((s) => s.category === "streaming")
    .map(toHighlight)
    .sort((a, b) => b.monthly - a.monthly);

  const telecom = subscriptions
    .filter((s) => s.category === "utilities")
    .map(toHighlight)
    .sort((a, b) => b.monthly - a.monthly);

  const flagged = subscriptions
    .filter(
      (s) =>
        s.flags.forgotten ||
        s.flags.duplicate ||
        s.flags.priceIncreased ||
        s.flags.suspicious ||
        s.flags.reviewSuggested
    )
    .map(toHighlight)
    .sort((a, b) => b.monthly - a.monthly);

  const topBySpend = [...subscriptions]
    .map(toHighlight)
    .sort((a, b) => b.monthly - a.monthly)
    .slice(0, 5);

  const fees = allSpend.filter(
    (r) => r.categoryKey === "fees" || r.kind === "fee"
  );
  const feeTotal = fees.reduce((s, r) => s + r.totalSpentInPeriod, 0);
  const overdraftCount = fees.filter((r) =>
    /\b(OVERDRAFT|OD\s+F|NSF)\b/ui.test(`${r.merchant} ${r.normalizedName}`)
  ).length;

  const recurringMerchants = recurringExpenses
    .filter((r) => r.recurringExpenseScore >= 0.5)
    .sort((a, b) => b.totalSpentInPeriod - a.totalSpentInPeriod)
    .slice(0, 4)
    .map((r) => ({
      name: r.normalizedName || r.merchant,
      monthly: r.totalSpentInPeriod,
      currency: r.currency?.length === 3 ? r.currency : currency,
    }));

  const monthlyTotal = subscriptions.reduce(
    (s, x) => s + x.monthlyEquivalent,
    0
  );

  return {
    copilot: parts.copilot,
    healthScore: parts.healthScore,
    financialSummary: parts.financialSummary,
    subscriptions: {
      count: subscriptions.length,
      monthlyTotal,
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

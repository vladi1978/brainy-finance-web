import type { IntelligenceInput } from "../intelligence/types";
import type { MerchantGroupSummary } from "../intelligence/types";
import { statementPeriodDays } from "../intelligence/period";
import { subscriptionEligibleForAnnualSavings } from "../intelligence/savings";
import {
  ANNUAL_ESTIMATE_UNAVAILABLE,
  OBSERVED_ONLY_SAVINGS_NOTE,
  resolveChargeCount,
} from "../evidenceGuarded";
import { collectDedupedFees } from "../feeDedupe";
import { isRepeatedFeeClaim, isRepeatedOverdraftClaim } from "../feeClaims";
import { isExpectedBillSubscription } from "../expectedBills";
import type { ActionRecommendation, RecommendationSeverity } from "./types";
import {
  conservativeRecurringCut,
  monthlyAndYearlyFromMonthlyAmount,
  periodTotalToMonthly,
  roundMoney,
} from "./savingsEstimate";

function dominantCurrency(
  rows: { currency: string }[]
): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const c = r.currency?.length === 3 ? r.currency : "USD";
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  if (!counts.size) return "USD";
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function isAiMerchantText(text: string): boolean {
  return /\b(OPEN\s*AI|OPENAI|CHATGPT|CHAT\s*GPT|ANTHROPIC|CLAUDE|MIDJOURNEY|CURSOR\b|GITHUB\s+COPILOT)\b/ui.test(
    text
  );
}

function isDeliveryMerchant(text: string): boolean {
  return /\b(DOORDASH|UBER\s*EATS|GRUBHUB|POSTMATES)\b/ui.test(text);
}

function avgSubscriptionConfidence(
  subs: IntelligenceInput["subscriptions"]
): number {
  if (!subs.length) return 0.65;
  return (
    subs.reduce((s, x) => s + x.confidence, 0) / subs.length
  );
}

function clampConfidence(n: number): number {
  return Math.min(0.95, Math.max(0.55, roundMoney(n * 100) / 100));
}

function makeRec(
  partial: Omit<ActionRecommendation, "currency"> & { currency?: string },
  currency: string
): ActionRecommendation {
  return {
    ...partial,
    currency,
    estimatedMonthlySavings: roundMoney(partial.estimatedMonthlySavings),
    estimatedYearlySavings: roundMoney(partial.estimatedYearlySavings),
    confidence: clampConfidence(partial.confidence),
    observedPeriodAmount:
      partial.observedPeriodAmount != null
        ? roundMoney(partial.observedPeriodAmount)
        : undefined,
  };
}

export type RulesContext = IntelligenceInput & {
  merchantGroups?: MerchantGroupSummary[];
};

export function applyRecommendationRules(
  input: RulesContext
): ActionRecommendation[] {
  const {
    subscriptions,
    recurringExpenses,
    spendingInsights,
    statementPeriod,
    merchantGroups = [],
  } = input;
  const allSpend = [...recurringExpenses, ...spendingInsights];
  const currency = dominantCurrency([...subscriptions, ...allSpend]);
  const out: ActionRecommendation[] = [];
  const byCluster = new Map(input.clusters.map((c) => [c.id, c]));
  const spendChargeCount = (r: (typeof allSpend)[number]) =>
    resolveChargeCount({
      cluster: byCluster.get(r.clusterId),
      periodTotal: r.totalSpentInPeriod,
      latestCharge: r.amount,
    });

  const feeSet = collectDedupedFees({
    recurringExpenses,
    spendingInsights,
    clusters: input.clusters,
  });
  if (feeSet.observedPeriodTotal > 0) {
    const amt = feeSet.observedPeriodTotal.toFixed(2);
    const merchantRef = feeSet.events
      .map((e) => e.normalizedName)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    if (feeSet.annualizeEligible && isRepeatedFeeClaim(feeSet)) {
      const monthly =
        Math.round(feeSet.observedPeriodTotal * 0.85 * 100) / 100;
      const yearly = roundMoney(monthly * 12);
      out.push(
        makeRec(
          {
            id: feeSet.hasOverdraft
              ? "action-overdraft-alerts"
              : "action-bank-fees",
            title: feeSet.hasOverdraft
              ? "Enable balance alerts or move to fee-free banking"
              : "Review account fees and alert settings",
            description: feeSet.hasOverdraft
              ? isRepeatedOverdraftClaim(feeSet)
                ? "Repeated overdraft or NSF-style fees appeared on this statement. Low-balance notifications or an account without overdraft fees can stop repeat charges."
                : `A $${amt} fee was observed in this statement. Consider enabling balance alerts or reviewing fee-free options. ${ANNUAL_ESTIMATE_UNAVAILABLE}.`
              : "Bank or service fees were detected repeatedly. Compare fee schedules and turn on alerts before small balances trigger charges.",
            estimatedMonthlySavings: monthly,
            estimatedYearlySavings: yearly,
            severity: "high",
            confidence: 0.9,
            actionType: feeSet.hasOverdraft
              ? "setup_balance_alerts"
              : "switch_banking",
            merchantReference: merchantRef,
            sourceInsightId: feeSet.hasOverdraft ? "overdraft-fees" : "bank-fees",
            observedPeriodAmount: feeSet.observedPeriodTotal,
          },
          currency
        )
      );
    } else {
      out.push(
        makeRec(
          {
            id: feeSet.hasOverdraft
              ? "action-overdraft-alerts"
              : "action-bank-fees",
            title: feeSet.hasOverdraft
              ? "Enable balance alerts or move to fee-free banking"
              : "Review account fees and alert settings",
            description: feeSet.hasOverdraft
              ? `A $${amt} fee was observed in this statement. Consider enabling balance alerts or reviewing fee-free options. ${ANNUAL_ESTIMATE_UNAVAILABLE}.`
              : `A $${amt} fee was observed in this statement. Consider enabling balance alerts or reviewing fee-free options. ${ANNUAL_ESTIMATE_UNAVAILABLE}.`,
            estimatedMonthlySavings: 0,
            estimatedYearlySavings: 0,
            severity: "high",
            confidence: 0.55,
            actionType: feeSet.hasOverdraft
              ? "setup_balance_alerts"
              : "switch_banking",
            merchantReference: merchantRef,
            sourceInsightId: feeSet.hasOverdraft ? "overdraft-fees" : "bank-fees",
            observedPeriodAmount: feeSet.observedPeriodTotal,
          },
          currency
        )
      );
    }
  }

  const streaming = subscriptions.filter(
    (s) =>
      s.category === "streaming" &&
      subscriptionEligibleForAnnualSavings(s, byCluster)
  );
  if (streaming.length >= 2) {
    const monthly = streaming.reduce((s, x) => s + x.monthlyEquivalent, 0);
    const savingsMonthly = conservativeRecurringCut(monthly, 0.15, 35);
    const { monthly: estMo, yearly } =
      monthlyAndYearlyFromMonthlyAmount(savingsMonthly);
    const severity: RecommendationSeverity =
      streaming.length >= 4 ? "high" : "medium";
    out.push(
      makeRec(
        {
          id: "action-streaming-bundle",
          title: "Consolidate or rotate streaming subscriptions",
          description: `${streaming.length} streaming services are active. Bundling, annual plans, or ad-supported tiers often trim recurring cost without dropping everything.`,
          estimatedMonthlySavings: estMo,
          estimatedYearlySavings: yearly,
          severity,
          confidence: clampConfidence(
            0.72 + avgSubscriptionConfidence(streaming) * 0.15
          ),
          actionType: "reduce_streaming",
          merchantReference: streaming
            .map((s) => s.normalizedName)
            .slice(0, 5)
            .join(", "),
          sourceInsightId: "streaming-load",
        },
        currency
      )
    );
  }

  const telecom = subscriptions.filter(
    (s) =>
      s.category === "utilities" &&
      subscriptionEligibleForAnnualSavings(s, byCluster)
  );
  const telecomMonthly = telecom.reduce((s, x) => s + x.monthlyEquivalent, 0);
  if (telecom.length > 0 && telecomMonthly >= 60) {
    const savingsMonthly = conservativeRecurringCut(telecomMonthly, 0.1, 25);
    const { monthly, yearly } =
      monthlyAndYearlyFromMonthlyAmount(savingsMonthly);
    out.push(
      makeRec(
        {
          id: "action-telecom-compare",
          title: "Compare phone and internet plans at renewal",
          description:
            "Phone or internet bills are a material expected cost. At renewal, comparing plans is optional — promotional rates sometimes beat legacy pricing. This is not a recommendation to cancel service. Optimization ranges are not guaranteed savings.",
          estimatedMonthlySavings: monthly,
          estimatedYearlySavings: yearly,
          severity: telecomMonthly >= 120 ? "high" : "medium",
          confidence: clampConfidence(
            0.7 + avgSubscriptionConfidence(telecom) * 0.18
          ),
          actionType: "compare_telecom",
          merchantReference: telecom.map((s) => s.normalizedName).join(", "),
        },
        currency
      )
    );
  }

  const aiSubs = subscriptions.filter(
    (s) =>
      s.category === "ai_tools" &&
      subscriptionEligibleForAnnualSavings(s, byCluster)
  );
  const aiSpendRows = allSpend.filter(
    (r) => isAiMerchantText(r.normalizedName) && spendChargeCount(r) >= 2
  );
  const aiToolNames = [
    ...new Set([
      ...aiSubs.map((s) => s.normalizedName),
      ...aiSpendRows.map((r) => r.normalizedName),
    ]),
  ];
  if (aiSubs.length >= 2 || (aiSubs.length >= 1 && aiSpendRows.length >= 1)) {
    const monthly =
      aiSubs.reduce((s, x) => s + x.monthlyEquivalent, 0) +
      aiSpendRows.reduce((s, r) => s + periodTotalToMonthly(r.totalSpentInPeriod, statementPeriod), 0);
    const savingsMonthly = conservativeRecurringCut(monthly, 0.2, 45);
    const { monthly: estMo, yearly } =
      monthlyAndYearlyFromMonthlyAmount(savingsMonthly);
    out.push(
      makeRec(
        {
          id: "action-ai-overlap",
          title: "Consolidate overlapping AI subscriptions",
          description:
            "Multiple AI or developer-tool charges suggest overlapping capabilities. Keep one primary workspace and pause redundant plans.",
          estimatedMonthlySavings: estMo,
          estimatedYearlySavings: yearly,
          severity: aiToolNames.length >= 3 ? "high" : "medium",
          confidence: 0.78,
          actionType: "consolidate_ai_tools",
          merchantReference: aiToolNames.slice(0, 4).join(", "),
          sourceInsightId: "ai-tools",
        },
        currency
      )
    );
  }

  const convenience = allSpend.filter(
    (r) => r.categoryKey === "convenience" && spendChargeCount(r) >= 2
  );
  const convTotal = convenience.reduce((s, r) => s + r.totalSpentInPeriod, 0);
  if (convenience.length >= 3 && convTotal > 40) {
    const periodCut = convTotal * 0.12;
    const monthly = periodTotalToMonthly(periodCut, statementPeriod);
    out.push(
      makeRec(
        {
          id: "action-convenience-reduce",
          title: "Set a weekly convenience-store cap",
          description:
            "Frequent convenience-store runs add up in this window. Annual savings are not estimated from discretionary activity.",
          estimatedMonthlySavings: monthly,
          estimatedYearlySavings: 0,
          severity: convenience.length >= 5 ? "medium" : "low",
          confidence: 0.55,
          actionType: "reduce_convenience_spend",
          merchantReference: convenience
            .map((r) => r.normalizedName)
            .slice(0, 3)
            .join(", "),
          sourceInsightId: "convenience-up",
        },
        currency
      )
    );
  }

  const delivery = allSpend.filter(
    (r) => isDeliveryMerchant(r.normalizedName) && spendChargeCount(r) >= 2
  );
  const dining = allSpend.filter(
    (r) =>
      (r.categoryKey === "restaurants" || r.categoryKey === "cafes") &&
      spendChargeCount(r) >= 2
  );
  const deliveryTotal = [...delivery, ...dining].reduce(
    (s, r) => s + r.totalSpentInPeriod,
    0
  );
  if (delivery.length >= 2 || (dining.length >= 4 && deliveryTotal > 80)) {
    const days = statementPeriodDays(statementPeriod);
    const monthlySpend = (deliveryTotal / days) * 30;
    const savingsMonthly = conservativeRecurringCut(monthlySpend, 0.15, 30);
    out.push(
      makeRec(
        {
          id: "action-delivery-reduce",
          title: "Reduce delivery and dining frequency",
          description:
            "Food delivery and dining repeat in this window. Annual savings are not estimated from discretionary activity.",
          estimatedMonthlySavings: savingsMonthly,
          estimatedYearlySavings: 0,
          severity: delivery.length >= 4 ? "medium" : "low",
          confidence: 0.55,
          actionType: "reduce_delivery",
          merchantReference: [...delivery, ...dining]
            .map((r) => r.normalizedName)
            .slice(0, 3)
            .join(", "),
        },
        currency
      )
    );
  }

  const flagged = subscriptions.filter(
    (s) =>
      !isExpectedBillSubscription(s) &&
      (s.flags.forgotten ||
        s.flags.duplicate ||
        s.flags.priceIncreased ||
        s.flags.suspicious ||
        s.flags.reviewSuggested) &&
      subscriptionEligibleForAnnualSavings(s, byCluster)
  );
  if (flagged.length > 0) {
    const monthly = flagged.reduce((s, x) => s + x.monthlyEquivalent, 0);
    const savingsMonthly = conservativeRecurringCut(monthly, 0.5, monthly);
    const { monthly: estMo, yearly } =
      monthlyAndYearlyFromMonthlyAmount(savingsMonthly);
    out.push(
      makeRec(
        {
          id: "action-flagged-subs",
          title: "Review flagged subscriptions",
          description: `${flagged.length} confirmed subscription(s) were flagged for duplicates, price increases, or low use. Cancel or downgrade what you no longer need — amounts are not guaranteed.`,
          estimatedMonthlySavings: estMo,
          estimatedYearlySavings: yearly,
          severity: flagged.some((s) => s.flags.duplicate || s.flags.forgotten)
            ? "high"
            : "medium",
          confidence: clampConfidence(
            0.75 + avgSubscriptionConfidence(flagged) * 0.12
          ),
          actionType: "review_subscription",
          merchantReference: flagged
            .map((s) => s.normalizedName)
            .slice(0, 5)
            .join(", "),
        },
        currency
      )
    );
  } else {
    const weakFlagged = subscriptions.filter(
      (s) =>
        !isExpectedBillSubscription(s) &&
        (s.flags.forgotten ||
          s.flags.duplicate ||
          s.flags.priceIncreased ||
          s.flags.suspicious ||
          s.flags.reviewSuggested)
    );
    if (weakFlagged.length > 0) {
      out.push(
        makeRec(
          {
            id: "action-flagged-subs",
            title: "Review flagged subscriptions",
            description: `${OBSERVED_ONLY_SAVINGS_NOTE}. ${weakFlagged.length} item(s) flagged without sufficient recurrence evidence — savings not estimated.`,
            estimatedMonthlySavings: 0,
            estimatedYearlySavings: 0,
            severity: "medium",
            confidence: 0.45,
            actionType: "review_subscription",
            merchantReference: weakFlagged
              .map((s) => s.normalizedName)
              .slice(0, 5)
              .join(", "),
          },
          currency
        )
      );
    }
  }

  const subscriptionClusterIds = new Set(
    subscriptions.map((s) => s.clusterId)
  );
  const strongRecurring = recurringExpenses.filter(
    (r) =>
      spendChargeCount(r) >= 2 &&
      r.recurringExpenseScore >= 0.55 &&
      (r.kind === "possible_recurring_expense" ||
        r.recommendation === "Possible savings opportunity") &&
      r.categoryKey !== "retail" &&
      r.categoryKey !== "one_time_purchase" &&
      r.categoryKey !== "transfers"
  );
  for (const row of strongRecurring.slice(0, 3)) {
    if (subscriptionClusterIds.has(row.clusterId)) continue;
    const monthly = periodTotalToMonthly(row.totalSpentInPeriod, statementPeriod);
    const savingsMonthly = conservativeRecurringCut(monthly, 0.1, 20);
    out.push(
      makeRec(
        {
          id: `action-recurring-${row.clusterId}`,
          title: `Review recurring spend at ${row.normalizedName}`,
          description:
            "This merchant shows a repeat charge pattern that is not classified as a subscription. Annual estimate unavailable without confirmed cadence.",
          estimatedMonthlySavings: savingsMonthly,
          estimatedYearlySavings: 0,
          severity: "low",
          confidence: clampConfidence(0.6 + row.recurringExpenseScore * 0.25),
          actionType: "review_recurring",
          merchantReference: row.normalizedName,
        },
        currency
      )
    );
  }

  for (const group of merchantGroups) {
    if (group.recurringPatternScore < 0.55 || group.transactionCount < 3) {
      continue;
    }
    const overlapsSubscription = group.clusterIds.some((id) =>
      subscriptionClusterIds.has(id)
    );
    if (overlapsSubscription) continue;
    if (group.totalAmount < 50) continue;
    const monthly = periodTotalToMonthly(group.totalAmount, statementPeriod);
    const savingsMonthly = conservativeRecurringCut(monthly, 0.08, 15);
    out.push(
      makeRec(
        {
          id: `action-merchant-group-${group.groupKey}`,
          title: `Review repeat spending at ${group.displayName}`,
          description:
            "Grouped transactions suggest a recurring merchant pattern. Annual estimate unavailable without confirmed cadence.",
          estimatedMonthlySavings: savingsMonthly,
          estimatedYearlySavings: 0,
          severity: "low",
          confidence: clampConfidence(0.58 + group.recurringPatternScore * 0.3),
          actionType: "review_merchant_group",
          merchantReference: group.displayName,
        },
        currency
      )
    );
  }

  return out;
}

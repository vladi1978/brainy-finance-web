import type { MerchantCluster, SubscriptionInsight } from "../types";
import {
  OBSERVED_ONLY_SAVINGS_NOTE,
  canAnnualizeFeePattern,
  canAnnualizeFromRecurrence,
  resolveChargeCount,
} from "../recurrenceEvidence";
import type { IntelligenceInput, SavingsOpportunity } from "./types";
import { categoryForSavingsId } from "./financialCategories";
import { annualizePeriodAmount, statementPeriodDays } from "./period";

function savingsOpp(
  partial: Omit<SavingsOpportunity, "category" | "confidence"> & {
    confidence?: number;
  }
): SavingsOpportunity {
  return {
    ...partial,
    category: categoryForSavingsId(partial.id),
    confidence: partial.confidence ?? 0.72,
  };
}

function dominantCurrency(rows: { currency: string }[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const c = r.currency?.length === 3 ? r.currency : "USD";
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  if (!counts.size) return "USD";
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function clusterByIdMap(
  clusters: MerchantCluster[]
): Map<string, MerchantCluster> {
  return new Map(clusters.map((c) => [c.id, c]));
}

function subChargeCount(
  sub: SubscriptionInsight,
  clusters: Map<string, MerchantCluster>
): number {
  return resolveChargeCount({
    cluster: clusters.get(sub.clusterId),
    periodTotal: sub.totalSpentInPeriod,
    latestCharge: sub.amount,
  });
}

/** Confirmed recurring subscriptions eligible for monthly/annual savings math. */
export function subscriptionEligibleForAnnualSavings(
  sub: SubscriptionInsight,
  clusters: Map<string, MerchantCluster>
): boolean {
  const chargeCount = subChargeCount(sub, clusters);
  if (!canAnnualizeFromRecurrence({ chargeCount, frequency: sub.frequency })) {
    return false;
  }
  if (!sub.flags.confirmed) return false;
  if (sub.monthlyEquivalent <= 0) return false;
  return true;
}

export function buildSavingsOpportunities(
  input: IntelligenceInput
): SavingsOpportunity[] {
  const out: SavingsOpportunity[] = [];
  const { subscriptions, recurringExpenses, spendingInsights, statementPeriod, clusters } =
    input;
  const allSpend = [...recurringExpenses, ...spendingInsights];
  const currency = dominantCurrency([...subscriptions, ...allSpend]);
  const byCluster = clusterByIdMap(clusters);

  const fees = allSpend.filter(
    (r) => r.categoryKey === "fees" || r.kind === "fee"
  );
  const feeChargeCount = fees.reduce((n, r) => {
    const c = resolveChargeCount({
      cluster: byCluster.get(r.clusterId),
      periodTotal: r.totalSpentInPeriod,
      latestCharge: r.amount,
    });
    return n + c;
  }, 0);
  const feeTotal = fees.reduce((s, r) => s + r.totalSpentInPeriod, 0);
  if (feeTotal > 0) {
    const observedMonthly = Math.round(feeTotal * 0.85 * 100) / 100;
    if (canAnnualizeFeePattern(feeChargeCount)) {
      const yearly = annualizePeriodAmount(feeTotal, statementPeriod);
      out.push(
        savingsOpp({
          id: "reduce-fees",
          title: "Reduce overdraft and bank fees",
          explanation:
            "Repeated fees on this statement may be avoidable with balance alerts or a fee-free account tier.",
          monthlySavings: observedMonthly,
          yearlySavings: Math.round(yearly * 0.85 * 100) / 100,
          currency,
          confidence: 0.88,
        })
      );
    } else {
      out.push(
        savingsOpp({
          id: "reduce-fees",
          title: "Reduce overdraft and bank fees",
          explanation: `${OBSERVED_ONLY_SAVINGS_NOTE}. A fee was detected in this window; repeat cadence is not confirmed.`,
          monthlySavings: observedMonthly,
          yearlySavings: 0,
          currency,
          confidence: 0.55,
        })
      );
    }
  }

  const insurance = subscriptions.filter(
    (s) =>
      s.category === "insurance" &&
      subscriptionEligibleForAnnualSavings(s, byCluster)
  );
  if (insurance.length > 0) {
    const annual = insurance.reduce((s, x) => s + x.annualEquivalent, 0);
    if (annual >= 600) {
      const yearly = Math.round(annual * 0.1 * 100) / 100;
      out.push(
        savingsOpp({
          id: "compare-insurance",
          title: "Compare insurance rates",
          explanation:
            "Insurance premiums with confirmed recurrence — shopping quotes at renewal may lower cost; outcomes vary by coverage.",
          monthlySavings: Math.round((yearly / 12) * 100) / 100,
          yearlySavings: yearly,
          currency,
          confidence: 0.68,
        })
      );
    }
  }

  const streaming = subscriptions.filter(
    (s) =>
      s.category === "streaming" &&
      subscriptionEligibleForAnnualSavings(s, byCluster)
  );
  if (streaming.length >= 3) {
    const monthly = streaming.reduce((s, x) => s + x.monthlyEquivalent, 0);
    const savingsMonthly = Math.min(monthly * 0.15, 30);
    out.push(
      savingsOpp({
        id: "streaming-bundle",
        title: "Streaming bundle optimization",
        explanation: `${streaming.length} confirmed streaming services — bundling or rotating plans may cut recurring cost; not guaranteed.`,
        monthlySavings: Math.round(savingsMonthly * 100) / 100,
        yearlySavings: Math.round(savingsMonthly * 12 * 100) / 100,
        currency,
        confidence: 0.7,
      })
    );
  }

  const delivery = allSpend.filter((r) => {
    const count = resolveChargeCount({
      cluster: byCluster.get(r.clusterId),
      periodTotal: r.totalSpentInPeriod,
      latestCharge: r.amount,
    });
    if (count < 2) return false;
    return /\b(DOORDASH|UBER\s*EATS|GRUBHUB|POSTMATES)\b/ui.test(
      `${r.normalizedName} ${r.merchant}`
    );
  });
  const dining = allSpend.filter((r) => {
    const count = resolveChargeCount({
      cluster: byCluster.get(r.clusterId),
      periodTotal: r.totalSpentInPeriod,
      latestCharge: r.amount,
    });
    if (count < 2) return false;
    return r.categoryKey === "restaurants" || r.categoryKey === "cafes";
  });
  const deliveryTotal = [...delivery, ...dining].reduce(
    (s, r) => s + r.totalSpentInPeriod,
    0
  );
  if (delivery.length >= 2 || (dining.length >= 4 && deliveryTotal > 80)) {
    const days = statementPeriodDays(statementPeriod);
    const monthly = (deliveryTotal / days) * 30;
    const cut = Math.round(monthly * 0.15 * 100) / 100;
    out.push(
      savingsOpp({
        id: "reduce-delivery",
        title: "Reduce delivery frequency",
        explanation:
          "Food delivery and dining repeat often — small habit shifts may reduce spend; amounts vary.",
        monthlySavings: cut,
        yearlySavings: Math.round(cut * 12 * 100) / 100,
        currency,
        confidence: 0.68,
      })
    );
  }

  const convenience = allSpend.filter((r) => {
    const count = resolveChargeCount({
      cluster: byCluster.get(r.clusterId),
      periodTotal: r.totalSpentInPeriod,
      latestCharge: r.amount,
    });
    return r.categoryKey === "convenience" && count >= 2;
  });
  const convTotal = convenience.reduce((s, r) => s + r.totalSpentInPeriod, 0);
  if (convenience.length >= 3 && convTotal > 40) {
    const cut = Math.round(convTotal * 0.12 * 100) / 100;
    out.push(
      savingsOpp({
        id: "convenience-cut",
        title: "High recurring convenience spending",
        explanation:
          "Frequent convenience-store runs — batching errands may reduce impulse spend.",
        monthlySavings: Math.round((cut / statementPeriodDays(statementPeriod)) * 30 * 100) / 100,
        yearlySavings: annualizePeriodAmount(cut, statementPeriod),
        currency,
        confidence: 0.7,
      })
    );
  }

  const flagged = subscriptions.filter((s) => {
    if (
      !(
        s.flags.forgotten ||
        s.flags.duplicate ||
        s.flags.priceIncreased ||
        s.flags.suspicious
      )
    ) {
      return false;
    }
    return subscriptionEligibleForAnnualSavings(s, byCluster);
  });
  if (flagged.length > 0) {
    const monthly = flagged.reduce((s, x) => s + x.monthlyEquivalent, 0);
    const savingsMonthly = Math.round(monthly * 0.5 * 100) / 100;
    out.push(
      savingsOpp({
        id: "review-flagged-subs",
        title: "Review flagged subscriptions",
        explanation: `${flagged.length} confirmed subscription(s) flagged for duplicate, price increase, or review — canceling unused plans may help; not guaranteed.`,
        monthlySavings: savingsMonthly,
        yearlySavings: Math.round(savingsMonthly * 12 * 100) / 100,
        currency,
        confidence: 0.82,
      })
    );
  } else {
    const weakFlagged = subscriptions.filter(
      (s) =>
        s.flags.forgotten ||
        s.flags.duplicate ||
        s.flags.priceIncreased ||
        s.flags.suspicious
    );
    if (weakFlagged.length > 0) {
      const observed = weakFlagged.reduce(
        (s, x) => s + x.totalSpentInPeriod,
        0
      );
      out.push(
        savingsOpp({
          id: "review-flagged-subs",
          title: "Review flagged subscriptions",
          explanation: `${OBSERVED_ONLY_SAVINGS_NOTE}. ${weakFlagged.length} item(s) flagged, but recurrence evidence is insufficient to annualize.`,
          monthlySavings: Math.round(observed * 100) / 100,
          yearlySavings: 0,
          currency,
          confidence: 0.45,
        })
      );
    }
  }

  return out.sort((a, b) => b.yearlySavings - a.yearlySavings);
}

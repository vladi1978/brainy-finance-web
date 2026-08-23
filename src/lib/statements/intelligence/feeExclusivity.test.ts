/**
 * Fee dedupe + expected-bill exclusivity regressions.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { collectDedupedFees } from "../feeDedupe";
import { buildGuardedSubscriptionTotals } from "../evidenceGuarded";
import { isExpectedBillSubscription } from "../expectedBills";
import { buildSavingsOpportunities } from "./savings";
import { buildRecommendations } from "../recommendations";
import { buildFinancialSummary } from "./buildFinancialSummary";
import { buildHealthScore } from "./healthScore";
import { buildActivityPresentationGroups } from "./presentationGroups";
import type { IntelligenceInput } from "./types";
import type {
  MerchantCluster,
  SpendingInsight,
  SubscriptionInsight,
} from "../types";

function cluster(
  id: string,
  charges: Array<{ date: string; amount: number }>,
  descriptions?: string[]
): MerchantCluster {
  return {
    id,
    key: id,
    descriptions: descriptions ?? [id],
    charges: charges.map((c) => ({
      date: c.date,
      amount: c.amount,
      type: "debit" as const,
      currency: "USD",
    })),
  };
}

function feeRow(partial: Partial<SpendingInsight> & { clusterId: string }): SpendingInsight {
  return {
    clusterId: partial.clusterId,
    merchant: partial.merchant ?? "OVERDRAFT FEE",
    normalizedName: partial.normalizedName ?? "OVERDRAFT FEE",
    categoryLabel: "fees",
    categoryKey: "fees",
    kind: "fee",
    recommendation: "Review this expense",
    amount: partial.amount ?? 68,
    currency: "USD",
    frequency: "unknown",
    totalSpentInPeriod: partial.totalSpentInPeriod ?? partial.amount ?? 68,
    lastCharged: partial.lastCharged ?? "2026-07-12",
    recurringExpenseScore: 0.4,
    spendingInsightScore: 0.5,
  };
}

function peacock(): SubscriptionInsight {
  return {
    merchant: "PEACOCK",
    normalizedName: "PEACOCK",
    category: "streaming",
    amount: 11.99,
    currency: "USD",
    frequency: "monthly",
    lastCharged: "2026-07-15",
    monthlyEquivalent: 0,
    annualEquivalent: 0,
    confidence: 0.92,
    trueSubscriptionScore: 0.88,
    flags: {
      forgotten: false,
      duplicate: false,
      priceIncreased: false,
      trialConverted: false,
      suspicious: false,
      reviewSuggested: true,
      confirmed: false,
    },
    clusterId: "peacock",
    totalSpentInPeriod: 11.99,
    daysSinceLastCharge: 8,
  };
}

function att(): SubscriptionInsight {
  return {
    merchant: "AT&T",
    normalizedName: "AT&T WIRELESS",
    category: "utilities",
    amount: 85,
    currency: "USD",
    frequency: "monthly",
    lastCharged: "2026-07-01",
    monthlyEquivalent: 0,
    annualEquivalent: 0,
    confidence: 0.9,
    trueSubscriptionScore: 0.85,
    flags: {
      forgotten: false,
      duplicate: false,
      priceIncreased: false,
      trialConverted: false,
      suspicious: false,
      reviewSuggested: true,
      confirmed: false,
    },
    clusterId: "att",
    totalSpentInPeriod: 85,
    daysSinceLastCharge: 10,
  };
}

test("one $68 overdraft remains $68 observed everywhere — no /mo or /yr", () => {
  const odCluster = cluster("od", [{ date: "2026-07-12", amount: 68 }]);
  const fee = feeRow({ clusterId: "od", amount: 68 });
  // Simulate duplicate presence in both recurring + insights lists.
  const input: IntelligenceInput = {
    statementPeriod: { start: "2026-07-01", end: "2026-07-31" },
    clusters: [odCluster],
    subscriptions: [],
    recurringExpenses: [fee],
    spendingInsights: [{ ...fee }],
    transfers: [],
  };

  const deduped = collectDedupedFees(input);
  assert.equal(deduped.chargeCount, 1);
  assert.equal(deduped.observedPeriodTotal, 68);

  const savings = buildSavingsOpportunities(input);
  const feeSav = savings.find((s) => s.id === "reduce-fees");
  assert.ok(feeSav);
  assert.equal(feeSav!.monthlySavings, 0);
  assert.equal(feeSav!.yearlySavings, 0);
  assert.equal(feeSav!.observedPeriodAmount, 68);
  assert.doesNotMatch(feeSav!.explanation, /\/mo|\/yr/i);
  assert.match(feeSav!.explanation, /\$68\.00 observed|68\.00 observed/i);

  const recs = buildRecommendations(input);
  const feeRec = recs.items.find(
    (i) => i.id.includes("overdraft") || i.id.includes("bank-fee")
  );
  assert.ok(feeRec);
  assert.equal(feeRec!.estimatedMonthlySavings, 0);
  assert.equal(feeRec!.estimatedYearlySavings, 0);
  assert.equal(feeRec!.observedPeriodAmount, 68);
  assert.doesNotMatch(feeRec!.description, /\$68\/mo|68\/mo|\/yr/i);
  assert.match(
    feeRec!.description,
    /A \$68\.00 fee was observed|A \$68 fee was observed/i
  );
  assert.equal(recs.actionableMonthlySavings, 0);
  assert.equal(recs.totalMonthlySavings, 0);

  const financial = buildFinancialSummary(savings, recs);
  assert.equal(financial.observedAvoidableFeesPeriod, 68);
  assert.equal(financial.avoidableFees.monthlyHigh, 0);
  assert.equal(financial.actionableMonthly, 0);
  assert.equal(financial.actionableYearly, 0);
});

test("no duplicate health penalty from the same overdraft transaction", () => {
  const input: IntelligenceInput = {
    statementPeriod: { start: "2026-07-01", end: "2026-07-31" },
    clusters: [cluster("od", [{ date: "2026-07-12", amount: 68 }])],
    subscriptions: [],
    recurringExpenses: [],
    spendingInsights: [feeRow({ clusterId: "od", amount: 68 })],
    transfers: [],
  };
  const health = buildHealthScore(input);
  const feeFactors = health.factors.filter(
    (f) => f.id === "fees" || f.id === "overdraft"
  );
  assert.equal(feeFactors.length, 1);
  assert.match(feeFactors[0]!.label, /Overdraft|Bank/i);
});

test("AT&T expected-only; Peacock possible-only; counts 0 / 1 / 1", () => {
  assert.equal(isExpectedBillSubscription(att()), true);
  assert.equal(isExpectedBillSubscription(peacock()), false);

  const input: IntelligenceInput = {
    statementPeriod: { start: "2026-07-01", end: "2026-07-31" },
    clusters: [
      cluster("peacock", [{ date: "2026-07-15", amount: 11.99 }]),
      cluster("att", [{ date: "2026-07-01", amount: 85 }], ["AT&T WIRELESS"]),
    ],
    subscriptions: [peacock(), att()],
    recurringExpenses: [],
    spendingInsights: [],
    transfers: [],
  };

  const guarded = buildGuardedSubscriptionTotals(
    input.subscriptions,
    input.clusters
  );
  assert.equal(guarded.confirmedCount, 0);
  assert.equal(guarded.possibleCount, 1);

  const groups = buildActivityPresentationGroups({
    subscriptions: input.subscriptions,
    visibleRecurring: [],
    visibleInsights: [],
    clusters: input.clusters,
  });
  assert.equal(groups.expectedRecurringBills.length, 1);
  assert.match(groups.expectedRecurringBills[0]!.normalizedName, /AT&T/i);
  assert.equal(groups.subscriptions.length, 1);
  assert.match(groups.subscriptions[0]!.normalizedName, /PEACOCK/i);

  const savings = buildSavingsOpportunities(input);
  const flagged = savings.find((s) => s.id === "review-flagged-subs");
  if (flagged) {
    assert.doesNotMatch(flagged.explanation, /AT&T/i);
  }
  const recs = buildRecommendations(input);
  const flaggedRec = recs.items.find((i) => i.id === "action-flagged-subs");
  if (flaggedRec) {
    assert.doesNotMatch(flaggedRec.merchantReference ?? "", /AT&T/i);
  }
});

test("repeated fee transactions remain eligible for cadence when threshold met", () => {
  const input: IntelligenceInput = {
    statementPeriod: { start: "2026-07-01", end: "2026-07-31" },
    clusters: [
      cluster("od", [
        { date: "2026-07-05", amount: 35 },
        { date: "2026-07-22", amount: 35 },
      ]),
    ],
    subscriptions: [],
    recurringExpenses: [],
    spendingInsights: [
      feeRow({
        clusterId: "od",
        amount: 35,
        totalSpentInPeriod: 70,
        lastCharged: "2026-07-22",
      }),
    ],
    transfers: [],
  };
  const deduped = collectDedupedFees(input);
  assert.equal(deduped.chargeCount, 2);
  assert.equal(deduped.annualizeEligible, true);
  const savings = buildSavingsOpportunities(input);
  const feeSav = savings.find((s) => s.id === "reduce-fees");
  assert.ok(feeSav);
  assert.ok(feeSav!.yearlySavings > 0);
  assert.ok(feeSav!.monthlySavings > 0);
});

/**
 * Downstream consistency: every surface uses evidence-gated recurrence/savings.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ANNUAL_ESTIMATE_UNAVAILABLE,
  buildGuardedSubscriptionTotals,
  computeMeaningfulTrendPct,
  hasGenuineDuplicateCharges,
  MIN_TREND_BASELINE_AMOUNT,
} from "../evidenceGuarded";
import { buildInsightsFeed } from "./insightsFeed";
import { buildHealthScore } from "./healthScore";
import { buildSavingsOpportunities } from "./savings";
import { buildFinancialSummary } from "./buildFinancialSummary";
import { buildRecommendations } from "../recommendations";
import { buildCopilotTimeline } from "../timeline/buildTimeline";
import { buildCopilotAssistantContext } from "../copilot/buildAssistantContext";
import { deriveSmartSignal } from "./smartSignals";
import { buildActivityPresentationGroups } from "./presentationGroups";
import type { IntelligenceInput } from "./types";
import type {
  MerchantCluster,
  SpendingInsight,
  SubscriptionInsight,
} from "../types";

function cluster(
  id: string,
  charges: Array<{ date: string; amount: number }>
): MerchantCluster {
  return {
    id,
    key: id,
    descriptions: [id],
    charges: charges.map((c) => ({
      date: c.date,
      amount: c.amount,
      type: "debit" as const,
      currency: "USD",
    })),
  };
}

function peacockOneCharge(): {
  input: IntelligenceInput;
  sub: SubscriptionInsight;
} {
  const sub: SubscriptionInsight = {
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
  const input: IntelligenceInput = {
    statementPeriod: { start: "2026-07-01", end: "2026-07-31" },
    clusters: [cluster("peacock", [{ date: "2026-07-15", amount: 11.99 }])],
    subscriptions: [sub],
    recurringExpenses: [],
    spendingInsights: [],
    transfers: [],
  };
  return { input, sub };
}

test("one Peacock charge: no confirmed/active/true-subscription claims across surfaces", () => {
  const { input, sub } = peacockOneCharge();
  const guarded = buildGuardedSubscriptionTotals(
    input.subscriptions,
    input.clusters
  );
  assert.equal(guarded.confirmedCount, 0);
  assert.equal(guarded.possibleCount, 1);
  assert.equal(guarded.confirmedMonthlySpend, 0);
  assert.equal(guarded.confirmedAnnualSpend, 0);

  const groups = buildActivityPresentationGroups({
    subscriptions: [sub],
    visibleRecurring: [],
    visibleInsights: [],
    clusters: input.clusters,
  });
  assert.equal(groups.subscriptions.length, 1);
  assert.match(
    groups.subscriptions[0]!.reason,
    /Possible subscription · recurrence not confirmed/
  );
  assert.doesNotMatch(
    groups.subscriptions[0]!.reason,
    /Confirmed subscription|subscription active|true subscription|recurring bill/i
  );

  const insights = buildInsightsFeed(input);
  for (const card of insights) {
    assert.doesNotMatch(
      card.title + " " + card.explanation,
      /subscription active|true subscription|Confirmed streaming/i
    );
    assert.ok(
      card.annualImpact == null || card.annualImpact === 0,
      `insight ${card.id} must not annualize one Peacock charge`
    );
  }
  const peacockInsight = insights.find((c) => c.id.startsWith("streaming"));
  assert.ok(peacockInsight);
  assert.match(peacockInsight!.title, /Possible subscription/i);
  assert.match(peacockInsight!.explanation, /Annual estimate unavailable/i);

  const health = buildHealthScore(input);
  assert.ok(
    !health.factors.some((f) => /High-confidence recurring/i.test(f.label))
  );

  const savings = buildSavingsOpportunities(input);
  assert.ok(!savings.some((s) => s.yearlySavings > 0 && s.id.includes("stream")));
  assert.ok(
    !savings.some(
      (s) => s.id === "review-flagged-subs" && s.yearlySavings > 0
    )
  );

  const recs = buildRecommendations(input);
  assert.equal(recs.actionableYearlySavings, 0);
  assert.ok(
    recs.totalYearlySavings === 0 ||
      recs.items.every((i) => i.estimatedYearlySavings === 0 || i.estimatedYearlySavings < 500)
  );
  assert.ok(recs.totalYearlySavings < 1000, "no extreme annualization");

  const financial = buildFinancialSummary(savings, recs);
  assert.equal(financial.confirmed.yearlyHigh, 0);
  assert.equal(financial.actionableYearly, 0);

  const copilot = buildCopilotTimeline(input, { financialSummary: financial });
  assert.equal(copilot.optimizationPotential.yearlyHigh, 0);
  assert.ok(
    (copilot.actionableYearlySavings ?? 0) === 0,
    "copilot actionable yearly must be 0"
  );
  for (const item of copilot.feed) {
    assert.ok(
      !(item.estimatedYearlySavings && item.estimatedYearlySavings > 500),
      `feed ${item.id} yearly too large`
    );
  }

  const assistant = buildCopilotAssistantContext(input, {
    copilot,
    healthScore: health,
    financialSummary: financial,
  });
  assert.equal(assistant.subscriptions.count, 0);
  assert.equal(assistant.subscriptions.monthlyTotal, 0);
});

test("zero confirmed with one possible: counts stay split and savings stay $0 confirmed", () => {
  const { input } = peacockOneCharge();
  const guarded = buildGuardedSubscriptionTotals(
    input.subscriptions,
    input.clusters
  );
  assert.equal(guarded.confirmedCount, 0);
  assert.equal(guarded.possibleCount, 1);
  assert.equal(guarded.confirmedSavingsMonthly, 0);

  const savings = buildSavingsOpportunities(input);
  const recs = buildRecommendations(input);
  const financial = buildFinancialSummary(savings, recs);
  assert.equal(financial.confirmed.monthlyHigh, 0);
  assert.equal(financial.actionableMonthly, 0);
  assert.equal(financial.observedAvoidableFeesPeriod ?? 0, 0);
});

test("one fee never annualized across savings, insights, recommendations, copilot", () => {
  const feeRow: SpendingInsight = {
    clusterId: "od",
    merchant: "OVERDRAFT FEE",
    normalizedName: "OVERDRAFT FEE",
    categoryLabel: "fees",
    categoryKey: "fees",
    kind: "fee",
    recommendation: "Review this expense",
    amount: 35,
    currency: "USD",
    frequency: "unknown",
    totalSpentInPeriod: 35,
    lastCharged: "2026-07-12",
    recurringExpenseScore: 0.4,
    spendingInsightScore: 0.5,
  };
  const input: IntelligenceInput = {
    statementPeriod: { start: "2026-07-01", end: "2026-07-31" },
    clusters: [cluster("od", [{ date: "2026-07-12", amount: 35 }])],
    subscriptions: [],
    recurringExpenses: [],
    spendingInsights: [feeRow],
    transfers: [],
  };

  const savings = buildSavingsOpportunities(input);
  const feeSav = savings.find((s) => s.id === "reduce-fees");
  assert.ok(feeSav);
  assert.equal(feeSav!.yearlySavings, 0);
  assert.equal(feeSav!.monthlySavings, 0);
  assert.equal(feeSav!.observedPeriodAmount, 35);

  const insights = buildInsightsFeed(input);
  const feeInsight = insights.find((c) => c.id.includes("fee") || c.id.includes("overdraft"));
  assert.ok(feeInsight);
  assert.equal(feeInsight!.annualImpact, undefined);
  assert.match(feeInsight!.explanation, /Annual estimate unavailable/i);

  const recs = buildRecommendations(input);
  for (const item of recs.items.filter((i) => i.id.includes("fee") || i.id.includes("overdraft"))) {
    assert.equal(item.estimatedYearlySavings, 0);
    assert.equal(item.estimatedMonthlySavings, 0);
  }

  const financial = buildFinancialSummary(savings, recs);
  assert.equal(financial.avoidableFees.yearlyHigh, 0);
  assert.equal(financial.observedAvoidableFeesPeriod, 35);
  assert.equal(financial.actionableMonthly, 0);

  const copilot = buildCopilotTimeline(input, { financialSummary: financial });
  const feeFeed = copilot.feed.filter(
    (i) => i.signalId.includes("fee") || i.signalId.includes("overdraft")
  );
  for (const item of feeFeed) {
    assert.ok(
      item.estimatedYearlySavings == null || item.estimatedYearlySavings === 0
    );
  }
});

test("summaries and recommendations share identical guarded actionable yearly", () => {
  const input: IntelligenceInput = {
    statementPeriod: { start: "2026-05-01", end: "2026-07-31" },
    clusters: [
      cluster("nf", [
        { date: "2026-05-01", amount: 15.49 },
        { date: "2026-06-01", amount: 15.49 },
        { date: "2026-07-01", amount: 15.49 },
      ]),
      cluster("od", [
        { date: "2026-06-05", amount: 35 },
        { date: "2026-07-05", amount: 35 },
      ]),
    ],
    subscriptions: [
      {
        merchant: "NETFLIX",
        normalizedName: "NETFLIX",
        category: "streaming",
        amount: 15.49,
        currency: "USD",
        frequency: "monthly",
        lastCharged: "2026-07-01",
        monthlyEquivalent: 15.49,
        annualEquivalent: 185.88,
        confidence: 0.95,
        trueSubscriptionScore: 0.9,
        flags: {
          forgotten: true,
          duplicate: false,
          priceIncreased: false,
          trialConverted: false,
          suspicious: false,
          reviewSuggested: false,
          confirmed: true,
        },
        clusterId: "nf",
        totalSpentInPeriod: 46.47,
        daysSinceLastCharge: 5,
      },
    ],
    recurringExpenses: [],
    spendingInsights: [
      {
        clusterId: "od",
        merchant: "OVERDRAFT FEE",
        normalizedName: "OVERDRAFT FEE",
        categoryLabel: "fees",
        categoryKey: "fees",
        kind: "fee",
        recommendation: "Review this expense",
        amount: 35,
        currency: "USD",
        frequency: "unknown",
        totalSpentInPeriod: 70,
        lastCharged: "2026-07-05",
        recurringExpenseScore: 0.5,
        spendingInsightScore: 0.5,
      },
    ],
    transfers: [],
  };

  const savings = buildSavingsOpportunities(input);
  const recs = buildRecommendations(input);
  const financial = buildFinancialSummary(savings, recs);
  const copilot = buildCopilotTimeline(input, { financialSummary: financial });

  assert.equal(
    copilot.actionableYearlySavings,
    financial.actionableYearly
  );
  assert.equal(
    copilot.optimizationPotential.yearlyHigh,
    financial.optimization.yearlyHigh
  );
  assert.ok(financial.actionableYearly > 0);
  assert.ok(financial.actionableYearly < 5000, "no extreme annualization");
});

test("tiny comparison baseline does not produce a huge percentage", () => {
  const tiny = computeMeaningfulTrendPct(2, 80);
  assert.equal(tiny.pct, null);
  assert.equal(tiny.useNeutralWording, true);
  assert.ok(2 < MIN_TREND_BASELINE_AMOUNT);

  const ok = computeMeaningfulTrendPct(100, 130);
  assert.equal(ok.pct, 30);
  assert.equal(ok.useNeutralWording, false);

  const extreme = computeMeaningfulTrendPct(30, 900);
  assert.equal(extreme.pct, null);
  assert.equal(extreme.useNeutralWording, true);
});

test("two different Lyft amounts/dates are not labeled duplicate", () => {
  const lyft = cluster("lyft", [
    { date: "2026-07-05", amount: 11.98 },
    { date: "2026-07-22", amount: 9.31 },
  ]);
  assert.equal(hasGenuineDuplicateCharges(lyft.charges), false);

  const row: SpendingInsight = {
    clusterId: "lyft",
    merchant: "LYFT",
    normalizedName: "LYFT RIDE",
    categoryLabel: "other",
    categoryKey: "other",
    kind: "frequent_spending",
    recommendation: "Frequent spending",
    amount: 9.31,
    currency: "USD",
    frequency: "unknown",
    totalSpentInPeriod: 21.29,
    lastCharged: "2026-07-22",
    recurringExpenseScore: 0.6,
    spendingInsightScore: 0.55,
  };
  const signal = deriveSmartSignal(lyft, row);
  assert.equal(signal, "Repeated activity to review");
  assert.doesNotMatch(signal, /duplicate/i);
});

test("genuine same-amount near-date duplicate remains reviewable", () => {
  const dup = cluster("shop", [
    { date: "2026-07-10", amount: 49.99 },
    { date: "2026-07-11", amount: 49.99 },
  ]);
  assert.equal(hasGenuineDuplicateCharges(dup.charges), true);
  const row: SpendingInsight = {
    clusterId: "shop",
    merchant: "ACME STORE",
    normalizedName: "ACME STORE",
    categoryLabel: "retail",
    categoryKey: "retail",
    kind: "needs_review",
    recommendation: "Review this expense",
    amount: 49.99,
    currency: "USD",
    frequency: "unknown",
    totalSpentInPeriod: 99.98,
    lastCharged: "2026-07-11",
    recurringExpenseScore: 0.4,
    spendingInsightScore: 0.5,
  };
  assert.equal(deriveSmartSignal(dup, row), "Possible duplicate charge");
});

test("ANNUAL_ESTIMATE_UNAVAILABLE constant is product-facing copy", () => {
  assert.equal(ANNUAL_ESTIMATE_UNAVAILABLE, "Annual estimate unavailable");
});

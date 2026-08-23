/**
 * Temporal window + singular/plural fee claim regressions.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveStatementPeriod,
  deriveStatementPeriodFromDates,
  normalizeStatementPeriod,
  canEmitHalfPeriodTrend,
  chronologicalWeeklyDebitTotals,
} from "./period";
import { collectDedupedFees } from "../feeDedupe";
import {
  distinctDatedFeeCount,
  isRepeatedOverdraftClaim,
  overdraftFeeExplanation,
  overdraftFeeTitle,
  overdraftNarrativeCopy,
} from "../feeClaims";
import { buildInsightsFeed } from "./insightsFeed";
import { buildHealthScore } from "./healthScore";
import { buildRecommendations } from "../recommendations";
import { buildCopilotTimeline } from "../timeline/buildTimeline";
import { narrativeForSignal } from "../timeline/narratives";
import { detectTimelineSignals } from "../timeline/detectSignals";
import { buildActivityPresentationGroups } from "./presentationGroups";
import { buildGuardedSubscriptionTotals } from "../evidenceGuarded";
import { isExpectedBillSubscription } from "../expectedBills";
import type { IntelligenceInput } from "./types";
import type {
  MerchantCluster,
  SpendingInsight,
  SubscriptionInsight,
  Transaction,
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

function feeRow(
  partial: Partial<SpendingInsight> & { clusterId: string }
): SpendingInsight {
  return {
    clusterId: partial.clusterId,
    merchant: partial.merchant ?? "OVERDRAFT FEE",
    normalizedName: partial.normalizedName ?? "OVERDRAFT FEE",
    categoryLabel: "fees",
    categoryKey: "fees",
    kind: "fee",
    recommendation: "Review this expense",
    amount: partial.amount ?? 80,
    currency: "USD",
    frequency: "unknown",
    totalSpentInPeriod: partial.totalSpentInPeriod ?? partial.amount ?? 80,
    lastCharged: partial.lastCharged ?? "2026-06-28",
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
    lastCharged: "2026-06-27",
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
    lastCharged: "2026-06-26",
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

function productionLikeInput(opts?: {
  feeDates?: string[];
  duplicateFeeRows?: boolean;
}): IntelligenceInput {
  const feeDates = opts?.feeDates ?? ["2026-06-28"];
  const odCluster = cluster(
    "od",
    feeDates.map((date) => ({ date, amount: 80 })),
    ["OVERDRAFT FEE NSF"]
  );
  const fee = feeRow({
    clusterId: "od",
    amount: 80,
    lastCharged: feeDates[feeDates.length - 1],
    totalSpentInPeriod: 80 * feeDates.length,
  });
  const lyft = cluster(
    "lyft",
    [
      { date: "2026-06-26", amount: 24.5 },
      { date: "2026-06-29", amount: 18.2 },
    ],
    ["LYFT RIDE"]
  );
  const peacockC = cluster(
    "peacock",
    [{ date: "2026-06-27", amount: 11.99 }],
    ["PEACOCK"]
  );
  const attC = cluster("att", [{ date: "2026-06-26", amount: 85 }], ["AT&T"]);

  return {
    statementPeriod: { start: "2026-06-25", end: "2026-06-30" },
    clusters: [odCluster, lyft, peacockC, attC],
    subscriptions: [peacock(), att()],
    recurringExpenses: opts?.duplicateFeeRows ? [fee] : [],
    spendingInsights: [
      fee,
      ...(opts?.duplicateFeeRows ? [fee] : []),
      {
        clusterId: "lyft",
        merchant: "LYFT",
        normalizedName: "LYFT",
        categoryLabel: "transport",
        categoryKey: "rideshare",
        kind: "frequent_spending",
        recommendation: "Frequent spending",
        amount: 24.5,
        currency: "USD",
        frequency: "unknown",
        totalSpentInPeriod: 42.7,
        lastCharged: "2026-06-29",
        recurringExpenseScore: 0.55,
        spendingInsightScore: 0.6,
      } as SpendingInsight,
    ],
    transfers: [],
  };
}

function assertNoRepeatedFeeWording(text: string) {
  assert.equal(/\bpattern\b/i.test(text), false, `unexpected pattern: ${text}`);
  assert.equal(/\brepeated\b/i.test(text), false, `unexpected repeated: ${text}`);
  assert.equal(/\brecurring\b/i.test(text), false, `unexpected recurring: ${text}`);
}

test("descending transaction dates → min → max window", () => {
  const txs: Transaction[] = [
    {
      date: "2026-06-30",
      description: "A",
      amount: 1,
      type: "debit",
      currency: "USD",
    },
    {
      date: "2026-06-28",
      description: "B",
      amount: 1,
      type: "debit",
      currency: "USD",
    },
    {
      date: "2026-06-25",
      description: "C",
      amount: 1,
      type: "debit",
      currency: "USD",
    },
  ];
  const period = deriveStatementPeriod(txs);
  assert.deepEqual(period, { start: "2026-06-25", end: "2026-06-30" });
  assert.ok(period!.start <= period!.end);
});

test("one valid date → same start and end", () => {
  const period = deriveStatementPeriodFromDates([
    "not-a-date",
    "2026-06-25",
    "bogus",
  ]);
  assert.deepEqual(period, { start: "2026-06-25", end: "2026-06-25" });
});

test("invalid dates → omitted window", () => {
  assert.equal(deriveStatementPeriodFromDates(["", "foo", "13/40/2026"]), null);
  assert.equal(normalizeStatementPeriod({ start: "bad", end: "2026-06-01" }), null);
});

test("normalize swaps reversed windows", () => {
  assert.deepEqual(
    normalizeStatementPeriod({ start: "2026-06-30", end: "2026-06-25" }),
    { start: "2026-06-25", end: "2026-06-30" }
  );
});

test("too-short or invalid window → no half-period trend", () => {
  assert.equal(canEmitHalfPeriodTrend(null, 5), false);
  assert.equal(
    canEmitHalfPeriodTrend({ start: "2026-06-25", end: "2026-06-25" }, 5),
    false
  );
  assert.equal(
    canEmitHalfPeriodTrend({ start: "2026-06-25", end: "2026-06-30" }, 2),
    false
  );
  assert.equal(
    canEmitHalfPeriodTrend({ start: "2026-06-01", end: "2026-06-30" }, 4),
    true
  );
});

test("chronological weekly totals ignore amount-sort bias", () => {
  const clusters = [
    cluster("a", [
      { date: "2026-06-02", amount: 500 },
      { date: "2026-06-09", amount: 10 },
      { date: "2026-06-16", amount: 10 },
      { date: "2026-06-23", amount: 10 },
    ]),
  ];
  const totals = chronologicalWeeklyDebitTotals(clusters);
  assert.equal(totals[0], 500);
  assert.ok(totals.length >= 3);
});

test("one fee → singular wording everywhere", () => {
  const input = productionLikeInput();
  const fees = collectDedupedFees({
    recurringExpenses: input.recurringExpenses,
    spendingInsights: input.spendingInsights,
    clusters: input.clusters,
  });
  assert.equal(distinctDatedFeeCount(fees), 1);
  assert.equal(isRepeatedOverdraftClaim(fees), false);
  assert.equal(overdraftFeeTitle(fees), "Overdraft fee detected");
  assert.equal(
    overdraftFeeExplanation(fees),
    "One overdraft or NSF-style fee was observed in this statement."
  );
  assertNoRepeatedFeeWording(overdraftNarrativeCopy(fees).title);
  assertNoRepeatedFeeWording(overdraftNarrativeCopy(fees).insight);

  const insights = buildInsightsFeed(input);
  const od = insights.find((c) => c.id === "overdraft-fees");
  assert.ok(od);
  assert.equal(od!.title, "Overdraft fee detected");
  assertNoRepeatedFeeWording(od!.title);
  assertNoRepeatedFeeWording(od!.explanation);

  const signals = detectTimelineSignals(input);
  const odSignal = signals.find((s) => s.kind === "overdraft_pattern");
  assert.ok(odSignal);
  assert.equal(odSignal!.id, "overdraft-fee");
  const copy = narrativeForSignal(odSignal!);
  assert.equal(copy.title, "Overdraft fee detected");
  assertNoRepeatedFeeWording(copy.title);
  assertNoRepeatedFeeWording(copy.insight);

  const timeline = buildCopilotTimeline(input);
  for (const item of [...timeline.topPriorities, ...timeline.feed]) {
    if (!item.tags.includes("fee")) continue;
    assertNoRepeatedFeeWording(item.title);
    assertNoRepeatedFeeWording(item.insight);
  }

  const recs = buildRecommendations(input);
  for (const r of recs.items) {
    if (!r.id.includes("overdraft") && !r.id.includes("bank-fees")) continue;
    assert.equal(/\b\/mo\b|\b\/yr\b/i.test(r.description), false);
    assertNoRepeatedFeeWording(r.description);
    assert.equal(r.estimatedMonthlySavings, 0);
    assert.equal(r.estimatedYearlySavings, 0);
  }
});

test("two distinct fees → repeated/pattern wording", () => {
  const input = productionLikeInput({
    feeDates: ["2026-06-20", "2026-06-28"],
  });
  const fees = collectDedupedFees({
    recurringExpenses: input.recurringExpenses,
    spendingInsights: input.spendingInsights,
    clusters: input.clusters,
  });
  assert.equal(distinctDatedFeeCount(fees), 2);
  assert.equal(isRepeatedOverdraftClaim(fees), true);
  assert.equal(overdraftFeeTitle(fees), "Repeated overdraft fees detected");
  assert.match(overdraftNarrativeCopy(fees).title, /pattern/i);

  const odSignal = detectTimelineSignals(input).find(
    (s) => s.kind === "overdraft_pattern"
  );
  assert.equal(odSignal?.id, "overdraft-pattern");
  assert.match(narrativeForSignal(odSignal!).title, /pattern/i);
});

test("one fee generating multiple signals → still singular", () => {
  const input = productionLikeInput({ duplicateFeeRows: true });
  const fees = collectDedupedFees({
    recurringExpenses: input.recurringExpenses,
    spendingInsights: input.spendingInsights,
    clusters: input.clusters,
  });
  assert.equal(fees.observedPeriodTotal, 80);
  assert.equal(distinctDatedFeeCount(fees), 1);
  assert.equal(isRepeatedOverdraftClaim(fees), false);

  const odSignal = detectTimelineSignals(input).find(
    (s) => s.kind === "overdraft_pattern"
  );
  assert.equal(odSignal?.id, "overdraft-fee");
  assertNoRepeatedFeeWording(narrativeForSignal(odSignal!).title);
});

test("production-like statement: no repeated-fee wording, ascending window, category exclusivity", () => {
  const descendingDates = [
    "2026-06-30",
    "2026-06-29",
    "2026-06-28",
    "2026-06-27",
    "2026-06-26",
    "2026-06-25",
  ];
  const period = deriveStatementPeriodFromDates(descendingDates);
  assert.deepEqual(period, { start: "2026-06-25", end: "2026-06-30" });

  const input = productionLikeInput();
  input.statementPeriod = period;

  const fees = collectDedupedFees({
    recurringExpenses: input.recurringExpenses,
    spendingInsights: input.spendingInsights,
    clusters: input.clusters,
  });
  assert.equal(fees.observedPeriodTotal, 80);
  assert.equal(fees.annualizeEligible, false);

  const insights = buildInsightsFeed(input);
  assert.equal(
    insights.some((c) => /repeated|pattern/i.test(`${c.title} ${c.explanation}`)),
    false
  );

  const timeline = buildCopilotTimeline(input);
  for (const item of timeline.feed) {
    if (item.tags.includes("fee")) {
      assertNoRepeatedFeeWording(item.title);
      assertNoRepeatedFeeWording(item.insight);
    }
  }

  const byCluster = new Map(input.clusters.map((c) => [c.id, c]));
  const guarded = buildGuardedSubscriptionTotals(input.subscriptions, byCluster);
  assert.equal(guarded.confirmedCount, 0);
  const expected = input.subscriptions.filter((s) => isExpectedBillSubscription(s));
  const possible = input.subscriptions.filter(
    (s) => !isExpectedBillSubscription(s) && !s.flags.confirmed
  );
  assert.equal(expected.length, 1);
  assert.equal(possible.length, 1);
  assert.equal(expected[0]!.normalizedName.includes("AT&T"), true);
  assert.equal(possible[0]!.normalizedName, "PEACOCK");

  const groups = buildActivityPresentationGroups({
    subscriptions: input.subscriptions,
    visibleRecurring: [],
    visibleInsights: input.spendingInsights.map((r) => ({
      ...r,
      smartSignal: "test",
      rowConfidence: 0.7,
      confidenceTier: "hidden" as const,
    })),
    clusters: input.clusters,
  });
  const lyft = [
    ...groups.repeatedDiscretionary,
    ...groups.oneTimeReview,
    ...groups.unusualRecurring,
  ].find((g) => /lyft/i.test(g.merchant));
  assert.ok(lyft, "Lyft should remain discretionary/one-time activity");

  const health = buildHealthScore(input);
  assert.equal(
    health.factors.filter((f) => /fee|overdraft/i.test(f.label)).length,
    1
  );
});

test("invalid/short window omits second-half spending trend signal", () => {
  const input = productionLikeInput();
  input.statementPeriod = { start: "2026-06-28", end: "2026-06-28" };
  // Spread weeks by amount would previously fake a rise; chronological + gate must omit.
  input.clusters.push(
    cluster("w1", [{ date: "2026-06-28", amount: 5 }]),
    cluster("w2", [{ date: "2026-06-28", amount: 500 }]),
    cluster("w3", [{ date: "2026-06-28", amount: 600 }])
  );
  const signals = detectTimelineSignals(input);
  assert.equal(
    signals.some((s) => s.id === "spending-increase-weekly"),
    false
  );
  const insights = buildInsightsFeed(input);
  assert.equal(
    insights.some((c) => c.id === "weekly-rise"),
    false
  );
});

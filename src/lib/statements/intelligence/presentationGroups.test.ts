/**
 * Regression: recurrence evidence gates for presentation, savings, and wording.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { equivalentsForFrequency } from "../heuristics";
import {
  MIN_CHARGES_FOR_RECURRENCE,
  canAnnualizeFeePattern,
  hasConfirmedRecurrenceEvidence,
} from "../recurrenceEvidence";
import type { MerchantCluster, SpendingInsight, SubscriptionInsight } from "../types";
import {
  buildActivityPresentationGroups,
  formatUncertainActivitySummary,
  supportsMonthlyCadencePresentation,
} from "./presentationGroups";
import { buildSavingsOpportunities } from "./savings";

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

function baseSub(
  partial: Partial<SubscriptionInsight> &
    Pick<SubscriptionInsight, "clusterId" | "category" | "normalizedName">
): SubscriptionInsight {
  return {
    merchant: partial.normalizedName,
    normalizedName: partial.normalizedName,
    category: partial.category,
    amount: partial.amount ?? 50,
    currency: "USD",
    frequency: partial.frequency ?? "monthly",
    lastCharged: partial.lastCharged ?? "2026-07-15",
    monthlyEquivalent: partial.monthlyEquivalent ?? 50,
    annualEquivalent: partial.annualEquivalent ?? 600,
    confidence: partial.confidence ?? 0.9,
    trueSubscriptionScore: partial.trueSubscriptionScore ?? 0.85,
    flags: {
      forgotten: false,
      duplicate: false,
      priceIncreased: false,
      trialConverted: false,
      suspicious: false,
      reviewSuggested: false,
      confirmed: false,
      ...partial.flags,
    },
    clusterId: partial.clusterId,
    totalSpentInPeriod: partial.totalSpentInPeriod ?? partial.amount ?? 50,
    daysSinceLastCharge: partial.daysSinceLastCharge ?? 5,
  };
}

function baseSpend(
  partial: Partial<SpendingInsight> &
    Pick<SpendingInsight, "clusterId" | "normalizedName" | "kind" | "categoryKey">
): SpendingInsight {
  return {
    clusterId: partial.clusterId,
    merchant: partial.normalizedName,
    normalizedName: partial.normalizedName,
    categoryLabel: partial.categoryLabel ?? partial.categoryKey,
    categoryKey: partial.categoryKey,
    kind: partial.kind,
    recommendation: partial.recommendation ?? "Frequent spending",
    amount: partial.amount ?? 20,
    currency: "USD",
    frequency: partial.frequency ?? "unknown",
    totalSpentInPeriod: partial.totalSpentInPeriod ?? 40,
    lastCharged: partial.lastCharged ?? "2026-07-20",
    recurringExpenseScore: partial.recurringExpenseScore ?? 0.7,
    spendingInsightScore: partial.spendingInsightScore ?? 0.6,
  };
}

test("thresholds: recurrence and fee annualization require ≥2 charges", () => {
  assert.equal(MIN_CHARGES_FOR_RECURRENCE, 2);
  assert.equal(canAnnualizeFeePattern(1), false);
  assert.equal(canAnnualizeFeePattern(2), true);
  assert.equal(
    hasConfirmedRecurrenceEvidence({ chargeCount: 1, frequency: "monthly" }),
    false
  );
  assert.equal(
    hasConfirmedRecurrenceEvidence({ chargeCount: 2, frequency: "monthly" }),
    true
  );
  assert.equal(
    hasConfirmedRecurrenceEvidence({ chargeCount: 2, frequency: "weekly" }),
    false
  );
  assert.equal(
    hasConfirmedRecurrenceEvidence({ chargeCount: 3, frequency: "weekly" }),
    true
  );
});

test("known subscription merchant with one charge is possible, not confirmed", () => {
  const groups = buildActivityPresentationGroups({
    subscriptions: [
      baseSub({
        clusterId: "netflix",
        category: "streaming",
        normalizedName: "NETFLIX",
        amount: 15.49,
        totalSpentInPeriod: 15.49,
        frequency: "monthly",
        flags: { confirmed: true } as SubscriptionInsight["flags"],
        monthlyEquivalent: 15.49,
        annualEquivalent: 185.88,
      }),
    ],
    visibleRecurring: [],
    visibleInsights: [],
    clusters: [cluster("netflix", [{ date: "2026-07-01", amount: 15.49 }])],
  });
  assert.equal(groups.subscriptions.length, 1);
  assert.equal(groups.subscriptions[0]!.status, "possible");
  assert.equal(groups.subscriptions[0]!.chargeCount, 1);
  assert.match(
    groups.subscriptions[0]!.reason,
    /Possible subscription · recurrence not confirmed/
  );
  assert.doesNotMatch(groups.subscriptions[0]!.reason, /Confirmed subscription/i);
  assert.equal(groups.subscriptions[0]!.showMonthlyEstimate, false);
});

test("same merchant with 2–3 monthly charges can be confirmed", () => {
  const groups = buildActivityPresentationGroups({
    subscriptions: [
      baseSub({
        clusterId: "netflix",
        category: "streaming",
        normalizedName: "NETFLIX",
        amount: 15.49,
        totalSpentInPeriod: 46.47,
        frequency: "monthly",
        flags: { confirmed: true } as SubscriptionInsight["flags"],
        monthlyEquivalent: 15.49,
      }),
    ],
    visibleRecurring: [],
    visibleInsights: [],
    clusters: [
      cluster("netflix", [
        { date: "2026-05-01", amount: 15.49 },
        { date: "2026-06-01", amount: 15.49 },
        { date: "2026-07-01", amount: 15.49 },
      ]),
    ],
  });
  assert.equal(groups.subscriptions[0]!.status, "confirmed");
  assert.equal(groups.subscriptions[0]!.chargeCount, 3);
  assert.match(groups.subscriptions[0]!.reason, /Confirmed subscription/i);
  assert.equal(groups.subscriptions[0]!.showMonthlyEstimate, true);
});

test("phone bill with one charge is expected bill, not unusual or waste", () => {
  const groups = buildActivityPresentationGroups({
    subscriptions: [
      baseSub({
        clusterId: "phone",
        category: "utilities",
        normalizedName: "VERIZON WIRELESS",
        amount: 78,
        totalSpentInPeriod: 78,
        frequency: "monthly",
        flags: { confirmed: true } as SubscriptionInsight["flags"],
      }),
    ],
    visibleRecurring: [],
    visibleInsights: [],
    clusters: [cluster("phone", [{ date: "2026-07-01", amount: 78 }])],
  });
  assert.equal(groups.expectedRecurringBills.length, 1);
  assert.equal(groups.unusualRecurring.length, 0);
  assert.equal(
    groups.expectedRecurringBills[0]!.reason,
    "Expected bill category · recurrence not yet confirmed"
  );
  assert.doesNotMatch(
    groups.expectedRecurringBills[0]!.reason,
    /waste|Confirmed subscription|repeated/i
  );
});

test("variable utility monthly amounts stay expected bills", () => {
  const groups = buildActivityPresentationGroups({
    subscriptions: [
      baseSub({
        clusterId: "util",
        category: "utilities",
        normalizedName: "CITY POWER",
        amount: 97.1,
        totalSpentInPeriod: 191.2,
        frequency: "monthly",
        flags: { confirmed: true } as SubscriptionInsight["flags"],
      }),
    ],
    visibleRecurring: [],
    visibleInsights: [],
    clusters: [
      cluster("util", [
        { date: "2026-06-04", amount: 94.1 },
        { date: "2026-07-04", amount: 97.1 },
      ]),
    ],
  });
  assert.equal(groups.expectedRecurringBills.length, 1);
  assert.equal(groups.subscriptions.length, 0);
  assert.match(groups.expectedRecurringBills[0]!.reason, /Expected/i);
  assert.doesNotMatch(groups.expectedRecurringBills[0]!.reason, /waste|cancel/i);
});

test("one unusual merchant charge is one-time review, never recurring", () => {
  const groups = buildActivityPresentationGroups({
    subscriptions: [],
    visibleRecurring: [],
    visibleInsights: [
      baseSpend({
        clusterId: "odd",
        normalizedName: "TEMP VENDOR",
        kind: "needs_review",
        categoryKey: "other",
        amount: 40,
        totalSpentInPeriod: 40,
        recommendation: "Review this expense",
      }),
    ],
    clusters: [cluster("odd", [{ date: "2026-07-20", amount: 40 }])],
  });
  assert.equal(groups.unusualRecurring.length, 0);
  assert.equal(groups.oneTimeReview.length, 1);
  assert.equal(groups.oneTimeReview[0]!.chargeCount, 1);
  assert.match(groups.oneTimeReview[0]!.reason, /One-time activity/i);
  assert.doesNotMatch(
    groups.oneTimeReview[0]!.reason,
    /repeated charges deserve a closer look|Confirmed subscription/i
  );
  assert.match(groups.oneTimeReview[0]!.summaryLine, /1 charge detected/);
});

test("two unusual repeated charges stay unusual recurring", () => {
  const groups = buildActivityPresentationGroups({
    subscriptions: [],
    visibleRecurring: [],
    visibleInsights: [
      baseSpend({
        clusterId: "weird",
        normalizedName: "TEMP VENDOR",
        kind: "needs_review",
        categoryKey: "other",
        amount: 40,
        totalSpentInPeriod: 80,
        recommendation: "Review this expense",
      }),
    ],
    clusters: [
      cluster("weird", [
        { date: "2026-07-01", amount: 40 },
        { date: "2026-07-20", amount: 40 },
      ]),
    ],
  });
  assert.equal(groups.unusualRecurring.length, 1);
  assert.equal(groups.oneTimeReview.length, 0);
  assert.match(groups.unusualRecurring[0]!.reason, /Review this activity/i);
  assert.match(
    groups.unusualRecurring[0]!.reason,
    /repeated charges deserve a closer look|pattern is unclear/i
  );
  assert.doesNotMatch(
    groups.unusualRecurring[0]!.reason,
    /Confirmed subscription/i
  );
});

test("Lyft two-charge wording remains discretionary and count-truthful", () => {
  const groups = buildActivityPresentationGroups({
    subscriptions: [],
    visibleRecurring: [
      baseSpend({
        clusterId: "lyft",
        normalizedName: "LYFT RIDE",
        kind: "frequent_spending",
        categoryKey: "other",
        amount: 9.31,
        totalSpentInPeriod: 21.29,
        frequency: "unknown",
      }),
    ],
    visibleInsights: [],
    clusters: [
      cluster("lyft", [
        { date: "2026-07-05", amount: 11.98 },
        { date: "2026-07-22", amount: 9.31 },
      ]),
    ],
  });
  assert.equal(groups.repeatedDiscretionary.length, 1);
  assert.equal(groups.unusualRecurring.length, 0);
  assert.match(
    groups.repeatedDiscretionary[0]!.reason,
    /2 rideshare or delivery charges/
  );
  assert.equal(
    groups.repeatedDiscretionary[0]!.summaryLine,
    "2 charges detected · $21.29 total · latest charge $9.31"
  );
});

test("one overdraft fee is observed-only, not annualized as recurring", () => {
  const period = { start: "2026-07-01", end: "2026-07-31" };
  const savings = buildSavingsOpportunities({
    statementPeriod: period,
    clusters: [
      cluster("od", [{ date: "2026-07-12", amount: 35 }]),
    ],
    subscriptions: [],
    recurringExpenses: [],
    spendingInsights: [
      baseSpend({
        clusterId: "od",
        normalizedName: "OVERDRAFT FEE",
        kind: "fee",
        categoryKey: "fees",
        amount: 35,
        totalSpentInPeriod: 35,
      }),
    ],
    transfers: [],
  });
  const fee = savings.find((s) => s.id === "reduce-fees");
  assert.ok(fee);
  assert.equal(fee!.yearlySavings, 0);
  assert.equal(fee!.monthlySavings, 0);
  assert.equal(fee!.observedPeriodAmount, 35);
});

test("repeated overdraft fees may annualize", () => {
  const period = { start: "2026-07-01", end: "2026-07-31" };
  const savings = buildSavingsOpportunities({
    statementPeriod: period,
    clusters: [
      cluster("od", [
        { date: "2026-07-05", amount: 35 },
        { date: "2026-07-22", amount: 35 },
      ]),
    ],
    subscriptions: [],
    recurringExpenses: [],
    spendingInsights: [
      baseSpend({
        clusterId: "od",
        normalizedName: "OVERDRAFT FEE",
        kind: "fee",
        categoryKey: "fees",
        amount: 35,
        totalSpentInPeriod: 70,
      }),
    ],
    transfers: [],
  });
  const fee = savings.find((s) => s.id === "reduce-fees");
  assert.ok(fee);
  assert.ok(fee!.yearlySavings > 0);
  assert.doesNotMatch(fee!.explanation, /Observed amount only/);
});

test("one-time large transfer/purchase excluded from recurring groups and annual savings", () => {
  const groups = buildActivityPresentationGroups({
    subscriptions: [],
    visibleRecurring: [],
    visibleInsights: [
      baseSpend({
        clusterId: "xfer",
        normalizedName: "CASH APP",
        kind: "income_transfer",
        categoryKey: "transfers",
        amount: 2500,
        totalSpentInPeriod: 2500,
      }),
      baseSpend({
        clusterId: "tv",
        normalizedName: "BEST BUY",
        kind: "one_time_expense",
        categoryKey: "retail",
        amount: 899,
        totalSpentInPeriod: 899,
        recommendation: "Review this expense",
      }),
    ],
    clusters: [
      cluster("xfer", [{ date: "2026-07-10", amount: 2500 }]),
      cluster("tv", [{ date: "2026-07-18", amount: 899 }]),
    ],
  });
  assert.equal(groups.unusualRecurring.length, 0);
  assert.equal(groups.repeatedDiscretionary.length, 0);
  assert.equal(groups.subscriptions.length, 0);
  // Transfer omitted; retail one-time with no strong risk omitted.
  assert.equal(groups.oneTimeReview.length, 0);

  const savings = buildSavingsOpportunities({
    statementPeriod: { start: "2026-07-01", end: "2026-07-31" },
    clusters: [
      cluster("xfer", [{ date: "2026-07-10", amount: 2500 }]),
      cluster("tv", [{ date: "2026-07-18", amount: 899 }]),
      cluster("nf", [{ date: "2026-07-01", amount: 15.49 }]),
    ],
    subscriptions: [
      baseSub({
        clusterId: "nf",
        category: "streaming",
        normalizedName: "NETFLIX",
        amount: 15.49,
        totalSpentInPeriod: 15.49,
        flags: {
          confirmed: true,
          forgotten: true,
        } as SubscriptionInsight["flags"],
        monthlyEquivalent: 15.49,
        annualEquivalent: 185.88,
      }),
    ],
    recurringExpenses: [],
    spendingInsights: [
      baseSpend({
        clusterId: "xfer",
        normalizedName: "CASH APP",
        kind: "income_transfer",
        categoryKey: "transfers",
        amount: 2500,
        totalSpentInPeriod: 2500,
      }),
      baseSpend({
        clusterId: "tv",
        normalizedName: "BEST BUY",
        kind: "one_time_expense",
        categoryKey: "retail",
        amount: 899,
        totalSpentInPeriod: 899,
      }),
    ],
    transfers: [],
  });
  const flagged = savings.find((s) => s.id === "review-flagged-subs");
  assert.ok(flagged);
  assert.equal(flagged!.yearlySavings, 0);
  assert.match(flagged!.explanation, /Observed amount only/);
  assert.ok(!savings.some((s) => s.id === "streaming-bundle"));
});

test("truthful charge-count wording and no invented monthly from unknown cadence", () => {
  const line = formatUncertainActivitySummary({
    chargeCount: 2,
    periodTotal: 21.29,
    latestCharge: 9.31,
    currency: "USD",
  });
  assert.equal(
    line,
    "2 charges detected · $21.29 total · latest charge $9.31"
  );
  assert.equal(supportsMonthlyCadencePresentation("unknown", 2), false);
  assert.equal(supportsMonthlyCadencePresentation("monthly", 1), false);
  assert.equal(supportsMonthlyCadencePresentation("monthly", 2), true);
  const eq = equivalentsForFrequency(9.31, "unknown");
  assert.equal(eq.monthlyEquivalent, 0);
  assert.equal(eq.annualEquivalent, 0);
});

test("recurring phone bills with cadence stay expected, not cancellation targets", () => {
  const groups = buildActivityPresentationGroups({
    subscriptions: [
      baseSub({
        clusterId: "phone",
        category: "utilities",
        normalizedName: "VERIZON WIRELESS",
        amount: 78,
        frequency: "monthly",
        flags: { confirmed: true } as SubscriptionInsight["flags"],
      }),
    ],
    visibleRecurring: [],
    visibleInsights: [],
    clusters: [
      cluster("phone", [
        { date: "2026-06-01", amount: 78 },
        { date: "2026-07-01", amount: 78 },
      ]),
    ],
  });
  assert.equal(groups.expectedRecurringBills[0]?.status, "expected");
  assert.doesNotMatch(
    groups.expectedRecurringBills[0]!.reason,
    /Confirmed subscription/i
  );
});

test("repeated Lyft/Uber activity is discretionary and neutral", () => {
  const groups = buildActivityPresentationGroups({
    subscriptions: [],
    visibleRecurring: [
      baseSpend({
        clusterId: "uber",
        normalizedName: "UBER TRIP",
        kind: "frequent_spending",
        categoryKey: "other",
        amount: 18.4,
        totalSpentInPeriod: 55.2,
        frequency: "unknown",
      }),
    ],
    visibleInsights: [],
    clusters: [
      cluster("uber", [
        { date: "2026-07-03", amount: 18.4 },
        { date: "2026-07-11", amount: 16.2 },
        { date: "2026-07-29", amount: 20.6 },
      ]),
    ],
  });
  assert.equal(groups.repeatedDiscretionary.length, 1);
  assert.match(groups.repeatedDiscretionary[0]!.reason, /rideshare|delivery/i);
  assert.doesNotMatch(
    groups.repeatedDiscretionary[0]!.reason,
    /should not|stop spending|waste/i
  );
});

test("repeated food purchases are discretionary", () => {
  const groups = buildActivityPresentationGroups({
    subscriptions: [],
    visibleRecurring: [
      baseSpend({
        clusterId: "food",
        normalizedName: "CORNER CAFE",
        kind: "frequent_spending",
        categoryKey: "restaurants",
        amount: 14.75,
        totalSpentInPeriod: 44.25,
      }),
    ],
    visibleInsights: [],
    clusters: [
      cluster("food", [
        { date: "2026-07-02", amount: 14.75 },
        { date: "2026-07-09", amount: 12.5 },
        { date: "2026-07-16", amount: 17 },
      ]),
    ],
  });
  assert.equal(groups.repeatedDiscretionary.length, 1);
  assert.match(groups.repeatedDiscretionary[0]!.reason, /food|dining/i);
});

test("two irregular charges use uncertain summary wording", () => {
  const groups = buildActivityPresentationGroups({
    subscriptions: [],
    visibleRecurring: [],
    visibleInsights: [
      baseSpend({
        clusterId: "odd",
        normalizedName: "UNKNOWN MERCHANT",
        kind: "needs_review",
        categoryKey: "other",
        amount: 9.31,
        totalSpentInPeriod: 21.29,
        frequency: "unknown",
        recommendation: "Review this expense",
      }),
    ],
    clusters: [
      cluster("odd", [
        { date: "2026-07-05", amount: 11.98 },
        { date: "2026-07-22", amount: 9.31 },
      ]),
    ],
  });
  assert.equal(groups.unusualRecurring.length, 1);
  assert.equal(
    groups.unusualRecurring[0]!.summaryLine,
    "2 charges detected · $21.29 total · latest charge $9.31"
  );
  assert.equal(groups.unusualRecurring[0]!.showMonthlyEstimate, false);
});

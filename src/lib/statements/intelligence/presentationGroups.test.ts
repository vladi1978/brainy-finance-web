/**
 * Regression: recurring activity presentation groups and honest cadence wording.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { equivalentsForFrequency } from "../heuristics";
import type { MerchantCluster, SpendingInsight, SubscriptionInsight } from "../types";
import {
  buildActivityPresentationGroups,
  formatUncertainActivitySummary,
  supportsMonthlyCadencePresentation,
} from "./presentationGroups";

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

test("variable utility bills land in expected recurring bills", () => {
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

test("recurring phone bills are expected, not cancellation targets", () => {
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
  assert.doesNotMatch(groups.repeatedDiscretionary[0]!.reason, /should not|stop spending|waste/i);
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

test("confirmed subscriptions stay in subscriptions group", () => {
  const groups = buildActivityPresentationGroups({
    subscriptions: [
      baseSub({
        clusterId: "netflix",
        category: "streaming",
        normalizedName: "NETFLIX",
        amount: 15.49,
        frequency: "monthly",
        flags: { confirmed: true } as SubscriptionInsight["flags"],
        monthlyEquivalent: 15.49,
      }),
    ],
    visibleRecurring: [],
    visibleInsights: [],
    clusters: [
      cluster("netflix", [
        { date: "2026-06-01", amount: 15.49 },
        { date: "2026-07-01", amount: 15.49 },
      ]),
    ],
  });
  assert.equal(groups.subscriptions.length, 1);
  assert.equal(groups.subscriptions[0]!.status, "confirmed");
  assert.match(groups.subscriptions[0]!.reason, /Confirmed subscription/i);
});

test("two irregular charges use uncertain summary wording", () => {
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

test("latest amount is not misrepresented as monthly", () => {
  assert.equal(supportsMonthlyCadencePresentation("unknown", 2), false);
  assert.equal(supportsMonthlyCadencePresentation("monthly", 1), false);
  assert.equal(supportsMonthlyCadencePresentation("monthly", 2), true);

  const eq = equivalentsForFrequency(9.31, "unknown");
  assert.equal(eq.monthlyEquivalent, 0);
  assert.equal(eq.annualEquivalent, 0);

  const groups = buildActivityPresentationGroups({
    subscriptions: [
      baseSub({
        clusterId: "maybe",
        category: "streaming",
        normalizedName: "MAYBE STREAM",
        amount: 9.31,
        frequency: "unknown",
        monthlyEquivalent: 0,
        totalSpentInPeriod: 9.31,
        flags: { reviewSuggested: true } as SubscriptionInsight["flags"],
      }),
    ],
    visibleRecurring: [],
    visibleInsights: [],
    clusters: [cluster("maybe", [{ date: "2026-07-22", amount: 9.31 }])],
  });
  const card = groups.subscriptions[0] ?? groups.unusualRecurring[0];
  assert.ok(card);
  assert.equal(card!.showMonthlyEstimate, false);
  assert.doesNotMatch(card!.summaryLine, /per month|\/mo/i);
  assert.match(card!.summaryLine, /latest charge \$9\.31/i);
});

test("unusual merchant review wording is not confirmed subscription", () => {
  const groups = buildActivityPresentationGroups({
    subscriptions: [],
    visibleRecurring: [],
    visibleInsights: [
      baseSpend({
        clusterId: "weird",
        normalizedName: "TEMP VENDOR",
        kind: "needs_review",
        categoryKey: "other",
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
  assert.match(groups.unusualRecurring[0]!.reason, /Review this activity/i);
  assert.doesNotMatch(
    groups.unusualRecurring[0]!.reason,
    /Confirmed subscription/i
  );
});

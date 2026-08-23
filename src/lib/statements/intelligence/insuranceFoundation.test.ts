/**
 * Insurance classifier + savings neutrality regressions.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  INSURANCE_OBSERVED_NEUTRAL,
  INSURANCE_TYPE_NOT_CONFIRMED,
  classifyInsurancePayment,
  insuranceTypeDisplayLabel,
} from "../insuranceClassify";
import {
  getActiveInsurancePartners,
  insuranceReferralsEnabled,
  isInsuranceReferralsFlagEnabled,
  listInsurancePartners,
} from "../../insurance/partnerRegistry";
import { isExpectedBillSubscription } from "../expectedBills";
import { buildSavingsOpportunities } from "../intelligence/savings";
import { buildInsightsFeed } from "../intelligence/insightsFeed";
import { buildRecommendations } from "../recommendations";
import { buildHealthScore } from "../intelligence/healthScore";
import { buildFinancialSummary } from "../intelligence/buildFinancialSummary";
import type { IntelligenceInput } from "../intelligence/types";
import type {
  MerchantCluster,
  SpendingInsight,
  SubscriptionInsight,
} from "../types";

function cluster(
  id: string,
  charges: Array<{ date: string; amount: number }>,
  descriptions: string[]
): MerchantCluster {
  return {
    id,
    key: id,
    descriptions,
    charges: charges.map((c) => ({
      date: c.date,
      amount: c.amount,
      type: "debit" as const,
      currency: "USD",
    })),
  };
}

function insuranceSub(partial?: Partial<SubscriptionInsight>): SubscriptionInsight {
  return {
    merchant: "GEICO",
    normalizedName: "GEICO",
    category: "insurance",
    amount: 180,
    currency: "USD",
    frequency: "monthly",
    lastCharged: "2026-07-01",
    monthlyEquivalent: 180,
    annualEquivalent: 2160,
    confidence: 0.92,
    trueSubscriptionScore: 0.9,
    flags: {
      forgotten: false,
      duplicate: false,
      priceIncreased: false,
      trialConverted: false,
      suspicious: false,
      reviewSuggested: false,
      confirmed: true,
    },
    clusterId: "geico",
    totalSpentInPeriod: 360,
    daysSinceLastCharge: 5,
    ...partial,
  };
}

test("classifier: auto brands and subtypes", () => {
  const geico = classifyInsurancePayment("GEICO AUTO INS PREM");
  assert.equal(geico.isInsurance, true);
  assert.equal(geico.brand, "GEICO");
  assert.equal(geico.type, "auto");

  const home = classifyInsurancePayment("STATE FARM HOMEOWNERS INS");
  assert.equal(home.isInsurance, true);
  assert.equal(home.type, "home");
  assert.equal(home.brand, "State Farm");

  const renters = classifyInsurancePayment("ALLSTATE RENTERS INS");
  assert.equal(renters.isInsurance, true);
  assert.equal(renters.type, "renters");
});

test("classifier: unknown type stays not confirmed", () => {
  const u = classifyInsurancePayment("ACME INS PREM ACH");
  assert.equal(u.isInsurance, true);
  assert.equal(u.type, "unknown");
  assert.equal(insuranceTypeDisplayLabel(u), INSURANCE_TYPE_NOT_CONFIRMED);
});

test("classifier: Progressive Leasing is not insurance", () => {
  const leasing = classifyInsurancePayment("PROGRESSIVE LEASING PAYMENT");
  assert.equal(leasing.isInsurance, false);
  assert.equal(classifyInsurancePayment("PROGRESSIVE").isInsurance, false);
});

test("classifier: Progressive insurance still detects", () => {
  const prog = classifyInsurancePayment("PROGRESSIVE INSURANCE");
  assert.equal(prog.isInsurance, true);
  assert.equal(prog.brand, "Progressive");
});

test("partner registry has no active referrals", () => {
  assert.equal(isInsuranceReferralsFlagEnabled(), false);
  assert.equal(getActiveInsurancePartners().length, 0);
  assert.equal(insuranceReferralsEnabled(), false);
  assert.ok(listInsurancePartners().every((p) => p.active === false));
  assert.ok(listInsurancePartners().every((p) => p.urlTemplate == null));
});

test("referrals flag alone cannot enable referrals without an active partner", () => {
  const prev = process.env.INSURANCE_REFERRALS_ENABLED;
  process.env.INSURANCE_REFERRALS_ENABLED = "true";
  try {
    assert.equal(isInsuranceReferralsFlagEnabled(), true);
    assert.equal(getActiveInsurancePartners().length, 0);
    assert.equal(insuranceReferralsEnabled(), false);
  } finally {
    if (prev === undefined) delete process.env.INSURANCE_REFERRALS_ENABLED;
    else process.env.INSURANCE_REFERRALS_ENABLED = prev;
  }
});

test("high insurance premium does not invent savings or lower health via savings opps", () => {
  const geicoCluster = cluster(
    "geico",
    [
      { date: "2026-06-01", amount: 180 },
      { date: "2026-07-01", amount: 180 },
    ],
    ["GEICO AUTO"]
  );
  const input: IntelligenceInput = {
    statementPeriod: { start: "2026-06-01", end: "2026-07-31" },
    clusters: [geicoCluster],
    subscriptions: [insuranceSub()],
    recurringExpenses: [],
    spendingInsights: [],
    transfers: [],
  };

  assert.equal(isExpectedBillSubscription(insuranceSub()), true);

  const savings = buildSavingsOpportunities(input);
  assert.equal(
    savings.some((s) => s.id === "compare-insurance" || /insurance/i.test(s.id)),
    false
  );
  assert.equal(
    savings.some((s) => s.yearlySavings > 0 && /insurance/i.test(s.title)),
    false
  );

  const insights = buildInsightsFeed(input);
  const card = insights.find((c) => c.id === "insurance-observed");
  assert.ok(card);
  assert.equal(card!.explanation, INSURANCE_OBSERVED_NEUTRAL);
  assert.equal(card!.annualImpact, undefined);
  assert.equal(/high|save|\$\d+/i.test(card!.title), false);

  const recs = buildRecommendations(input);
  const insRec = recs.items.find((i) => i.actionType === "compare_insurance");
  assert.equal(insRec, undefined);

  const financial = buildFinancialSummary(savings, recs);
  assert.equal(financial.optimization.yearlyHigh, 0);
  assert.equal(financial.actionableYearly, 0);
  assert.equal(financial.actionableMonthly, 0);

  const health = buildHealthScore(input);
  assert.equal(
    health.factors.some((f) => /insurance/i.test(f.label)),
    false
  );
  // Expected bill excluded from confirmed sub load — high premium alone is not a penalty.
  assert.equal(
    health.factors.some((f) => f.id === "subscription-load" && f.impact < 0),
    false
  );
});

test("affiliate/registry inactivity cannot create savings", () => {
  assert.equal(insuranceReferralsEnabled(), false);
  const input: IntelligenceInput = {
    statementPeriod: { start: "2026-06-01", end: "2026-07-31" },
    clusters: [
      cluster("geico", [{ date: "2026-07-01", amount: 200 }], ["GEICO"]),
    ],
    subscriptions: [
      insuranceSub({
        flags: {
          forgotten: false,
          duplicate: false,
          priceIncreased: false,
          trialConverted: false,
          suspicious: false,
          reviewSuggested: false,
          confirmed: false,
        },
        monthlyEquivalent: 0,
        annualEquivalent: 0,
        totalSpentInPeriod: 200,
        amount: 200,
      }),
    ],
    recurringExpenses: [],
    spendingInsights: [
      {
        clusterId: "geico",
        merchant: "GEICO",
        normalizedName: "GEICO",
        categoryLabel: "insurance",
        categoryKey: "fees",
        kind: "one_time_expense",
        recommendation: "Review this expense",
        amount: 200,
        currency: "USD",
        frequency: "unknown",
        totalSpentInPeriod: 200,
        lastCharged: "2026-07-01",
        recurringExpenseScore: 0.2,
        spendingInsightScore: 0.4,
      } as SpendingInsight,
    ],
    transfers: [],
  };
  // Force category via classifier path on spend text in insights.
  input.spendingInsights[0]!.categoryKey = "other";
  input.spendingInsights[0]!.categoryLabel = "other";
  input.spendingInsights[0]!.normalizedName = "GEICO AUTO INS";

  const savings = buildSavingsOpportunities(input);
  assert.equal(savings.some((s) => s.yearlySavings > 0), false);
  const insights = buildInsightsFeed(input);
  assert.ok(insights.some((c) => c.id === "insurance-observed"));
});

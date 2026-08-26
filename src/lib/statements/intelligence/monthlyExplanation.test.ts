import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMerchantClusters } from "../clusters";
import type { Transaction } from "../types";
import { buildStatementActivitySummary } from "./statementActivity";
import {
  buildDebtGuidance,
  buildMonthlyExplanation,
  buildSpendingScenario,
  DEBT_CALL_SCRIPT,
  DEBT_CALL_SAFETY,
  DEBT_COMPARE_CHECKLIST,
  DEBT_LEGAL_DISCLAIMER,
  DEBT_REFINANCE_WARNING,
  FLEXIBLE_SCENARIO_IDS,
  flexibleScenarioExcludesProtectedCategories,
} from "./monthlyExplanation";

function txn(
  date: string,
  description: string,
  amount: number,
  type: "debit" | "credit" = "debit"
): Transaction {
  return { date, description, amount, type, currency: "USD" };
}

function activityFor(
  txns: Transaction[],
  opts?: {
    deposits?: number | null;
    withdrawals?: number | null;
  }
) {
  const clusters = buildMerchantClusters(txns);
  return buildStatementActivitySummary({
    transactions: txns,
    clusters,
    subscriptions: [],
    statementPeriod: { start: "2026-06-10", end: "2026-07-09" },
    statementSummary: {
      depositsTotal: opts?.deposits ?? null,
      withdrawalsTotal: opts?.withdrawals ?? null,
    },
  });
}

describe("monthly explanation", () => {
  it("explains a reconciled negative month without judgment language", () => {
    const txns = [
      txn("2026-06-15", "US BANK MORTGAGE PAYMENT DES:PAYMENT", 1100),
      txn("2026-06-16", "REPUBLICSERVICES DES:RSIBILLPAY", 105),
      txn("2026-06-17", "STATE FARM INSURANCE", 92),
      txn("2026-06-18", "SYNCHRONY BANK DES:PAYMENT", 200),
      txn("2026-06-19", "CHECKCARD SAMSCLUB", 400),
      txn("2026-06-20", "SHELL OIL", 80),
      txn("2026-06-10", "JCWLLC DES:PAYROLL", 1500, "credit"),
    ];
    // Force reconcile by matching totals
    const moneyOut = 1100 + 105 + 92 + 200 + 400 + 80;
    const moneyIn = 1500;
    const activity = activityFor(txns, {
      deposits: moneyIn,
      withdrawals: moneyOut,
    });
    assert.equal(activity.ledger.status, "reconciled");
    assert.ok(activity.netCashFlow != null && activity.netCashFlow < 0);

    const expl = buildMonthlyExplanation({
      activity,
      statementPeriod: { start: "2026-06-10", end: "2026-07-09" },
      healthScore: 98,
    });
    assert.equal(expl.outcome, "negative");
    assert.match(expl.headline, /more than you received/i);
    assert.doesNotMatch(expl.headline, /wasteful|bad spending|overspent/i);
    assert.ok(expl.topFactors.length <= 4);
    assert.ok(expl.topFactors.length >= 1);
    assert.ok(expl.healthCashFlowClarification);
    assert.match(
      expl.healthCashFlowClarification!,
      /does not mean the month had a positive cash flow/i
    );
    assert.equal(expl.compareLastMonth.comparisonCalculated, false);
    assert.match(expl.compareLastMonth.message, /no comparison has been calculated/i);
  });

  it("explains a reconciled positive month", () => {
    const txns = [
      txn("2026-06-15", "SHELL OIL", 40),
      txn("2026-06-10", "JCWLLC DES:PAYROLL", 2000, "credit"),
    ];
    const activity = activityFor(txns, { deposits: 2000, withdrawals: 40 });
    const expl = buildMonthlyExplanation({ activity, healthScore: 90 });
    assert.equal(expl.outcome, "positive");
    assert.match(expl.headline, /more than you spent/i);
    assert.equal(expl.healthCashFlowClarification, null);
  });

  it("explains a near-zero result", () => {
    const txns = [
      txn("2026-06-15", "SHELL OIL", 100),
      txn("2026-06-10", "JCWLLC DES:PAYROLL", 100, "credit"),
    ];
    const activity = activityFor(txns, { deposits: 100, withdrawals: 100 });
    const expl = buildMonthlyExplanation({ activity });
    assert.equal(expl.outcome, "near_zero");
    assert.match(expl.headline, /nearly even/i);
  });

  it("withholds cause when ledger is unreconciled", () => {
    const txns = [
      txn("2026-06-15", "SHELL OIL", 40),
      txn("2026-06-10", "PMNT RCVD", 50, "credit"),
    ];
    const activity = activityFor(txns, {
      deposits: 3189.48,
      withdrawals: 4042.25,
    });
    assert.notEqual(activity.ledger.status, "reconciled");
    const expl = buildMonthlyExplanation({ activity });
    assert.equal(expl.outcome, "unreliable");
    assert.match(expl.headline, /cannot reliably explain/i);
    assert.equal(expl.topFactors.length, 0);
  });

  it("handles statements with no detected income", () => {
    const txns = [txn("2026-06-15", "SHELL OIL", 40)];
    const activity = activityFor(txns, { deposits: 0, withdrawals: 40 });
    // deposits 0 may still reconcile if reported is 0
    const expl = buildMonthlyExplanation({ activity });
    if (activity.cashFlowReliable && activity.moneyIn <= 0) {
      assert.equal(expl.outcome, "no_income");
      assert.match(expl.headline, /did not detect money received/i);
    } else {
      assert.ok(
        expl.outcome === "no_income" || expl.outcome === "unreliable"
      );
    }
  });

  it("notes shorter-than-month periods", () => {
    const txns = [
      txn("2026-06-01", "SHELL OIL", 10),
      txn("2026-06-05", "JCWLLC DES:PAYROLL", 50, "credit"),
    ];
    const activity = activityFor(txns, { deposits: 50, withdrawals: 10 });
    const expl = buildMonthlyExplanation({
      activity,
      statementPeriod: { start: "2026-06-01", end: "2026-06-10" },
    });
    assert.ok(expl.periodNote);
    assert.match(expl.periodNote!, /shorter than a typical month/i);
  });
});

describe("commitment groups and scenarios", () => {
  it("keeps housing/bills/insurance/debt out of flexible scenarios", () => {
    assert.equal(flexibleScenarioExcludesProtectedCategories(), true);
    assert.ok(!FLEXIBLE_SCENARIO_IDS.includes("housing"));
    assert.ok(!FLEXIBLE_SCENARIO_IDS.includes("debt_financing"));
    assert.ok(!FLEXIBLE_SCENARIO_IDS.includes("transfers_payments"));
    assert.ok(!FLEXIBLE_SCENARIO_IDS.includes("fees"));
  });

  it("builds 5/10/15% scenarios only on flexible totals", () => {
    const txns = [
      txn("2026-06-15", "US BANK MORTGAGE PAYMENT DES:PAYMENT", 1000),
      txn("2026-06-16", "SYNCHRONY BANK DES:PAYMENT", 200),
      txn("2026-06-17", "CHECKCARD SAMSCLUB", 100),
      txn("2026-06-18", "SHELL OIL", 50),
      txn("2026-06-10", "JCWLLC DES:PAYROLL", 2000, "credit"),
    ];
    const moneyOut = 1000 + 200 + 100 + 50;
    const activity = activityFor(txns, {
      deposits: 2000,
      withdrawals: moneyOut,
    });
    const expl = buildMonthlyExplanation({ activity });
    const flexible = expl.commitmentGroups.find((g) => g.id === "flexible")!;
    const essential = expl.commitmentGroups.find((g) => g.id === "essential")!;
    const financial = expl.commitmentGroups.find((g) => g.id === "financial")!;
    assert.ok(essential.total >= 1000);
    assert.equal(financial.total, 200);
    assert.equal(flexible.total, 150);

    for (const percent of [5, 10, 15] as const) {
      const scenario = buildSpendingScenario({ activity, percent });
      assert.equal(scenario.eligible, true);
      assert.equal(scenario.flexibleBase, 150);
      assert.equal(
        scenario.illustrativeAmount,
        Math.round(150 * (percent / 100) * 100) / 100
      );
      assert.match(scenario.disclaimer, /Illustrative scenario/i);
      assert.match(scenario.periodScopeNote, /not a monthly or annual projection/i);
      assert.doesNotMatch(
        scenario.periodScopeNote,
        /would save .* per year|annual savings of/i
      );
    }
  });

  it("disables scenarios when ledger is unreliable", () => {
    const activity = activityFor(
      [txn("2026-06-15", "CHECKCARD SAMSCLUB", 100)],
      { deposits: 5000, withdrawals: 9000 }
    );
    const scenario = buildSpendingScenario({ activity, percent: 10 });
    assert.equal(scenario.eligible, false);
    assert.equal(scenario.illustrativeAmount, 0);
  });
});

describe("educational debt guidance", () => {
  it("returns null without debt_financing", () => {
    const activity = activityFor([
      txn("2026-06-15", "SHELL OIL", 40),
      txn("2026-06-10", "JCWLLC DES:PAYROLL", 100, "credit"),
    ]);
    assert.equal(buildDebtGuidance(activity), null);
  });

  it("reports observed debt facts only and includes required warnings", () => {
    const txns = [
      txn("2026-06-08", "SYNCHRONY BANK DES:PAYMENT", 63),
      txn("2026-06-09", "AFFIRM.COM PAYME DES:AFFIRM.COM", 126.24),
      txn("2026-06-10", "JCWLLC DES:PAYROLL", 500, "credit"),
    ];
    const activity = activityFor(txns, {
      deposits: 500,
      withdrawals: 63 + 126.24,
    });
    const guidance = buildDebtGuidance(activity);
    assert.ok(guidance);
    assert.equal(guidance!.totalPaid, 189.24);
    assert.equal(guidance!.transactionCount, 2);
    assert.ok(guidance!.creditors.length >= 1);
    assert.equal(guidance!.legalDisclaimer, DEBT_LEGAL_DISCLAIMER);
    assert.equal(guidance!.refinanceTotalCostWarning, DEBT_REFINANCE_WARNING);
    assert.match(guidance!.refinanceTotalCostWarning, /total amount paid/i);
    assert.equal(guidance!.callScript, DEBT_CALL_SCRIPT);
    assert.equal(guidance!.callScriptSafetyNote, DEBT_CALL_SAFETY);
    assert.doesNotMatch(guidance!.callScript, /password|PIN|SSN|account number/i);
    assert.ok(
      guidance!.educationalOptions.some((o) => /hardship/i.test(o))
    );
    assert.deepEqual(guidance!.compareChecklist, [...DEBT_COMPARE_CHECKLIST]);
    // No invented APR / balance / savings claims in the payload strings
    const blob = JSON.stringify(guidance);
    assert.doesNotMatch(blob, /APR is|outstanding balance|you will save|guaranteed/i);
  });
});

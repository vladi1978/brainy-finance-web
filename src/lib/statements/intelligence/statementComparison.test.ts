import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMerchantClusters } from "../clusters";
import type { Transaction } from "../types";
import { buildStatementActivitySummary } from "./statementActivity";
import { buildHealthScore } from "./healthScore";
import {
  COMPARISON_MATERIALITY,
  answerComparisonQuestion,
  buildStatementComparison,
  buildStatementFingerprint,
  evaluateComparisonEligibility,
} from "./statementComparison";
import { FLEXIBLE_SCENARIO_IDS } from "./monthlyExplanation";

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
  period: { start: string; end: string },
  opts?: { deposits?: number | null; withdrawals?: number | null }
) {
  const clusters = buildMerchantClusters(txns);
  const moneyIn = txns
    .filter((t) => t.type === "credit")
    .reduce((s, t) => s + t.amount, 0);
  const moneyOut = txns
    .filter((t) => t.type === "debit")
    .reduce((s, t) => s + t.amount, 0);
  return buildStatementActivitySummary({
    transactions: txns,
    clusters,
    subscriptions: [],
    statementPeriod: period,
    statementSummary: {
      depositsTotal: opts?.deposits ?? moneyIn,
      withdrawalsTotal: opts?.withdrawals ?? moneyOut,
    },
  });
}

const PREV_PERIOD = { start: "2026-05-10", end: "2026-06-09" };
const CURR_PERIOD = { start: "2026-06-10", end: "2026-07-09" };

function basePrevious(): Transaction[] {
  return [
    txn("2026-05-12", "JCWLLC DES:PAYROLL", 3000, "credit"),
    txn("2026-05-15", "US BANK MORTGAGE PAYMENT", 1100),
    txn(
      "2026-05-16",
      "ATT DES:PAYMENT ID:XXXXXXXXXEPAYP INDN:CUSTOMER CO ID:123 PPD",
      142
    ),
    txn("2026-05-18", "CHECKCARD SAMSCLUB", 200),
    txn("2026-05-20", "SHELL OIL", 60),
    txn("2026-05-22", "PURCHASE NETFLIX.COM", 15.49),
  ];
}

function baseCurrent(overrides?: {
  income?: number;
  shopping?: number;
  fuel?: number;
  att?: number;
  addNetflix?: boolean;
  addPeacock?: boolean;
  fee?: number;
}): Transaction[] {
  const income = overrides?.income ?? 3000;
  const shopping = overrides?.shopping ?? 200;
  const fuel = overrides?.fuel ?? 60;
  const att = overrides?.att ?? 142;
  const rows: Transaction[] = [
    txn("2026-06-12", "JCWLLC DES:PAYROLL", income, "credit"),
    txn("2026-06-15", "US BANK MORTGAGE PAYMENT", 1100),
    txn(
      "2026-06-16",
      "ATT DES:PAYMENT ID:XXXXXXXXXEPAYP INDN:CUSTOMER CO ID:123 PPD",
      att
    ),
    txn("2026-06-18", "CHECKCARD SAMSCLUB", shopping),
    txn("2026-06-20", "SHELL OIL", fuel),
  ];
  if (overrides?.addNetflix !== false) {
    rows.push(txn("2026-06-22", "PURCHASE NETFLIX.COM", 15.49));
  }
  if (overrides?.addPeacock) {
    rows.push(txn("2026-06-23", "CHECKCARD Peacock TV LLC", 11.58));
  }
  if (overrides?.fee) {
    rows.push(txn("2026-06-24", "OVERDRAFT FEE", overrides.fee));
  }
  return rows;
}

describe("UX step 4 statement comparison", () => {
  it("detects higher current spending", () => {
    const prev = activityFor(basePrevious(), PREV_PERIOD);
    const curr = activityFor(
      baseCurrent({ shopping: 414 }),
      CURR_PERIOD
    );
    const cmp = buildStatementComparison({
      previous: prev,
      current: curr,
      previousPeriod: PREV_PERIOD,
      currentPeriod: CURR_PERIOD,
    });
    assert.equal(cmp.status, "ready");
    assert.ok(cmp.moneySpent.dollarDelta > 200);
    assert.equal(cmp.moneySpent.direction, "increased");
    assert.match(cmp.summarySentence, /spent \$|more/i);
  });

  it("detects lower current spending", () => {
    const prev = activityFor(basePrevious(), PREV_PERIOD);
    const curr = activityFor(baseCurrent({ shopping: 50 }), CURR_PERIOD);
    const cmp = buildStatementComparison({
      previous: prev,
      current: curr,
      previousPeriod: PREV_PERIOD,
      currentPeriod: CURR_PERIOD,
    });
    assert.ok(cmp.moneySpent.dollarDelta < 0);
    assert.equal(cmp.moneySpent.direction, "decreased");
  });

  it("detects income higher and lower", () => {
    const prev = activityFor(basePrevious(), PREV_PERIOD);
    const higher = buildStatementComparison({
      previous: prev,
      current: activityFor(baseCurrent({ income: 3180 }), CURR_PERIOD),
      previousPeriod: PREV_PERIOD,
      currentPeriod: CURR_PERIOD,
    });
    assert.equal(higher.moneyReceived.direction, "increased");
    assert.ok(higher.moneyReceived.dollarDelta > 0);

    const lower = buildStatementComparison({
      previous: prev,
      current: activityFor(baseCurrent({ income: 2820 }), CURR_PERIOD),
      previousPeriod: PREV_PERIOD,
      currentPeriod: CURR_PERIOD,
    });
    assert.equal(lower.moneyReceived.direction, "decreased");
    assert.ok(lower.moneyReceived.dollarDelta < 0);
  });

  it("compares reliable net cash flow", () => {
    const prev = activityFor(basePrevious(), PREV_PERIOD);
    const curr = activityFor(baseCurrent({ shopping: 400 }), CURR_PERIOD);
    const cmp = buildStatementComparison({
      previous: prev,
      current: curr,
      previousPeriod: PREV_PERIOD,
      currentPeriod: CURR_PERIOD,
    });
    assert.equal(cmp.netCashFlow.available, true);
    assert.ok(cmp.netCashFlow.dollarDelta != null);
    assert.equal(
      cmp.netCashFlow.dollarDelta,
      round(curr.netCashFlow! - prev.netCashFlow!)
    );
  });

  it("suppresses definitive net comparison when unreconciled", () => {
    const prev = activityFor(basePrevious(), PREV_PERIOD);
    const curr = activityFor(baseCurrent({ shopping: 400 }), CURR_PERIOD, {
      deposits: 9000,
      withdrawals: 9000,
    });
    const cmp = buildStatementComparison({
      previous: prev,
      current: curr,
      previousPeriod: PREV_PERIOD,
      currentPeriod: CURR_PERIOD,
    });
    assert.notEqual(cmp.status, "ready");
    assert.equal(cmp.netCashFlow.available, false);
    assert.match(cmp.summarySentence, /Observed|cannot|provisional/i);
  });

  it("suppresses misleading percentages from tiny baselines", () => {
    const prevTxns = [
      txn("2026-05-12", "JCWLLC DES:PAYROLL", 100, "credit"),
      txn("2026-05-15", "US BANK MORTGAGE PAYMENT", 40),
      txn("2026-05-18", "CHECKCARD SAMSCLUB", 5),
      txn("2026-05-20", "SHELL OIL", 5),
    ];
    const currTxns = [
      txn("2026-06-12", "JCWLLC DES:PAYROLL", 100, "credit"),
      txn("2026-06-15", "US BANK MORTGAGE PAYMENT", 40),
      txn("2026-06-18", "CHECKCARD SAMSCLUB", 40),
      txn("2026-06-20", "SHELL OIL", 5),
    ];
    const prev = activityFor(prevTxns, PREV_PERIOD);
    const curr = activityFor(currTxns, CURR_PERIOD);
    const cmp = buildStatementComparison({
      previous: prev,
      current: curr,
      previousPeriod: PREV_PERIOD,
      currentPeriod: CURR_PERIOD,
    });
    const shopping = cmp.categories.find((c) => c.id === "shopping");
    assert.ok(shopping);
    assert.equal(shopping!.percentDelta, null);
    assert.ok(
      Math.abs(prev.moneyOut) < COMPARISON_MATERIALITY.MIN_PERCENT_BASELINE ||
        shopping!.previous < COMPARISON_MATERIALITY.MIN_PERCENT_BASELINE
    );
  });

  it("flags a new bill", () => {
    const prev = activityFor(
      basePrevious().filter((t) => !/REPUBLIC|ATT/i.test(t.description)),
      PREV_PERIOD
    );
    // previous without AT&T — rebuild clean previous
    const prevClean = activityFor(
      [
        txn("2026-05-12", "JCWLLC DES:PAYROLL", 3000, "credit"),
        txn("2026-05-15", "US BANK MORTGAGE PAYMENT", 1100),
        txn("2026-05-18", "CHECKCARD SAMSCLUB", 200),
        txn("2026-05-20", "SHELL OIL", 60),
        txn("2026-05-22", "PURCHASE NETFLIX.COM", 15.49),
      ],
      PREV_PERIOD
    );
    void prev;
    const curr = activityFor(baseCurrent({ att: 168 }), CURR_PERIOD);
    const cmp = buildStatementComparison({
      previous: prevClean,
      current: curr,
      previousPeriod: PREV_PERIOD,
      currentPeriod: CURR_PERIOD,
    });
    assert.ok(
      cmp.merchantChanges.some(
        (m) => m.kind === "bill_new" && /AT&T|ATT/i.test(m.displayName)
      )
    );
  });

  it("flags bill amount increase", () => {
    const prev = activityFor(basePrevious(), PREV_PERIOD);
    const curr = activityFor(baseCurrent({ att: 168 }), CURR_PERIOD);
    const cmp = buildStatementComparison({
      previous: prev,
      current: curr,
      previousPeriod: PREV_PERIOD,
      currentPeriod: CURR_PERIOD,
    });
    const att = cmp.merchantChanges.find(
      (m) => m.kind === "bill_increased" && /AT&T/i.test(m.displayName)
    );
    assert.ok(att);
    assert.equal(att!.previous, 142);
    assert.equal(att!.current, 168);
  });

  it("uses not observed language instead of cancelled", () => {
    const prev = activityFor(basePrevious(), PREV_PERIOD);
    const curr = activityFor(
      baseCurrent({ addNetflix: false }).concat([
        // keep activity count with a different digital charge that is not a sub gate
        txn("2026-06-22", "PURCHASE SERPAPI, LLC", 15.49),
      ]),
      CURR_PERIOD
    );
    // Remove AT&T from current to test bill not observed
    const currNoAtt = activityFor(
      [
        txn("2026-06-12", "JCWLLC DES:PAYROLL", 3000, "credit"),
        txn("2026-06-15", "US BANK MORTGAGE PAYMENT", 1100),
        txn("2026-06-18", "CHECKCARD SAMSCLUB", 200),
        txn("2026-06-20", "SHELL OIL", 60),
        txn("2026-06-22", "PURCHASE NETFLIX.COM", 15.49),
      ],
      CURR_PERIOD
    );
    void curr;
    const cmp = buildStatementComparison({
      previous: prev,
      current: currNoAtt,
      previousPeriod: PREV_PERIOD,
      currentPeriod: CURR_PERIOD,
    });
    const gone = cmp.merchantChanges.find((m) => m.kind === "bill_not_observed");
    assert.ok(gone);
    assert.match(gone!.evidence, /Not observed/i);
    assert.doesNotMatch(gone!.evidence, /cancel/i);
  });

  it("flags a new possible subscription", () => {
    const prev = activityFor(basePrevious(), PREV_PERIOD);
    const curr = activityFor(
      baseCurrent({ addPeacock: true }),
      CURR_PERIOD
    );
    const cmp = buildStatementComparison({
      previous: prev,
      current: curr,
      previousPeriod: PREV_PERIOD,
      currentPeriod: CURR_PERIOD,
    });
    assert.ok(
      cmp.merchantChanges.some(
        (m) =>
          m.kind === "subscription_new" && /peacock/i.test(m.displayName)
      )
    );
  });

  it("keeps same subscription across both periods without inventing cancel", () => {
    const prev = activityFor(basePrevious(), PREV_PERIOD);
    const curr = activityFor(baseCurrent(), CURR_PERIOD);
    const cmp = buildStatementComparison({
      previous: prev,
      current: curr,
      previousPeriod: PREV_PERIOD,
      currentPeriod: CURR_PERIOD,
    });
    assert.ok(
      !cmp.merchantChanges.some(
        (m) =>
          /netflix/i.test(m.displayName) &&
          (m.kind === "subscription_not_observed" ||
            m.kind === "subscription_new")
      )
    );
  });

  it("detects flexible category increase with educational note", () => {
    const prev = activityFor(basePrevious(), PREV_PERIOD);
    const curr = activityFor(baseCurrent({ shopping: 320 }), CURR_PERIOD);
    const cmp = buildStatementComparison({
      previous: prev,
      current: curr,
      previousPeriod: PREV_PERIOD,
      currentPeriod: CURR_PERIOD,
    });
    const shopping = cmp.categories.find((c) => c.id === "shopping");
    assert.ok(shopping);
    assert.equal(shopping!.direction, "increased");
    assert.ok(
      cmp.educationalFlexibleNotes.some((n) => /Shopping increased/i.test(n))
    );
    assert.ok(
      cmp.educationalFlexibleNotes.every(
        (n) => !/guaranteed|overspent|you should cancel|this is bad/i.test(n)
      )
    );
  });

  it("excludes essential and debt categories from flexible savings scenarios", () => {
    for (const id of FLEXIBLE_SCENARIO_IDS) {
      assert.ok(id !== "housing" && id !== "debt_financing" && id !== "bills");
    }
    const prev = activityFor(basePrevious(), PREV_PERIOD);
    const curr = activityFor(
      baseCurrent({ att: 200 }).concat([
        txn("2026-06-25", "SYNCHRONY BANK DES:PAYMENT", 100),
      ]),
      CURR_PERIOD
    );
    const cmp = buildStatementComparison({
      previous: prev,
      current: curr,
      previousPeriod: PREV_PERIOD,
      currentPeriod: CURR_PERIOD,
    });
    assert.ok(
      cmp.educationalFlexibleNotes.every(
        (n) => !/Housing|Debt|AT&T|Synchrony/i.test(n)
      )
    );
  });

  it("rejects duplicate / same statement", () => {
    const prev = activityFor(basePrevious(), PREV_PERIOD);
    const elig = evaluateComparisonEligibility({
      previous: prev,
      current: prev,
      previousPeriod: PREV_PERIOD,
      currentPeriod: PREV_PERIOD,
    });
    assert.equal(elig.status, "same_statement");
    const cmp = buildStatementComparison({
      previous: prev,
      current: prev,
      previousPeriod: PREV_PERIOD,
      currentPeriod: PREV_PERIOD,
    });
    assert.equal(cmp.status, "same_statement");
    assert.equal(cmp.rankedFindings.length, 0);
  });

  it("is order-independent for categories and transactions", () => {
    const a = basePrevious();
    const b = [...basePrevious()].reverse();
    const actA = activityFor(a, PREV_PERIOD);
    const actB = activityFor(b, PREV_PERIOD);
    assert.equal(
      buildStatementFingerprint(actA, PREV_PERIOD),
      buildStatementFingerprint(actB, PREV_PERIOD)
    );

    const curr = activityFor(baseCurrent({ shopping: 300 }), CURR_PERIOD);
    const cmp1 = buildStatementComparison({
      previous: actA,
      current: curr,
      previousPeriod: PREV_PERIOD,
      currentPeriod: CURR_PERIOD,
    });
    const cmp2 = buildStatementComparison({
      previous: actB,
      current: curr,
      previousPeriod: PREV_PERIOD,
      currentPeriod: CURR_PERIOD,
    });
    assert.equal(cmp1.summarySentence, cmp2.summarySentence);
    assert.deepEqual(
      cmp1.categories.map((c) => [c.id, c.dollarDelta]),
      cmp2.categories.map((c) => [c.id, c.dollarDelta])
    );
  });

  it("produces identical results across ten repeated runs", () => {
    const prev = activityFor(basePrevious(), PREV_PERIOD);
    const curr = activityFor(
      baseCurrent({ shopping: 280, att: 168, addPeacock: true }),
      CURR_PERIOD
    );
    const first = buildStatementComparison({
      previous: prev,
      current: curr,
      previousPeriod: PREV_PERIOD,
      currentPeriod: CURR_PERIOD,
    });
    for (let i = 0; i < 10; i++) {
      const next = buildStatementComparison({
        previous: prev,
        current: curr,
        previousPeriod: PREV_PERIOD,
        currentPeriod: CURR_PERIOD,
      });
      assert.deepEqual(next, first);
    }
  });

  it("does not change single-statement totals or Health Scores", () => {
    const prevTxns = basePrevious();
    const currTxns = baseCurrent({ shopping: 300 });
    const prev = activityFor(prevTxns, PREV_PERIOD);
    const curr = activityFor(currTxns, CURR_PERIOD);
    const prevHealth = buildHealthScore(
      {
        clusters: buildMerchantClusters(prevTxns),
        subscriptions: [],
        recurringExpenses: [],
        spendingInsights: [],
        transfers: [],
        statementPeriod: PREV_PERIOD,
      },
      { ledgerStatus: prev.ledger.status }
    );
    const currHealth = buildHealthScore(
      {
        clusters: buildMerchantClusters(currTxns),
        subscriptions: [],
        recurringExpenses: [],
        spendingInsights: [],
        transfers: [],
        statementPeriod: CURR_PERIOD,
      },
      { ledgerStatus: curr.ledger.status }
    );
    const moneyInBefore = curr.moneyIn;
    const moneyOutBefore = curr.moneyOut;
    const scoreBefore = currHealth.score;

    const cmp = buildStatementComparison({
      previous: prev,
      current: curr,
      previousPeriod: PREV_PERIOD,
      currentPeriod: CURR_PERIOD,
      previousHealth: {
        score: prevHealth.score,
        label: prevHealth.label,
      },
      currentHealth: {
        score: currHealth.score,
        label: currHealth.label,
      },
    });

    assert.equal(curr.moneyIn, moneyInBefore);
    assert.equal(curr.moneyOut, moneyOutBefore);
    assert.equal(currHealth.score, scoreBefore);
    assert.equal(cmp.currentHealth?.score, currHealth.score);
    assert.equal(cmp.previousHealth?.score, prevHealth.score);
    assert.match(cmp.healthNote, /independently for each document/i);
  });

  it("answers Ask Brainy comparison questions deterministically", () => {
    const prev = activityFor(basePrevious(), PREV_PERIOD);
    const curr = activityFor(
      baseCurrent({ shopping: 320, att: 168, addPeacock: true }),
      CURR_PERIOD
    );
    const cmp = buildStatementComparison({
      previous: prev,
      current: curr,
      previousPeriod: PREV_PERIOD,
      currentPeriod: CURR_PERIOD,
    });
    const a = answerComparisonQuestion(cmp, "what_changed");
    const b = answerComparisonQuestion(cmp, "what_changed");
    assert.equal(a, b);
    assert.match(answerComparisonQuestion(cmp, "why_spent_more"), /spent \$/);
    assert.match(
      answerComparisonQuestion(cmp, "subscriptions_appeared"),
      /peacock/i
    );
  });
});

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

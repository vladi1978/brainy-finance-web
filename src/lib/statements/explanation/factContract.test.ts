import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMerchantClusters } from "../clusters";
import type { Transaction } from "../types";
import { buildStatementActivitySummary } from "../intelligence/statementActivity";
import { buildStatementComparison } from "../intelligence/statementComparison";
import { buildHealthScore } from "../intelligence/healthScore";
import {
  buildExplanationFactContract,
  sanitizeIncomingFactContract,
} from "./factContract";
import { buildDeterministicExplanationFallback } from "./deterministicFallback";

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
  period: { start: string; end: string }
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
      depositsTotal: moneyIn,
      withdrawalsTotal: moneyOut,
    },
  });
}

const PREV = { start: "2026-05-10", end: "2026-06-09" };
const CURR = { start: "2026-06-10", end: "2026-07-09" };

function sampleTxns(shopping: number): Transaction[] {
  return [
    txn("2026-06-12", "JCWLLC DES:PAYROLL", 3000, "credit"),
    txn("2026-06-15", "US BANK MORTGAGE PAYMENT", 1100),
    txn(
      "2026-06-16",
      "ATT DES:PAYMENT ID:XXXXXXXXXEPAYP INDN:CUSTOMER CO ID:123 PPD",
      142
    ),
    txn("2026-06-18", "CHECKCARD SAMSCLUB", shopping),
    txn("2026-06-20", "SHELL OIL", 60),
    txn("2026-06-22", "PURCHASE NETFLIX.COM", 15.49),
  ];
}

describe("explanation fact contract", () => {
  it("is pure and excludes transactions/pdf/text fields", () => {
    const txns = sampleTxns(200);
    const activity = activityFor(txns, CURR);
    const moneyIn = activity.moneyIn;
    const moneyOut = activity.moneyOut;
    const health = buildHealthScore(
      {
        clusters: buildMerchantClusters(txns),
        subscriptions: [],
        recurringExpenses: [],
        spendingInsights: [],
        transfers: [],
        statementPeriod: CURR,
      },
      { ledgerStatus: activity.ledger.status }
    );

    const a = buildExplanationFactContract({
      mode: "single",
      activity,
      statementPeriod: CURR,
    });
    const b = buildExplanationFactContract({
      mode: "single",
      activity,
      statementPeriod: CURR,
    });

    assert.deepEqual(a, b);
    assert.equal(activity.moneyIn, moneyIn);
    assert.equal(activity.moneyOut, moneyOut);
    assert.equal(
      buildHealthScore(
        {
          clusters: buildMerchantClusters(txns),
          subscriptions: [],
          recurringExpenses: [],
          spendingInsights: [],
          transfers: [],
          statementPeriod: CURR,
        },
        { ledgerStatus: activity.ledger.status }
      ).score,
      health.score
    );

    const serialized = JSON.stringify(a);
    assert.doesNotMatch(serialized, /"transactions"/i);
    assert.doesNotMatch(serialized, /XXXXXXXXXEPAYP/);
    assert.doesNotMatch(serialized, /%PDF/);
    assert.doesNotMatch(serialized, /JCWLLC DES/);
    assert.ok(a.facts.some((f) => f.id === "cashflow.spent"));
    assert.ok(a.facts.length <= 48);
  });

  it("builds comparison facts without mutating deltas", () => {
    const prev = activityFor(
      [
        txn("2026-05-12", "JCWLLC DES:PAYROLL", 3000, "credit"),
        txn("2026-05-15", "US BANK MORTGAGE PAYMENT", 1100),
        txn("2026-05-18", "CHECKCARD SAMSCLUB", 200),
      ],
      PREV
    );
    const curr = activityFor(sampleTxns(414), CURR);
    const cmp = buildStatementComparison({
      previous: prev,
      current: curr,
      previousPeriod: PREV,
      currentPeriod: CURR,
    });
    const spentDelta = cmp.moneySpent.dollarDelta;
    const contract = buildExplanationFactContract({
      mode: "comparison",
      activity: curr,
      statementPeriod: CURR,
      comparison: cmp,
    });
    assert.equal(cmp.moneySpent.dollarDelta, spentDelta);
    assert.ok(contract.facts.some((f) => f.id === "comparison.spent"));
    const spentFact = contract.facts.find((f) => f.id === "comparison.spent");
    assert.equal(spentFact?.value, spentDelta);
  });

  it("rejects unknown fields and oversized incoming contracts", () => {
    const bad = sanitizeIncomingFactContract({
      mode: "single",
      currency: "USD",
      periods: [{ role: "primary", start: "2026-01-01", end: "2026-01-31" }],
      reconciliationStatus: "reconciled",
      analysisConfidence: "high",
      comparisonStatus: null,
      isProvisional: false,
      facts: [],
      reliabilityNotices: [],
      secretPrompt: "hack",
    });
    assert.equal(bad.ok, false);

    const activity = activityFor(sampleTxns(200), CURR);
    const good = buildExplanationFactContract({
      mode: "single",
      activity,
      statementPeriod: CURR,
    });
    const ok = sanitizeIncomingFactContract(good);
    assert.equal(ok.ok, true);
  });

  it("deterministic fallback references only supplied facts", () => {
    const activity = activityFor(sampleTxns(200), CURR);
    const contract = buildExplanationFactContract({
      mode: "single",
      activity,
      statementPeriod: CURR,
    });
    const ids = new Set(contract.facts.map((f) => f.id));
    const fb = buildDeterministicExplanationFallback(contract);
    for (const obs of fb.observations) {
      for (const id of obs.factIds) {
        assert.ok(ids.has(id), id);
      }
    }
  });
});

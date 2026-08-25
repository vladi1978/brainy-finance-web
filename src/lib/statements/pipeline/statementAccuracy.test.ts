/**
 * Statement intelligence accuracy regressions (synthetic fixtures only).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMerchantClusters } from "../clusters";
import {
  isDebtFinancingText,
  isHousingPaymentText,
} from "../expectedBills";
import { buildHealthScore } from "../intelligence/healthScore";
import { buildSavingsOpportunities } from "../intelligence/savings";
import {
  buildStatementActivitySummary,
  classifyDebit,
} from "../intelligence/statementActivity";
import { inferStatementYear } from "./dates";
import { parseBlockWithStrategies } from "./extractRow";
import { reconstructStatementLines } from "./reconstructLines";
import {
  classifyLedgerReconciliation,
  extractBankStatementSummaryTotals,
} from "./statementSummary";
import { passesPostParseValidation } from "./validateRow";
import type {
  SubscriptionInsight,
  Transaction,
} from "../types";

const YEAR = 2026;

function txn(
  date: string,
  description: string,
  amount: number,
  type: "debit" | "credit" = "debit"
): Transaction {
  return { date, description, amount, type, currency: "USD" };
}

function parseOk(line: string) {
  const row = parseBlockWithStrategies(line, YEAR);
  assert.ok(row, `parse failed: ${line.slice(0, 50)}`);
  assert.ok(passesPostParseValidation(line, row, YEAR));
  return row;
}

function activityFor(txns: Transaction[], subs: SubscriptionInsight[] = []) {
  return buildStatementActivitySummary({
    transactions: txns,
    clusters: buildMerchantClusters(txns),
    subscriptions: subs,
    statementPeriod: { start: "2026-06-01", end: "2026-07-09" },
    statementSummary: {
      depositsTotal: 3189.48,
      withdrawalsTotal: 4042.25,
    },
  });
}

describe("Cash App ACH amount merge", () => {
  it("does not invent $7419 from ID digits on incomplete Cash App DES line", () => {
    const incomplete =
      "06/12/26 CASH APP DES:PAYMENT F ID:ABC123 INDN:CUSTOMER NAME CO";
    const row = parseBlockWithStrategies(incomplete, YEAR);
    if (row) {
      assert.notEqual(row.amount, 7419);
      assert.equal(passesPostParseValidation(incomplete, row, YEAR), false);
    }
  });

  it("merges ID + amount-only tail into Cash App parent", () => {
    const physical = [
      "06/12/26 CASH APP DES:PAYMENT F ID:ABC123 INDN:CUSTOMER NAME CO",
      "ID:1234567890 SQ",
      "42.50",
    ];
    const blocks = reconstructStatementLines(
      physical,
      inferStatementYear(physical)
    );
    assert.equal(blocks.length, 1);
    const row = parseOk(blocks[0]!);
    assert.equal(row.amount, 42.5);
    assert.equal(row.type, "debit");
    assert.match(row.description, /CASH APP/i);
  });
});

describe("classification exclusivity", () => {
  it("classifies mortgage as housing", () => {
    assert.equal(isHousingPaymentText("US BANK HOME MORTGAGE PAYMENT"), true);
    const txns = [txn("2026-06-05", "US BANK HOME MORTGAGE 1100.00", 1100)];
    const clusters = buildMerchantClusters(txns);
    const id = classifyDebit({
      txn: txns[0]!,
      cluster: clusters[0]!,
      normalizedName: "US Bank Mortgage",
      subscriptionByCluster: new Map(),
    });
    assert.equal(id, "housing");
  });

  it("classifies Republic Services as bills/utility", () => {
    const txns = [txn("2026-06-08", "REPUBLIC SERVICES DES:PAYMENT", 48.2)];
    const clusters = buildMerchantClusters(txns);
    const id = classifyDebit({
      txn: txns[0]!,
      cluster: clusters[0]!,
      normalizedName: "Republic Services",
      subscriptionByCluster: new Map(),
    });
    assert.equal(id, "bills");
  });

  it("classifies Synchrony/Affirm/Comenity as debt financing", () => {
    for (const desc of [
      "SYNCHRONY BANK PAYMENT",
      "AFFIRM PAYMENT",
      "COMENITY PAYMENT",
    ]) {
      assert.equal(isDebtFinancingText(desc), true);
      const txns = [txn("2026-06-09", desc, 120)];
      const clusters = buildMerchantClusters(txns);
      const id = classifyDebit({
        txn: txns[0]!,
        cluster: clusters[0]!,
        normalizedName: desc,
        subscriptionByCluster: new Map(),
      });
      assert.equal(id, "debt_financing");
    }
  });

  it("classifies Shell as fuel and Golden Corral as dining", () => {
    const shell = txn("2026-06-10", "CHECKCARD SHELL OIL 12883933", 45.1);
    const dining = txn("2026-06-11", "GOLDEN CORRAL #1234", 38.9);
    const clusters = buildMerchantClusters([shell, dining]);
    assert.equal(
      classifyDebit({
        txn: shell,
        cluster: clusters.find((c) => /SHELL/i.test(c.key))!,
        normalizedName: "Shell",
        subscriptionByCluster: new Map(),
      }),
      "fuel"
    );
    assert.equal(
      classifyDebit({
        txn: dining,
        cluster: clusters.find((c) => /GOLDEN/i.test(c.key))!,
        normalizedName: "Golden Corral",
        subscriptionByCluster: new Map(),
      }),
      "dining"
    );
  });

  it("classifies Deepgram/ElevenLabs as software_services", () => {
    for (const desc of ["DEEPGRAM API", "ELEVENLABS SUBSCRIPTION"]) {
      const txns = [txn("2026-06-12", desc, 29)];
      const clusters = buildMerchantClusters(txns);
      assert.equal(
        classifyDebit({
          txn: txns[0]!,
          cluster: clusters[0]!,
          normalizedName: desc,
          subscriptionByCluster: new Map(),
        }),
        "software_services"
      );
    }
  });

  it("keeps Sam's Club purchase as shopping, not subscription", () => {
    const txns = [
      txn("2026-06-09", "CHECKCARD 0609 SAMSCLUB #8276 LOUISVILLE KY", 45.07),
    ];
    const summary = activityFor(txns);
    assert.equal(
      summary.categories.find((c) => c.id === "shopping")?.transactionCount,
      1
    );
    assert.equal(summary.subscriptionCards.length, 0);
  });

  it("AT&T is expected bill and never a possible subscription", () => {
    const txns = [txn("2026-06-03", "ATT DES:PAYMENT", 95)];
    const clusters = buildMerchantClusters(txns);
    const sub: SubscriptionInsight = {
      merchant: "AT&T",
      normalizedName: "AT&T",
      category: "utilities",
      amount: 95,
      currency: "USD",
      frequency: "monthly",
      lastCharged: "2026-06-03",
      monthlyEquivalent: 95,
      annualEquivalent: 1140,
      confidence: 0.9,
      trueSubscriptionScore: 0.9,
      clusterId: clusters[0]!.id,
      flags: {
        forgotten: false,
        duplicate: false,
        priceIncreased: false,
        trialConverted: false,
        suspicious: false,
        reviewSuggested: true,
        confirmed: false,
      },
    };
    const summary = activityFor(txns, [sub]);
    assert.equal(
      summary.categories.find((c) => c.id === "bills")?.transactionCount,
      1
    );
    assert.equal(
      summary.subscriptionCards.filter((s) => /AT&T|ATT/i.test(s.normalizedName))
        .length,
      0
    );
    assert.ok(summary.billCards.some((b) => /AT&T|ATT/i.test(b.normalizedName)));
  });
});

describe("unsupported savings and health", () => {
  it("does not create savings opportunities for Synchrony debt payments", () => {
    const txns = [txn("2026-06-15", "SYNCHRONY BANK PAYMENT", 200)];
    const clusters = buildMerchantClusters(txns);
    const sub: SubscriptionInsight = {
      merchant: "Synchrony",
      normalizedName: "Synchrony",
      category: "other",
      amount: 200,
      currency: "USD",
      frequency: "monthly",
      lastCharged: "2026-06-15",
      monthlyEquivalent: 200,
      annualEquivalent: 2400,
      confidence: 0.8,
      trueSubscriptionScore: 0.85,
      clusterId: clusters[0]!.id,
      flags: {
        forgotten: true,
        duplicate: false,
        priceIncreased: false,
        trialConverted: false,
        suspicious: false,
        reviewSuggested: true,
        confirmed: false,
      },
    };
    const savings = buildSavingsOpportunities({
      statementPeriod: { start: "2026-06-01", end: "2026-07-09" },
      clusters,
      subscriptions: [sub],
      recurringExpenses: [],
      spendingInsights: [],
      transfers: [],
    });
    assert.equal(
      savings.filter((s) => /Synchrony|debt|cancel/i.test(s.title + s.explanation))
        .length,
      0
    );
  });

  it("makes Health Score provisional when ledger is unreconciled", () => {
    const health = buildHealthScore(
      {
        statementPeriod: { start: "2026-06-01", end: "2026-07-09" },
        clusters: [],
        subscriptions: [],
        recurringExpenses: [],
        spendingInsights: [],
        transfers: [],
      },
      { ledgerStatus: "unreconciled" }
    );
    assert.equal(health.provisional, true);
    assert.equal(health.displayMode, "provisional");
    assert.ok(health.score <= 79);
    assert.ok(health.statusNote);
  });

  it("category totals reconcile exactly to debit totals", () => {
    const txns = [
      txn("2026-06-01", "NETFLIX.COM", 15.49),
      txn("2026-06-02", "CHECKCARD SAMSCLUB", 40),
      txn("2026-06-03", "ATT DES:PAYMENT", 95),
      txn("2026-06-04", "OVERDRAFT FEE", 35),
      txn("2026-06-05", "US BANK HOME MORTGAGE", 1100),
      txn("2026-06-06", "SYNCHRONY BANK PAYMENT", 200),
      txn("2026-06-07", "SHELL OIL", 40),
    ];
    const summary = activityFor(txns);
    assert.equal(summary.reconciliation.ok, true);
    assert.equal(summary.reconciliation.delta, 0);
    const assigned = summary.categories.reduce(
      (s, c) => s + c.transactionCount,
      0
    );
    assert.equal(assigned, txns.length);
  });
});

describe("ledger reconciliation status", () => {
  it("extracts statement summary totals from PDF-like text", () => {
    const text =
      "TOTAL DEPOSITS AND OTHER ADDITIONS $3,189.48 TOTAL WITHDRAWALS AND OTHER SUBTRACTIONS $4,042.25";
    const totals = extractBankStatementSummaryTotals(text);
    assert.equal(totals.depositsTotal, 3189.48);
    assert.equal(totals.withdrawalsTotal, 4042.25);
  });

  it("marks incomplete money-in as unreconciled and hides reliable net", () => {
    const status = classifyLedgerReconciliation({
      reportedDeposits: 3189.48,
      reportedWithdrawals: 4042.25,
      parsedCredits: 173.84,
      parsedDebits: 3500,
    });
    assert.equal(status.cashFlowReliable, false);
    assert.notEqual(status.status, "reconciled");

    const summary = activityFor([
      txn("2026-06-01", "SHELL OIL", 40),
      txn("2026-06-02", "PMNT RCVD CASH", 100, "credit"),
    ]);
    assert.equal(summary.cashFlowReliable, false);
    assert.equal(summary.netCashFlow, null);
  });

  it("is deterministic across 10 identical builds", () => {
    const txns = [
      txn("2026-06-01", "ATT DES:PAYMENT", 95),
      txn("2026-06-02", "SHELL OIL", 40),
      txn("2026-06-03", "PMNT RCVD", 50, "credit"),
    ];
    const first = JSON.stringify(activityFor(txns));
    for (let i = 0; i < 10; i++) {
      assert.equal(JSON.stringify(activityFor(txns)), first);
    }
  });
});

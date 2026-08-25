import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMerchantClusters } from "../clusters";
import { classifyInsurancePayment } from "../insuranceClassify";
import { parseBlockWithStrategies } from "../pipeline/extractRow";
import { passesPostParseValidation } from "../pipeline/validateRow";
import { repairStatementLine } from "../pipeline/textNormalize";
import { reconstructStatementLines } from "../pipeline/reconstructLines";
import { inferStatementYear } from "../pipeline/dates";
import { buildStatementActivitySummary } from "./statementActivity";
import type { SubscriptionInsight, Transaction } from "../types";

const YEAR = 2026;

function parseLine(line: string) {
  const row = parseBlockWithStrategies(line, YEAR);
  assert.ok(row, `expected parse for: ${line.slice(0, 40)}`);
  assert.ok(passesPostParseValidation(line, row, YEAR), "validation");
  return row;
}

function debit(
  date: string,
  description: string,
  amount: number
): Transaction {
  return {
    date,
    description,
    amount,
    type: "debit",
    currency: "USD",
  };
}

describe("statement parser repairs", () => {
  it("splits joined MM/DD/YY merchant tokens", () => {
    const repaired = repairStatementLine("06/09/26CHECKCARD 0609 SAMSCLUB #8276 -45.07");
    assert.match(repaired, /06\/09\/26 CHECKCARD/);
  });

  it("separates trailing minus credit/debit amounts from auth refs", () => {
    const repaired = repairStatementLine(
      "06/22/26CHECKCARD 0621 CTLP*CSC SERVICEW 52653846173795349218076-1.00"
    );
    assert.match(repaired, / -1\.00$/);
  });

  it("parses SAMSCLUB variant as shopping debit", () => {
    const line = "06/09/26 CHECKCARD 0609 SAMSCLUB #8276 LOUISVILLE KY 45.07";
    const row = parseLine(line);
    assert.equal(row.amount, 45.07);
  });

  it("parses Sam's Club spacing variant", () => {
    const line = "06/26/26 CHECKCARD 0626 SAMS CLUB #827 LOUISVILLE KY 112.40";
    const row = parseLine(line);
    assert.equal(row.amount, 112.4);
  });

  it("rejects summary/balance rows", () => {
    const line = "Total service fees -30.00 Note your Ending Balance";
    const row = parseBlockWithStrategies(line, YEAR);
    if (row) {
      assert.equal(passesPostParseValidation(line, row, YEAR), false);
    } else {
      assert.ok(true);
    }
  });

  it("reconstructs multi-line bank rows with amount-only tail", () => {
    const physical = [
      "06/10/26",
      "CHECKCARD 0609 SHELL OIL12883933 LOUISVILLE KY",
      "14.51",
    ];
    const y = inferStatementYear(physical);
    const blocks = reconstructStatementLines(physical, y);
    assert.equal(blocks.length, 1);
    const row = parseLine(blocks[0]!);
    assert.equal(row.amount, 14.51);
  });
});

describe("insurance and shopping classification", () => {
  it("classifies known insurance debit", () => {
    const hit = classifyInsurancePayment("STATE FARM INSURANCE PREMIUM");
    assert.equal(hit.isInsurance, true);
  });

  it("classifies unknown INS PREM debit", () => {
    const hit = classifyInsurancePayment("INS PREM PAYMENT");
    assert.equal(hit.isInsurance, true);
    assert.equal(hit.type, "unknown");
  });

  it("excludes Progressive Leasing", () => {
    const hit = classifyInsurancePayment("PROGRESSIVE LEASING PAYMENT");
    assert.equal(hit.isInsurance, false);
  });

  it("Sam's Club purchase maps to shopping, not subscription", () => {
    const txns = [
      debit("2026-06-09", "CHECKCARD 0609 SAMSCLUB #8276 LOUISVILLE KY", 45.07),
    ];
    const clusters = buildMerchantClusters(txns);
    const subs: SubscriptionInsight[] = [];
    const summary = buildStatementActivitySummary({
      transactions: txns,
      clusters,
      subscriptions: subs,
      statementPeriod: { start: "2026-06-01", end: "2026-06-30" },
    });
    const shopping = summary.categories.find((c) => c.id === "shopping");
    assert.equal(shopping?.transactionCount, 1);
    assert.equal(summary.subscriptionCards.length, 0);
  });

  it("single insurance payment does not invent monthly cadence", () => {
    const txns = [debit("2026-06-12", "STATE FARM INS PREM", 142.5)];
    const clusters = buildMerchantClusters(txns);
    const summary = buildStatementActivitySummary({
      transactions: txns,
      clusters,
      subscriptions: [],
      statementPeriod: { start: "2026-06-01", end: "2026-06-30" },
    });
    const card = summary.billCards.find((b) => b.billKind === "insurance");
    assert.ok(card);
    assert.equal(card.cadenceLabel, null);
    assert.equal(card.chargeCount, 1);
  });
});

describe("statement activity reconciliation", () => {
  it("assigns every debit exactly once and reconciles totals", () => {
    const txns = [
      debit("2026-06-01", "NETFLIX.COM", 15.49),
      debit("2026-06-02", "CHECKCARD 0602 SAMSCLUB #1", 40),
      debit("2026-06-03", "ATT DES:PAYMENT", 95),
      debit("2026-06-04", "OVERDRAFT FEE", 35),
    ];
    const clusters = buildMerchantClusters(txns);
    const summary = buildStatementActivitySummary({
      transactions: txns,
      clusters,
      subscriptions: [],
      statementPeriod: { start: "2026-06-01", end: "2026-06-30" },
      statementSummary: { depositsTotal: null, withdrawalsTotal: null },
    });
    const assigned = summary.categories.reduce(
      (s, c) => s + c.transactionCount,
      0
    );
    assert.equal(assigned, txns.length);
    assert.equal(summary.reconciliation.ok, true);
    assert.equal(summary.reconciliation.delta, 0);
    assert.ok(summary.ledger);
  });

  it("produces deterministic output for the same fixture", () => {
    const txns = [
      debit("2026-06-01", "SPOTIFY", 11.99),
      debit("2026-06-08", "CHECKCARD SAMS CLUB", 22.5),
    ];
    const clusters = buildMerchantClusters(txns);
    const input = {
      transactions: txns,
      clusters,
      subscriptions: [] as SubscriptionInsight[],
      statementPeriod: { start: "2026-06-01", end: "2026-06-30" as const },
      statementSummary: { depositsTotal: null, withdrawalsTotal: null },
    };
    const a = buildStatementActivitySummary(input);
    const b = buildStatementActivitySummary(input);
    assert.deepEqual(
      a.categories.map((c) => [c.id, c.total, c.transactionCount]),
      b.categories.map((c) => [c.id, c.total, c.transactionCount])
    );
  });
});

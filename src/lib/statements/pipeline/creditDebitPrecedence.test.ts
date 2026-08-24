/**
 * Credit/debit precedence and BoA WEB/ID continuation regressions.
 * Synthetic fixtures only — no real statement PII.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMerchantClusters } from "../clusters";
import { buildStatementActivitySummary } from "../intelligence/statementActivity";
import type { Transaction } from "../types";
import { isPlausibleMoneyToken, parseAmountFragment } from "./amounts";
import { inferStatementYear } from "./dates";
import { parseBlockWithStrategies } from "./extractRow";
import { reconstructStatementLines } from "./reconstructLines";
import { repairStatementLine } from "./textNormalize";
import { passesPostParseValidation } from "./validateRow";

const YEAR = 2026;

function parseLine(line: string) {
  const row = parseBlockWithStrategies(line, YEAR);
  assert.ok(row, `expected parse for: ${line.slice(0, 60)}`);
  assert.ok(
    passesPostParseValidation(line, row, YEAR),
    `expected validation for type=${row.type} amount=${row.amount}`
  );
  return row;
}

describe("credit/debit precedence", () => {
  it("classifies PMNT RCVD as credit", () => {
    const row = parseLine(
      "06/15/26 BKOFAMERICA MOBILE 06/15 #XXXXX PMNT RCVD XXXXX 1234567890 500.00"
    );
    assert.equal(row.type, "credit");
    assert.equal(row.amount, 500);
  });

  it("classifies PAYMENT RECEIVED as credit", () => {
    const row = parseLine("06/10/26 PAYMENT RECEIVED THANK YOU 200.00");
    assert.equal(row.type, "credit");
    assert.equal(row.amount, 200);
  });

  it("classifies PAYMENT FROM as credit", () => {
    const row = parseLine("06/11/26 PAYMENT FROM ACME PAYROLL 1250.00");
    assert.equal(row.type, "credit");
    assert.equal(row.amount, 1250);
  });

  it("classifies clearly incoming ZELLE ... FROM as credit", () => {
    const row = parseLine("06/12/26 ZELLE FROM J DOE CONF#ABC123 75.50");
    assert.equal(row.type, "credit");
    assert.equal(row.amount, 75.5);
  });

  it("classifies DEPOSIT as credit", () => {
    const row = parseLine("06/10/26 PAYROLL DEPOSIT ACME CORP 2500.00");
    assert.equal(row.type, "credit");
    assert.equal(row.amount, 2500);
  });

  it("classifies REFUND as credit", () => {
    const row = parseLine("06/10/26 AMAZON REFUND 12.34");
    assert.equal(row.type, "credit");
    assert.equal(row.amount, 12.34);
  });

  it("classifies DES:PAYMENT bill/ACH as debit", () => {
    const row = parseLine(
      "06/10/26 ATT DES:PAYMENT ID:123456 INDN:CUSTOMER CO ID:999 WEB 95.00"
    );
    assert.equal(row.type, "debit");
    assert.equal(row.amount, 95);
  });

  it("classifies generic outgoing PAYMENT as debit", () => {
    const row = parseLine("06/10/26 ONLINE PAYMENT THANK YOU 150.00");
    assert.equal(row.type, "debit");
    assert.equal(row.amount, 150);
  });

  it("keeps CHECKCARD auth-glued minus amount as debit $1.00", () => {
    const repaired = repairStatementLine(
      "06/22/26CHECKCARD 0621 CTLP*CSC SERVICEW 52653846173795349218076-1.00"
    );
    const row = parseLine(repaired);
    assert.equal(row.type, "debit");
    assert.equal(row.amount, 1);
  });

  it("does not treat negative amount alone as credit", () => {
    const row = parseLine("06/22/26 CHECKCARD 0621 SAMPLE MERCHANT -45.07");
    assert.equal(row.type, "debit");
    assert.equal(row.amount, 45.07);
  });
});

describe("long ID/auth amounts must never become money", () => {
  it("rejects bare long integer tokens as money", () => {
    assert.equal(isPlausibleMoneyToken("1061537262"), false);
    assert.equal(isPlausibleMoneyToken("52653846173795349218076"), false);
    assert.equal(isPlausibleMoneyToken("126.24"), true);
    assert.equal(isPlausibleMoneyToken("-126.24"), true);
    assert.equal(isPlausibleMoneyToken("20.00"), true);
    assert.equal(isPlausibleMoneyToken("20"), true);
  });

  it("does not accept orphan ID WEB lines with invented ID amounts", () => {
    const line = "ID:1061537262 WEB";
    const row = parseBlockWithStrategies(line, YEAR);
    if (row) {
      assert.equal(
        passesPostParseValidation(line, row, YEAR),
        false,
        "orphan ID WEB without real money must not validate"
      );
      // Must never treat the long ID integer as the transaction amount.
      assert.notEqual(row.amount, 1061537262);
    }
  });

  it("does not select long auth/ID digits as the amount on a dated row", () => {
    const line =
      "06/22/26 CHECKCARD 0621 SAMPLE MERCHANT 52653846173795349218076";
    const row = parseBlockWithStrategies(line, YEAR);
    if (row) {
      assert.notEqual(row.amount, 52653846173795349218076);
      assert.ok(row.amount < 1_000_000);
      assert.equal(
        passesPostParseValidation(line, row, YEAR),
        false,
        "row with only an auth/ID and no real money amount must not validate"
      );
    } else {
      assert.equal(row, null);
    }
  });

  it("parseAmountFragment still parses real money tokens", () => {
    const p = parseAmountFragment("-126.24");
    assert.ok(p);
    assert.equal(p.value, -126.24);
  });
});

describe("orphan WEB/ID continuations", () => {
  it("merges ID WEB -AMT into dated parent ACH row", () => {
    const physical = [
      "06/18/26 VENDOR NAME DES:PAYMENT ID:ABC123 INDN:CUSTOMER CO",
      "ID:1234567890 WEB -126.24",
    ];
    const y = inferStatementYear(physical);
    const blocks = reconstructStatementLines(physical, y);
    assert.equal(blocks.length, 1);
    assert.match(blocks[0]!, /06\/18\/26/);
    assert.match(blocks[0]!, /WEB/);
    assert.match(blocks[0]!, /126\.24|-\s*126\.24|-126\.24/);

    const row = parseLine(blocks[0]!);
    assert.equal(row.type, "debit");
    assert.equal(row.amount, 126.24);
  });

  it("rejects standalone ID WEB -AMT orphan without dated parent", () => {
    const physical = ["ID:1234567890 WEB -126.24"];
    const y = inferStatementYear(physical);
    const blocks = reconstructStatementLines(physical, y);
    // Orphan must not become an accepted dated transaction by inventing a date from the ID.
    for (const block of blocks) {
      const row = parseBlockWithStrategies(block, y);
      if (!row) continue;
      assert.equal(
        passesPostParseValidation(block, row, y),
        false,
        "orphan WEB continuation must not validate as a transaction"
      );
    }
  });

  it("repairs WEB-126.24 spacing without inventing credit from sign", () => {
    const repaired = repairStatementLine("ID:1234567890 WEB-126.24");
    assert.match(repaired, /WEB -126\.24$/);
    const physical = [
      "06/19/26 SOME BILLER DES:WEB PAY ID:XYZ INDN:NAME CO",
      repaired,
    ];
    const blocks = reconstructStatementLines(physical, YEAR);
    assert.equal(blocks.length, 1);
    const row = parseLine(blocks[0]!);
    assert.equal(row.amount, 126.24);
    assert.equal(row.type, "debit");
  });
});

describe("statement activity with credits still reconciles debits", () => {
  it("counts credits separately and keeps debit reconciliation ok", () => {
    const txns: Transaction[] = [
      {
        date: "2026-06-01",
        description: "NETFLIX.COM",
        amount: 15.49,
        type: "debit",
        currency: "USD",
      },
      {
        date: "2026-06-02",
        description: "BKOFAMERICA MOBILE PMNT RCVD",
        amount: 100,
        type: "credit",
        currency: "USD",
      },
      {
        date: "2026-06-03",
        description: "ATT DES:PAYMENT",
        amount: 95,
        type: "debit",
        currency: "USD",
      },
    ];
    const summary = buildStatementActivitySummary({
      transactions: txns,
      clusters: buildMerchantClusters(txns),
      subscriptions: [],
      statementPeriod: { start: "2026-06-01", end: "2026-06-30" },
    });
    assert.equal(summary.creditCount, 1);
    assert.equal(summary.debitCount, 2);
    assert.equal(summary.reconciliation.ok, true);
    assert.equal(summary.reconciliation.delta, 0);
    const assigned = summary.categories.reduce(
      (s, c) => s + c.transactionCount,
      0
    );
    assert.equal(assigned, 2);
  });
});

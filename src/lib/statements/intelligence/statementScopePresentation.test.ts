import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMerchantClusters } from "../clusters";
import type { Transaction } from "../types";
import { buildStatementActivitySummary } from "./statementActivity";
import { buildStatementComparison } from "./statementComparison";
import {
  REMOVE_COMPARISON_STATEMENT_LABEL,
  askBrainySingleStatementPreface,
  formatStatementPeriodRange,
  singleStatementScopeNotice,
  singleStatementSectionCaption,
} from "./statementScopePresentation";

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
  const moneyIn = txns
    .filter((t) => t.type === "credit")
    .reduce((s, t) => s + t.amount, 0);
  const moneyOut = txns
    .filter((t) => t.type === "debit")
    .reduce((s, t) => s + t.amount, 0);
  return buildStatementActivitySummary({
    transactions: txns,
    clusters: buildMerchantClusters(txns),
    subscriptions: [],
    statementPeriod: period,
    statementSummary: {
      depositsTotal: moneyIn,
      withdrawalsTotal: moneyOut,
    },
  });
}

describe("single-statement scope presentation with comparison", () => {
  const EARLIER = { start: "2026-06-08", end: "2026-07-09" };
  const LATER = { start: "2026-07-10", end: "2026-08-07" };

  it("labels removal as Remove comparison statement", () => {
    assert.equal(
      REMOVE_COMPARISON_STATEMENT_LABEL,
      "Remove comparison statement"
    );
  });

  it("formats the primary uploaded period for single-statement sections", () => {
    // Primary upload was the earlier PDF; comparison still orders later as Current.
    const range = formatStatementPeriodRange(EARLIER);
    assert.equal(range, "2026-06-08 → 2026-07-09");
    const notice = singleStatementScopeNotice(range);
    assert.match(notice, /Single-statement details below are for 2026-06-08 → 2026-07-09/);
    assert.match(notice, /chronological comparison above uses both/);
    assert.match(
      singleStatementSectionCaption(range),
      /uploaded statement for 2026-06-08 → 2026-07-09/
    );
    assert.doesNotMatch(
      singleStatementSectionCaption(range),
      /chronological Current|later period only/i
    );
  });

  it("Ask Brainy single-statement preface identifies its period", () => {
    const preface = askBrainySingleStatementPreface(
      formatStatementPeriodRange(EARLIER)
    );
    assert.match(preface, /single statement for 2026-06-08 → 2026-07-09/);
    assert.match(preface, /not the two-statement comparison/i);
  });

  it("additional upload can become chronological current without changing comparison math", () => {
    const earlierTxns = [
      txn("2026-06-12", "JCWLLC DES:PAYROLL", 3000, "credit"),
      txn("2026-06-15", "US BANK MORTGAGE PAYMENT", 1100),
      txn(
        "2026-06-16",
        "ATT DES:PAYMENT ID:XXXXXXXXXEPAYP INDN:CUSTOMER CO ID:123 PPD",
        408.41
      ),
      txn("2026-06-18", "CHECKCARD SAMSCLUB", 944.42),
      txn("2026-06-20", "SHELL OIL", 60),
    ];
    const laterTxns = [
      txn("2026-07-12", "JCWLLC DES:PAYROLL", 3000, "credit"),
      txn(
        "2026-07-16",
        "ATT DES:PAYMENT ID:XXXXXXXXXEPAYP INDN:CUSTOMER CO ID:123 PPD",
        390.76
      ),
      txn("2026-07-18", "CHECKCARD SAMSCLUB", 124.56),
      txn("2026-07-20", "SHELL OIL", 60),
      txn("2026-07-22", "PURCHASE NETFLIX.COM", 15.49),
    ];
    const earlier = activityFor(earlierTxns, EARLIER);
    const later = activityFor(laterTxns, LATER);

    // Primary slot = earlier; additional upload = later (becomes chronological Current)
    const cmp = buildStatementComparison({
      previous: later,
      current: earlier,
      previousPeriod: LATER,
      currentPeriod: EARLIER,
    });

    assert.equal(cmp.uploadMatchedChronology, false);
    assert.deepEqual(cmp.previousPeriod, EARLIER);
    assert.deepEqual(cmp.currentPeriod, LATER);

    const shopping = cmp.categories.find((c) => c.id === "shopping");
    assert.ok(shopping);
    assert.equal(shopping!.dollarDelta, -819.86);

    // Single-statement scope still names the primary uploaded period (earlier),
    // not the chronological Current.
    const primaryScope = formatStatementPeriodRange(EARLIER);
    assert.equal(primaryScope, "2026-06-08 → 2026-07-09");
    assert.notEqual(
      primaryScope,
      formatStatementPeriodRange(cmp.currentPeriod)
    );

    // Comparison result remains stable if slots are swapped again
    const again = buildStatementComparison({
      previous: later,
      current: earlier,
      previousPeriod: LATER,
      currentPeriod: EARLIER,
    });
    assert.deepEqual(again.moneySpent, cmp.moneySpent);
    assert.deepEqual(
      again.categories.map((c) => [c.id, c.dollarDelta]),
      cmp.categories.map((c) => [c.id, c.dollarDelta])
    );
  });
});

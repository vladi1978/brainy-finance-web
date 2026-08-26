import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMerchantClusters } from "../clusters";
import type { Transaction } from "../types";
import { buildStatementActivitySummary } from "./statementActivity";
import {
  buildMonthlyExplanation,
  buildSpendingScenario,
  flexibleChildTotalsMatchGroup,
  summarizeAttProvider,
} from "./monthlyExplanation";
import { isEvidenceGatedSubscriptionMerchantText } from "../subscriptionSignals";
import { presentationMerchantDisplayName } from "../presentationMerchantDisplay";

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
  opts?: { deposits?: number | null; withdrawals?: number | null }
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

describe("UX step 3 consistency", () => {
  it("keeps possible-subscription count independent from digital transaction count", () => {
    const txns = [
      txn("2026-06-08", "CHECKCARD Peacock TV LLC", 11.58),
      txn("2026-06-22", "PURCHASE OPENAI *CHATGPT SUBSCR", 21.2),
      txn("2026-06-11", "PURCHASE NETFLIX.COM", 15.49),
      txn("2026-06-12", "PURCHASE SERPAPI, LLC", 75),
      txn("2026-06-13", "PURCHASE NETLIFY", 19),
      txn("2026-06-14", "PURCHASE DEEPGRAM", 12),
      txn("2026-06-15", "PURCHASE ELEVENLABS", 22),
      txn("2026-06-10", "JCWLLC DES:PAYROLL", 500, "credit"),
    ];
    const moneyOut = 11.58 + 21.2 + 15.49 + 75 + 19 + 12 + 22;
    const activity = activityFor(txns, {
      deposits: 500,
      withdrawals: moneyOut,
    });
    const possible = activity.subscriptionCards.filter(
      (s) => s.status === "possible"
    );
    const software = activity.categories.find(
      (c) => c.id === "software_services"
    );
    assert.ok((software?.transactionCount ?? 0) >= 4);
    assert.equal(possible.length, 3);
    assert.ok(
      possible.every((p) =>
        /peacock|openai|chatgpt|netflix/i.test(p.normalizedName + p.merchant)
      )
    );
    assert.ok(!possible.some((p) => /serpapi|netlify|deepgram|eleven/i.test(p.normalizedName)));
    const expl = buildMonthlyExplanation({ activity });
    assert.equal(expl.subscriptionSummary.possibleCount, 3);
    assert.ok(expl.subscriptionSummary.otherDigitalChargeCount >= 4);
  });

  it("flexible child rows sum exactly to flexible total", () => {
    const txns = [
      txn("2026-06-19", "CHECKCARD SAMSCLUB", 400),
      txn("2026-06-20", "SHELL OIL", 80),
      txn("2026-06-21", "GOLDEN CORRAL", 45),
      txn("2026-06-22", "PURCHASE OPENAI *CHATGPT", 21.2),
      txn("2026-06-23", "PURCHASE SERPAPI, LLC", 75),
      txn("2026-06-10", "JCWLLC DES:PAYROLL", 2000, "credit"),
    ];
    const moneyOut = 400 + 80 + 45 + 21.2 + 75;
    const activity = activityFor(txns, {
      deposits: 2000,
      withdrawals: moneyOut,
    });
    const expl = buildMonthlyExplanation({ activity });
    const flexible = expl.commitmentGroups.find((g) => g.id === "flexible")!;
    assert.equal(flexibleChildTotalsMatchGroup(flexible), true);
    assert.ok(
      flexible.lines.some((l) => /Digital services/i.test(l.label))
    );
  });

  it("preserves both AT&T charges under one provider total", () => {
    const txns = [
      txn(
        "2026-06-12",
        "ATT DES:PAYMENT ID:XXXXXXXXXEPAYP INDN:CUSTOMER CO ID:123 PPD",
        338.19
      ),
      txn("2026-06-12", "PURCHASE 0611 ATT*BILL PAYMENT 8002882020 TX", 70.22),
      txn("2026-06-10", "JCWLLC DES:PAYROLL", 1000, "credit"),
    ];
    const activity = activityFor(txns, {
      deposits: 1000,
      withdrawals: 408.41,
    });
    const att = summarizeAttProvider(activity);
    assert.ok(att);
    assert.equal(att!.total, 408.41);
    assert.equal(att!.chargeCount, 2);
    assert.deepEqual(att!.amounts.sort((a, b) => a - b), [70.22, 338.19]);
    assert.match(att!.note, /Two AT&T service charges/i);
    assert.equal(
      activity.categories.find((c) => c.id === "bills")?.transactionCount,
      2
    );
  });

  it("does not treat SerpAPI as a subscription candidate", () => {
    assert.equal(
      isEvidenceGatedSubscriptionMerchantText("PURCHASE SERPAPI, LLC"),
      false
    );
    assert.equal(
      isEvidenceGatedSubscriptionMerchantText("PURCHASE OPENAI *CHATGPT"),
      true
    );
  });

  it("scenario remaining difference is arithmetically correct", () => {
    const txns = [
      txn("2026-06-19", "CHECKCARD SAMSCLUB", 1000),
      txn("2026-06-20", "SHELL OIL", 553.69),
      txn("2026-06-15", "US BANK MORTGAGE PAYMENT", 1700),
      txn("2026-06-16", "SYNCHRONY BANK DES:PAYMENT", 470.76),
      txn("2026-06-10", "JCWLLC DES:PAYROLL", 3189.48, "credit"),
    ];
    const moneyOut = 1000 + 553.69 + 1700 + 470.76;
    const activity = activityFor(txns, {
      deposits: 3189.48,
      withdrawals: moneyOut,
    });
    assert.equal(activity.ledger.status, "reconciled");
    const scenario = buildSpendingScenario({ activity, percent: 10 });
    assert.equal(scenario.eligible, true);
    assert.equal(
      scenario.illustrativeAmount,
      Math.round(scenario.flexibleBase * 0.1 * 100) / 100
    );
    assert.ok(scenario.originalNet != null && scenario.remainingNet != null);
    assert.equal(
      scenario.remainingNet,
      Math.round((scenario.originalNet! + scenario.illustrativeAmount) * 100) /
        100
    );
    if (scenario.originalNet! < 0 && !scenario.closesDeficit) {
      assert.ok(scenario.remainingNet! < 0);
    }
  });

  it("disables scenarios when unreconciled", () => {
    const activity = activityFor(
      [txn("2026-06-19", "CHECKCARD SAMSCLUB", 100)],
      { deposits: 5000, withdrawals: 9000 }
    );
    const scenario = buildSpendingScenario({ activity, percent: 10 });
    assert.equal(scenario.eligible, false);
    assert.equal(scenario.illustrativeAmount, 0);
  });

  it("explains negative cash flow even with high Statement Health", () => {
    const txns = [
      txn("2026-06-15", "US BANK MORTGAGE PAYMENT", 1100),
      txn("2026-06-19", "CHECKCARD SAMSCLUB", 400),
      txn("2026-06-10", "JCWLLC DES:PAYROLL", 1000, "credit"),
    ];
    const activity = activityFor(txns, {
      deposits: 1000,
      withdrawals: 1500,
    });
    const expl = buildMonthlyExplanation({ activity, healthScore: 98 });
    assert.equal(expl.outcome, "negative");
    assert.ok(expl.whyNegative);
    assert.ok(expl.healthCashFlowClarification);
    assert.match(expl.healthCashFlowClarification!, /Cash flow compares/i);
    assert.doesNotMatch(expl.headline, /financially unhealthy|wasteful/i);
  });

  it("keeps raw merchant available while cleaning display names", () => {
    const display = presentationMerchantDisplayName(
      "USBANK HOMEMTG DES:MTGPYMENT ID:123"
    );
    assert.equal(display, "U.S. Bank Mortgage");
    const raw = "USBANK HOMEMTG DES:MTGPYMENT ID:123";
    assert.notEqual(raw, display);
    assert.equal(
      presentationMerchantDisplayName("REPUBLICSERVICES DES:RSIBILLPAY"),
      "Republic Services"
    );
    assert.equal(
      presentationMerchantDisplayName("SYNCHRONY BANK DES:PAYMENT"),
      "Synchrony Bank"
    );
  });
});

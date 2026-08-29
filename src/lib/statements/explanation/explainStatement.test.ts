import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMerchantClusters } from "../clusters";
import type { Transaction } from "../types";
import { buildStatementActivitySummary } from "../intelligence/statementActivity";
import { buildExplanationFactContract } from "./factContract";
import { explainStatementFacts } from "./explainStatement";
import {
  getOpenAiApiKeyIfEnabled,
  isOpenAiEnrichmentEnabled,
} from "@/lib/ai/openaiEnrichmentGate";
import { isOpenAiStatementExplanationEnabled } from "@/lib/ai/openaiExplanationGate";

function withEnv(
  values: Record<string, string | undefined>,
  fn: () => Promise<void> | void
): Promise<void> | void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    const next = values[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  const restore = () => {
    for (const key of Object.keys(values)) {
      const prev = previous[key];
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  };
  try {
    const result = fn();
    if (result && typeof (result as Promise<void>).then === "function") {
      return (result as Promise<void>).finally(restore);
    }
    restore();
  } catch (e) {
    restore();
    throw e;
  }
}

function txn(
  date: string,
  description: string,
  amount: number,
  type: "debit" | "credit" = "debit"
): Transaction {
  return { date, description, amount, type, currency: "USD" };
}

describe("explainStatementFacts authority and gate", () => {
  it("flag off returns deterministic fallback and never enables enrichment", async () => {
    await withEnv(
      {
        OPENAI_API_KEY: "sk-should-not-call",
        OPENAI_STATEMENT_EXPLANATION_ENABLED: undefined,
        OPENAI_ENRICHMENT_ENABLED: undefined,
      },
      async () => {
        assert.equal(isOpenAiStatementExplanationEnabled(), false);
        assert.equal(isOpenAiEnrichmentEnabled(), false);
        assert.equal(getOpenAiApiKeyIfEnabled(), null);

        const txns = [
          txn("2026-06-12", "PAYROLL", 2000, "credit"),
          txn("2026-06-15", "RENT PAYMENT", 900),
          txn("2026-06-18", "GROCERY STORE", 120),
        ];
        const activity = buildStatementActivitySummary({
          transactions: txns,
          clusters: buildMerchantClusters(txns),
          subscriptions: [],
          statementPeriod: { start: "2026-06-01", end: "2026-06-30" },
          statementSummary: {
            depositsTotal: 2000,
            withdrawalsTotal: 1020,
          },
        });
        const beforeIn = activity.moneyIn;
        const beforeOut = activity.moneyOut;
        const contract = buildExplanationFactContract({
          mode: "single",
          activity,
          statementPeriod: { start: "2026-06-01", end: "2026-06-30" },
        });

        const result = await explainStatementFacts(contract);
        assert.equal(result.source, "deterministic");
        assert.equal(result.fallbackReason, "disabled");
        assert.equal(activity.moneyIn, beforeIn);
        assert.equal(activity.moneyOut, beforeOut);
        assert.ok(result.explanation.headline.length > 0);
      }
    );
  });
});

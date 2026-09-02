import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";

import { buildMerchantClusters } from "../clusters";
import type { Transaction } from "../types";
import { buildStatementActivitySummary } from "../intelligence/statementActivity";
import { buildExplanationFactContract } from "./factContract";
import {
  buildExplanationSystemPrompt,
  buildExplanationUserInstruction,
  explainStatementFacts,
  finalizeExplanationFromProviderContent,
  setExplanationProviderCompletionForTests,
} from "./explainStatement";
import {
  getOpenAiApiKeyIfEnabled,
  isOpenAiEnrichmentEnabled,
} from "@/lib/ai/openaiEnrichmentGate";
import { isOpenAiStatementExplanationEnabled } from "@/lib/ai/openaiExplanationGate";
import type { ExplanationFactContract } from "./factContract";

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

function activationContract(): ExplanationFactContract {
  return {
    mode: "single",
    currency: "USD",
    periods: [{ role: "primary", start: "2026-06-01", end: "2026-06-30" }],
    reconciliationStatus: "reconciled",
    analysisConfidence: "high",
    comparisonStatus: null,
    isProvisional: false,
    facts: [
      {
        id: "cashflow.received",
        kind: "money",
        label: "Money received",
        value: 3000,
      },
      {
        id: "cashflow.spent",
        kind: "money",
        label: "Money spent",
        value: 2100,
      },
      {
        id: "category.groceries",
        kind: "money",
        label: "Groceries",
        value: 300,
      },
    ],
    reliabilityNotices: [],
  };
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

describe("explanation prompt hardening", () => {
  it("forbids derived differences/sums/ratios/percentages and directs qualitative wording", () => {
    const system = buildExplanationSystemPrompt(activationContract());
    const user = buildExplanationUserInstruction();
    const combined = `${system}\n${user}`;

    assert.match(combined, /do not calculate/i);
    assert.match(combined, /differences/i);
    assert.match(combined, /sums/i);
    assert.match(combined, /ratios/i);
    assert.match(combined, /percentages/i);
    assert.match(combined, /qualitative/i);
    assert.match(combined, /spending was lower than money received/i);
    assert.match(combined, /do not spell numerical values as words/i);
    assert.match(combined, /cancellation instructions/i);
    assert.match(combined, /guarantees/i);
    assert.match(combined, /eligibility/i);
  });
});

describe("finalizeExplanationFromProviderContent grounding diagnostics", () => {
  it("maps derived $900 provider JSON to grounding_failed + invented_currency", () => {
    const content = JSON.stringify({
      headline: "Cash flow difference",
      summary: "You received $900 more than you spent this period.",
      observations: [
        {
          factIds: ["cashflow.received", "cashflow.spent"],
          explanation: "The difference between received and spent was $900.",
        },
      ],
      questionsToConsider: ["Does this difference match what you expected?"],
    });

    const result = finalizeExplanationFromProviderContent(
      content,
      activationContract(),
      { model: "test-model", started: Date.now() }
    );

    assert.equal(result.source, "deterministic");
    assert.equal(result.fallbackReason, "grounding_failed");
    assert.equal(result.groundingCode, "invented_currency");
    assert.doesNotMatch(result.explanation.summary, /\$900/);
  });
});

describe("mocked provider path stays server-side", () => {
  it("uses provider override without importing OpenAI in client UI", async () => {
    const panelPath = path.join(
      process.cwd(),
      "src/components/statements/ExplainWithAiPanel.tsx"
    );
    const panelSrc = fs.readFileSync(panelPath, "utf8");
    assert.doesNotMatch(panelSrc, /from ["']openai["']/);
    assert.doesNotMatch(panelSrc, /explainStatementFacts/);
    assert.doesNotMatch(panelSrc, /groundingCode/);

    await withEnv(
      {
        OPENAI_STATEMENT_EXPLANATION_ENABLED: "true",
        OPENAI_API_KEY: "sk-test-not-used",
      },
      async () => {
        setExplanationProviderCompletionForTests(async () =>
          JSON.stringify({
            headline: "Cash flow difference",
            summary: "You received $900 more than you spent this period.",
            observations: [
              {
                factIds: ["cashflow.received", "cashflow.spent"],
                explanation:
                  "The difference between received and spent was $900.",
              },
            ],
            questionsToConsider: [
              "Does this difference match what you expected?",
            ],
          })
        );
        try {
          const result = await explainStatementFacts(activationContract());
          assert.equal(result.fallbackReason, "grounding_failed");
          assert.equal(result.groundingCode, "invented_currency");
        } finally {
          setExplanationProviderCompletionForTests(null);
        }
      }
    );
  });
});

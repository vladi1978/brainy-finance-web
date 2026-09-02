import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";

import { POST, buildExplainClientSuccessBody } from "./route";
import {
  resetExplanationRateLimitForTests,
} from "@/lib/statements/explanation/rateLimit";
import {
  EXPLANATION_RATE_LIMIT_MAX,
} from "@/lib/statements/explanation/constants";
import type { ExplanationFactContract } from "@/lib/statements/explanation/factContract";
import {
  finalizeExplanationFromProviderContent,
  setExplanationProviderCompletionForTests,
} from "@/lib/statements/explanation/explainStatement";
import { buildDeterministicExplanationFallback } from "@/lib/statements/explanation/deterministicFallback";

function sampleContract(): ExplanationFactContract {
  return {
    mode: "single",
    currency: "USD",
    periods: [{ role: "primary", start: "2026-06-10", end: "2026-07-09" }],
    reconciliationStatus: "reconciled",
    analysisConfidence: "high",
    comparisonStatus: null,
    isProvisional: false,
    facts: [
      {
        id: "cashflow.spent",
        kind: "money",
        label: "Money spent",
        value: 100,
      },
      {
        id: "cashflow.received",
        kind: "money",
        label: "Money received",
        value: 200,
      },
      {
        id: "commitments.essential",
        kind: "money",
        label: "Essential",
        value: 50,
      },
      {
        id: "commitments.flexible",
        kind: "money",
        label: "Flexible",
        value: 40,
      },
      {
        id: "commitments.debt",
        kind: "money",
        label: "Debt",
        value: 0,
      },
    ],
    reliabilityNotices: [],
  };
}

describe("POST /api/statements/explain", () => {
  it("rejects non-JSON content type", async () => {
    resetExplanationRateLimitForTests();
    const res = await POST(
      new Request("http://localhost/api/statements/explain", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "hi",
      })
    );
    assert.equal(res.status, 415);
  });

  it("rejects oversized bodies", async () => {
    resetExplanationRateLimitForTests();
    const big = "x".repeat(20 * 1024);
    const res = await POST(
      new Request("http://localhost/api/statements/explain", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(big.length),
        },
        body: big,
      })
    );
    assert.equal(res.status, 413);
  });

  it("rejects PDF/file-shaped payloads and prohibited fields", async () => {
    resetExplanationRateLimitForTests();
    const res = await POST(
      new Request("http://localhost/api/statements/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contract: sampleContract(),
          pdf: "not-allowed",
        }),
      })
    );
    assert.equal(res.status, 400);

    const res2 = await POST(
      new Request("http://localhost/api/statements/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transactions: [{ description: "SECRET" }],
        }),
      })
    );
    assert.equal(res2.status, 400);
  });

  it("returns deterministic fallback when explanation is disabled", async () => {
    resetExplanationRateLimitForTests();
    const prevFlag = process.env.OPENAI_STATEMENT_EXPLANATION_ENABLED;
    const prevKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_STATEMENT_EXPLANATION_ENABLED;
    delete process.env.OPENAI_API_KEY;
    try {
      const res = await POST(
        new Request("http://localhost/api/statements/explain", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contract: sampleContract() }),
        })
      );
      assert.equal(res.status, 200);
      const json = (await res.json()) as {
        ok: boolean;
        source: string;
        fallbackReason: string | null;
        explanation?: { headline?: string };
        error?: string;
      };
      assert.equal(json.ok, true);
      assert.equal(json.source, "deterministic");
      assert.equal(json.fallbackReason, "disabled");
      assert.ok(json.explanation?.headline);
      assert.equal(json.error, undefined);
    } finally {
      if (prevFlag === undefined) delete process.env.OPENAI_STATEMENT_EXPLANATION_ENABLED;
      else process.env.OPENAI_STATEMENT_EXPLANATION_ENABLED = prevFlag;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
    }
  });

  it("rate limits after too many requests but still returns deterministic copy", async () => {
    resetExplanationRateLimitForTests();
    const prevFlag = process.env.OPENAI_STATEMENT_EXPLANATION_ENABLED;
    delete process.env.OPENAI_STATEMENT_EXPLANATION_ENABLED;
    try {
      let lastStatus = 200;
      for (let i = 0; i < EXPLANATION_RATE_LIMIT_MAX + 1; i++) {
        const res = await POST(
          new Request("http://localhost/api/statements/explain", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-forwarded-for": "203.0.113.50",
            },
            body: JSON.stringify({ contract: sampleContract() }),
          })
        );
        lastStatus = res.status;
        const json = (await res.json()) as {
          ok?: boolean;
          explanation?: { headline?: string };
          fallbackReason?: string;
        };
        if (i < EXPLANATION_RATE_LIMIT_MAX) {
          assert.equal(res.status, 200);
          assert.ok(json.explanation?.headline);
        } else {
          assert.equal(res.status, 429);
          assert.equal(json.fallbackReason, "rate_limited");
          assert.ok(json.explanation?.headline);
        }
      }
      assert.equal(lastStatus, 429);
    } finally {
      if (prevFlag === undefined) {
        delete process.env.OPENAI_STATEMENT_EXPLANATION_ENABLED;
      } else {
        process.env.OPENAI_STATEMENT_EXPLANATION_ENABLED = prevFlag;
      }
      resetExplanationRateLimitForTests();
    }
  });

  it("mocked derived-$900 provider output stays fail-closed and omits diagnostics from JSON", async () => {
    resetExplanationRateLimitForTests();
    const prevFlag = process.env.OPENAI_STATEMENT_EXPLANATION_ENABLED;
    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_STATEMENT_EXPLANATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "sk-test-not-used";

    const derivedProviderJson = JSON.stringify({
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

    const logs: unknown[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args);
    };

    setExplanationProviderCompletionForTests(async () => derivedProviderJson);
    try {
      const contract: ExplanationFactContract = {
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
          {
            id: "commitments.essential",
            kind: "money",
            label: "Essential",
            value: 0,
          },
          {
            id: "commitments.flexible",
            kind: "money",
            label: "Flexible",
            value: 300,
          },
          {
            id: "commitments.debt",
            kind: "money",
            label: "Debt",
            value: 0,
          },
        ],
        reliabilityNotices: [],
      };

      const finalized = finalizeExplanationFromProviderContent(
        derivedProviderJson,
        contract,
        { model: "test-model", started: Date.now() }
      );
      assert.equal(finalized.fallbackReason, "grounding_failed");
      assert.equal(finalized.groundingCode, "invented_currency");

      const clientBody = buildExplainClientSuccessBody(finalized, contract.mode);
      const clientJson = JSON.stringify(clientBody);
      assert.equal(clientBody.fallbackReason, "grounding_failed");
      assert.equal(clientBody.source, "deterministic");
      assert.equal("groundingCode" in clientBody, false);
      assert.doesNotMatch(clientJson, /groundingCode/);
      assert.doesNotMatch(clientJson, /\$900/);
      assert.doesNotMatch(clientJson, /You received \$900/);
      assert.doesNotMatch(clientJson, /category\.shopping/);

      const res = await POST(
        new Request("http://localhost/api/statements/explain", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost",
            host: "localhost",
          },
          body: JSON.stringify({ contract }),
        })
      );
      assert.equal(res.status, 200);
      const raw = await res.text();
      assert.doesNotMatch(raw, /groundingCode/);
      assert.doesNotMatch(raw, /\$900/);
      assert.doesNotMatch(raw, /You received \$900/);
      const json = JSON.parse(raw) as {
        source: string;
        fallbackReason: string | null;
        explanation: { summary: string };
      };
      assert.equal(json.source, "deterministic");
      assert.equal(json.fallbackReason, "grounding_failed");
      assert.doesNotMatch(json.explanation.summary, /\$900/);

      const metaLines = logs
        .map((entry) => {
          if (!Array.isArray(entry) || entry[0] !== "[statements/explain]") {
            return null;
          }
          return entry[1] as Record<string, unknown>;
        })
        .filter((x): x is Record<string, unknown> => x != null);
      assert.ok(metaLines.length >= 1);
      const groundingMeta = metaLines.find(
        (m) => m.fallbackReason === "grounding_failed"
      );
      assert.ok(groundingMeta);
      assert.equal(groundingMeta?.groundingCode, "invented_currency");
      assert.equal(
        Object.prototype.hasOwnProperty.call(groundingMeta, "summary"),
        false
      );
      const metaJson = JSON.stringify(groundingMeta);
      assert.doesNotMatch(metaJson, /\$900/);
      assert.doesNotMatch(metaJson, /cashflow\.received/);
    } finally {
      console.log = originalLog;
      setExplanationProviderCompletionForTests(null);
      if (prevFlag === undefined) {
        delete process.env.OPENAI_STATEMENT_EXPLANATION_ENABLED;
      } else {
        process.env.OPENAI_STATEMENT_EXPLANATION_ENABLED = prevFlag;
      }
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      resetExplanationRateLimitForTests();
    }
  });

  it("does not add OpenAI SDK imports to the Explain with AI client panel", () => {
    const panelPath = path.join(
      process.cwd(),
      "src/components/statements/ExplainWithAiPanel.tsx"
    );
    const src = fs.readFileSync(panelPath, "utf8");
    assert.doesNotMatch(src, /from ["']openai["']/);
    assert.doesNotMatch(src, /new OpenAI/);
    assert.doesNotMatch(src, /explainStatementFacts/);
    assert.doesNotMatch(src, /groundingCode/);
    // Deterministic fallback stays available client-side without provider path.
    assert.equal(
      typeof buildDeterministicExplanationFallback,
      "function"
    );
  });
});

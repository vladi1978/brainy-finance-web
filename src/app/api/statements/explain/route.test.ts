import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { POST } from "./route";
import {
  resetExplanationRateLimitForTests,
} from "@/lib/statements/explanation/rateLimit";
import {
  EXPLANATION_RATE_LIMIT_MAX,
} from "@/lib/statements/explanation/constants";
import type { ExplanationFactContract } from "@/lib/statements/explanation/factContract";

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
});

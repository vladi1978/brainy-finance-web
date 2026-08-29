import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AI_EXPLANATION_DISCLOSURE,
  AI_EXPLANATION_EDUCATIONAL_DISCLAIMER,
} from "./constants";
import { buildDeterministicExplanationFallback } from "./deterministicFallback";
import type { ExplanationFactContract } from "./factContract";

describe("Explain with AI UI contracts", () => {
  it("does not auto-invoke OpenAI — disclosure and disclaimer are static", () => {
    assert.match(AI_EXPLANATION_DISCLOSURE, /does not change transactions/i);
    assert.match(AI_EXPLANATION_EDUCATIONAL_DISCLAIMER, /not financial/i);
  });

  it("keeps single and comparison fallbacks distinct", () => {
    const single: ExplanationFactContract = {
      mode: "single",
      currency: "USD",
      periods: [{ role: "primary", start: "2026-06-01", end: "2026-06-30" }],
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
          id: "commitments.flexible",
          kind: "money",
          label: "Flexible",
          value: 40,
        },
      ],
      reliabilityNotices: [],
    };
    const comparison: ExplanationFactContract = {
      ...single,
      mode: "comparison",
      isProvisional: true,
      periods: [
        { role: "earlier", start: "2026-05-01", end: "2026-05-31" },
        { role: "later", start: "2026-06-01", end: "2026-06-30" },
      ],
      facts: [
        ...single.facts,
        {
          id: "comparison.spent",
          kind: "money",
          label: "Spent change",
          value: 25,
        },
      ],
      reliabilityNotices: ["Differences are provisional."],
    };

    const a = buildDeterministicExplanationFallback(single);
    const b = buildDeterministicExplanationFallback(comparison);
    assert.notEqual(a.headline, b.headline);
    assert.match(b.summary, /provisional/i);
    assert.match(a.summary, /2026-06-01/);
    assert.match(b.summary, /2026-05-01/);
  });
});

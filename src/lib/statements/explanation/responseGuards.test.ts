import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ExplanationFactContract } from "./factContract";
import { assertGroundedExplanation } from "./groundedGuards";
import {
  parseExplanationAiJson,
  parseExplanationAiResponse,
} from "./responseSchema";

function baseContract(
  overrides?: Partial<ExplanationFactContract>
): ExplanationFactContract {
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
        value: 1500.25,
      },
      {
        id: "commitments.flexible",
        kind: "money",
        label: "Flexible spending",
        value: 200,
      },
      {
        id: "comparison.spent.percent",
        kind: "percent",
        label: "Spent percent",
        value: 12.5,
      },
    ],
    reliabilityNotices: [],
    ...overrides,
  };
}

describe("explanation response schema and grounding", () => {
  it("accepts a valid grounded response", () => {
    const parsed = parseExplanationAiResponse({
      headline: "Spending overview",
      summary: "Flexible spending was $200.00 this period.",
      observations: [
        {
          factIds: ["commitments.flexible"],
          explanation: "Flexible spending totaled $200.00.",
        },
      ],
      questionsToConsider: ["Which flexible charges do you want to review?"],
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const g = assertGroundedExplanation(parsed.value, baseContract());
    assert.equal(g.ok, true);
  });

  it("rejects unknown fields", () => {
    const parsed = parseExplanationAiResponse({
      headline: "Hi",
      summary: "Summary text that is long enough.",
      observations: [],
      questionsToConsider: [],
      advice: "buy stocks",
    });
    assert.equal(parsed.ok, false);
  });

  it("rejects unknown fact IDs", () => {
    const parsed = parseExplanationAiResponse({
      headline: "Hi there friends",
      summary: "Summary text that is long enough for schema.",
      observations: [
        {
          factIds: ["cashflow.invented"],
          explanation: "Invented fact explanation here.",
        },
      ],
      questionsToConsider: [],
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const g = assertGroundedExplanation(parsed.value, baseContract());
    assert.equal(g.ok, false);
  });

  it("rejects invented currency and percentages", () => {
    const parsed = parseExplanationAiResponse({
      headline: "Savings claim",
      summary: "You spent $9999.99 somehow.",
      observations: [
        {
          factIds: ["cashflow.spent"],
          explanation: "Spending was $9999.99.",
        },
      ],
      questionsToConsider: [],
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const g = assertGroundedExplanation(parsed.value, baseContract());
    assert.equal(g.ok, false);

    const pct = parseExplanationAiResponse({
      headline: "Percent claim",
      summary: "Spending rose by 88%.",
      observations: [
        {
          factIds: ["comparison.spent.percent"],
          explanation: "Up 88%.",
        },
      ],
      questionsToConsider: [],
    });
    assert.equal(pct.ok, true);
    if (!pct.ok) return;
    assert.equal(assertGroundedExplanation(pct.value, baseContract()).ok, false);
  });

  it("rejects prohibited claims and stop-paying-debt language", () => {
    const claim = parseExplanationAiResponse({
      headline: "Guaranteed path",
      summary: "This offers guaranteed savings if you cancel.",
      observations: [
        {
          factIds: ["commitments.flexible"],
          explanation: "Cancel for guaranteed savings.",
        },
      ],
      questionsToConsider: [],
    });
    assert.equal(claim.ok, true);
    if (!claim.ok) return;
    assert.equal(
      assertGroundedExplanation(claim.value, baseContract()).ok,
      false
    );

    const debt = parseExplanationAiResponse({
      headline: "Debt note",
      summary: "Some people stop paying debt entirely.",
      observations: [
        {
          factIds: ["cashflow.spent"],
          explanation: "You should stop paying debt now.",
        },
      ],
      questionsToConsider: [],
    });
    assert.equal(debt.ok, true);
    if (!debt.ok) return;
    assert.equal(
      assertGroundedExplanation(debt.value, baseContract()).ok,
      false
    );
  });

  it("rejects definitive wording when comparison is provisional", () => {
    const parsed = parseExplanationAiResponse({
      headline: "Definitive cause",
      summary: "This definitely caused the entire change.",
      observations: [
        {
          factIds: ["cashflow.spent"],
          explanation: "Without any doubt shopping caused entirely the rise.",
        },
      ],
      questionsToConsider: [],
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const g = assertGroundedExplanation(
      parsed.value,
      baseContract({ isProvisional: true })
    );
    assert.equal(g.ok, false);
  });

  it("rejects malformed JSON", () => {
    const parsed = parseExplanationAiJson("{not-json");
    assert.equal(parsed.ok, false);
  });
});

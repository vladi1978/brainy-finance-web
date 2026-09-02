import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ExplanationFactContract } from "./factContract";
import {
  assertGroundedExplanation,
  GROUNDING_DIAGNOSTIC_CODES,
  toGroundingDiagnosticCode,
} from "./groundedGuards";
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

  it("does not misread ISO dates as invented currency", () => {
    const parsed = parseExplanationAiResponse({
      headline: "Date safe",
      summary: "For 2026-06-10 → 2026-07-09 flexible spending was $200.00.",
      observations: [
        {
          factIds: ["commitments.flexible"],
          explanation: "Flexible spending was $200.00.",
        },
      ],
      questionsToConsider: [],
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(assertGroundedExplanation(parsed.value, baseContract()).ok, true);
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
}

describe("activation-shaped grounding regressions", () => {
  it("accepts supplied comma and decimal currency forms", () => {
    for (const summary of [
      "Money received was $3,000 and money spent was $2,100. Groceries were $300.",
      "Money received was $3000 and money spent was $2100. Groceries were $300.",
      "Money received was $3,000.00 and money spent was $2,100.00.",
    ]) {
      const parsed = parseExplanationAiResponse({
        headline: "Spending overview",
        summary,
        observations: [
          {
            factIds: ["cashflow.received", "cashflow.spent"],
            explanation: summary,
          },
        ],
        questionsToConsider: ["Which groceries charges do you want to review?"],
      });
      assert.equal(parsed.ok, true);
      if (!parsed.ok) return;
      assert.equal(
        assertGroundedExplanation(parsed.value, activationContract()).ok,
        true
      );
    }
  });

  it("rejects derived $900 and invented 70%", () => {
    const derived = parseExplanationAiResponse({
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
    assert.equal(derived.ok, true);
    if (!derived.ok) return;
    const derivedG = assertGroundedExplanation(
      derived.value,
      activationContract()
    );
    assert.equal(derivedG.ok, false);
    if (derivedG.ok) return;
    assert.match(derivedG.reason, /^invented_currency:/);

    const pct = parseExplanationAiResponse({
      headline: "Percent claim",
      summary: "Spending was about 70% of money received.",
      observations: [
        {
          factIds: ["cashflow.received", "cashflow.spent"],
          explanation: "Spent roughly 70% of received.",
        },
      ],
      questionsToConsider: ["Is that ratio what you expected?"],
    });
    assert.equal(pct.ok, true);
    if (!pct.ok) return;
    const pctG = assertGroundedExplanation(pct.value, activationContract());
    assert.equal(pctG.ok, false);
    if (pctG.ok) return;
    assert.match(pctG.reason, /^invented_percent:/);
  });

  it("rejects invalid fact IDs and worded currency; ISO dates stay safe", () => {
    const badId = parseExplanationAiResponse({
      headline: "Groceries focus",
      summary: "Groceries were $300 of spending.",
      observations: [
        {
          factIds: ["category.shopping"],
          explanation: "Groceries totaled $300.",
        },
      ],
      questionsToConsider: ["Which groceries charges do you want to review?"],
    });
    assert.equal(badId.ok, true);
    if (!badId.ok) return;
    const badIdG = assertGroundedExplanation(badId.value, activationContract());
    assert.equal(badIdG.ok, false);
    if (badIdG.ok) return;
    assert.equal(badIdG.reason, "unknown_fact_id:category.shopping");

    const worded = parseExplanationAiResponse({
      headline: "Worded money",
      summary: "You spent about three hundred dollars on groceries.",
      observations: [
        {
          factIds: ["category.groceries"],
          explanation: "About three hundred dollars in groceries.",
        },
      ],
      questionsToConsider: ["Which groceries charges do you want to review?"],
    });
    assert.equal(worded.ok, true);
    if (!worded.ok) return;
    assert.equal(
      assertGroundedExplanation(worded.value, activationContract()).ok,
      false
    );

    const dates = parseExplanationAiResponse({
      headline: "Period overview",
      summary:
        "For 2026-06-01 to 2026-06-30, money received was $3000 and money spent was $2100.",
      observations: [
        {
          factIds: ["cashflow.received"],
          explanation: "Received $3000 in this period.",
        },
      ],
      questionsToConsider: ["Which essential commitments look correct?"],
    });
    assert.equal(dates.ok, true);
    if (!dates.ok) return;
    assert.equal(
      assertGroundedExplanation(dates.value, activationContract()).ok,
      true
    );
  });
});

describe("grounding diagnostic code mapping", () => {
  it("strips suffixes and maps only to the fixed allowlist", () => {
    assert.equal(
      toGroundingDiagnosticCode("invented_currency:$900"),
      "invented_currency"
    );
    assert.equal(
      toGroundingDiagnosticCode("unknown_fact_id:category.shopping"),
      "unknown_fact_id"
    );
    assert.equal(
      toGroundingDiagnosticCode("invented_percent:70%"),
      "invented_percent"
    );

    for (const code of GROUNDING_DIAGNOSTIC_CODES) {
      if (code === "unknown_grounding_failure") continue;
      assert.equal(toGroundingDiagnosticCode(code), code);
      assert.equal(toGroundingDiagnosticCode(`${code}:extra`), code);
    }

    assert.equal(
      toGroundingDiagnosticCode("totally_unexpected"),
      "unknown_grounding_failure"
    );
    assert.equal(
      toGroundingDiagnosticCode("weird:stuff"),
      "unknown_grounding_failure"
    );
    assert.equal(toGroundingDiagnosticCode(""), "unknown_grounding_failure");
    assert.equal(toGroundingDiagnosticCode(null), "unknown_grounding_failure");
  });
});

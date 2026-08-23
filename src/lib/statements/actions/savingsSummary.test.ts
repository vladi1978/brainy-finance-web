import assert from "node:assert/strict";
import test from "node:test";
import { computeAcceptedSavings } from "./savingsSummary";
import { getActionDefinition } from "./registry";
import type { EnrichedRecommendation } from "./types";

function recommendation(status: EnrichedRecommendation["status"]): EnrichedRecommendation {
  return {
    id: `rec-${status}`,
    title: "Review plan",
    description: "Evidence-based scenario",
    estimatedMonthlySavings: 10,
    estimatedYearlySavings: 120,
    severity: "medium",
    confidence: 0.8,
    actionType: "review_subscription",
    currency: "USD",
    status,
    actions: [],
  };
}

test("planned recommendations are not counted as confirmed savings", () => {
  const summary = computeAcceptedSavings([recommendation("accepted")]);
  assert.equal(summary.plannedCount, 1);
  assert.equal(summary.plannedYearly, 120);
  assert.equal(summary.confirmedCount, 0);
  assert.equal(summary.confirmedYearly, 0);
});

test("only an explicitly completed recommendation enters confirmed savings", () => {
  const summary = computeAcceptedSavings([
    recommendation("accepted"),
    recommendation("completed"),
    recommendation("tracked"),
  ]);
  assert.equal(summary.plannedCount, 1);
  assert.equal(summary.confirmedCount, 1);
  assert.equal(summary.confirmedMonthly, 10);
  assert.equal(summary.confirmedYearly, 120);
});

test("keeping a service is essential, not a savings plan", () => {
  assert.equal(
    getActionDefinition("reduce_streaming", "keep")?.resolvesTo,
    "essential"
  );
  assert.equal(
    getActionDefinition("compare_telecom", "keep_plan")?.resolvesTo,
    "essential"
  );
});

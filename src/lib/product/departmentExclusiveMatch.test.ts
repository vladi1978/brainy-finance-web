import assert from "node:assert/strict";
import test from "node:test";
import { withCriticalAttributes } from "./criticalAttributes";
import { buildNormalizedProduct } from "./normalize";
import { scoreAttributeMatch } from "./attributeMatch";
import { buildUserMatchReasons } from "./matching/confidenceBands";

function normWithCritical(title: string) {
  return withCriticalAttributes(title, buildNormalizedProduct(title));
}

test("department-exclusive pools match skips universal screen-size gates and scoring", () => {
  const source = normWithCritical("Intex above ground pool 18x52 with pump");
  const candidate = normWithCritical("Intex above ground pool 18x52 with pump kit");
  const rel = scoreAttributeMatch(
    source,
    candidate,
    "intex pool 18x52 pump",
    candidate.structured.title,
    {
      selectedDepartment: "pools_outdoor",
      sourceTitle: source.structured.title,
    }
  );

  assert.equal(rel.rejected, false);
  assert.ok(rel.matchExplanation);
  assert.ok(!rel.reasons.some((r) => /hard_gate:/i.test(r)));
  assert.ok(!rel.reasons.some((r) => /critical_spec:.*screen/i.test(r)));
  assert.ok(!rel.reasons.some((r) => /^diagonal_inches=/i.test(r)));
  assert.ok(!rel.reasons.some((r) => /display_panel=/i.test(r)));
  assert.ok(rel.reasons.some((r) => r.includes("department_exclusive")));
});

test("department-exclusive electronics does not emit pool-shape user reasons", () => {
  const reasons = buildUserMatchReasons({
    rel: {
      confidence: 0.7,
      matchType: "equivalent",
      matchConfidenceLabel: "medium",
      relevanceScore: 70,
      reasons: ["pool shape matched", "frame_type", "department_pool_dimension"],
      rejected: false,
      rejectionReason: null,
      matchExplanation: "Same screen size and model family",
    },
    identity: {
      identityScore: 70,
      identityReasons: [],
      missingCriticalAttributes: [],
      matchType: "close_match",
    },
    displayScore: 70,
    confidenceBand: "possible_alternative",
    selectedDepartment: "electronics",
  });

  assert.ok(!reasons.some((l) => /pool shape/i.test(l)));
  assert.ok(!reasons.some((l) => /frame type compatible/i.test(l)));
});

test("department-exclusive pools does not emit screen-size user reasons", () => {
  const reasons = buildUserMatchReasons({
    rel: {
      confidence: 0.7,
      matchType: "equivalent",
      matchConfidenceLabel: "medium",
      relevanceScore: 70,
      reasons: ["diagonal_exact", "screen_size_exact", "resolution_tier"],
      rejected: false,
      rejectionReason: null,
      matchExplanation: "Dimensions match closely",
    },
    identity: {
      identityScore: 70,
      identityReasons: [],
      missingCriticalAttributes: [],
      matchType: "close_match",
    },
    displayScore: 70,
    confidenceBand: "possible_alternative",
    selectedDepartment: "pools_outdoor",
  });

  assert.ok(!reasons.some((l) => /screen size/i.test(l)));
});

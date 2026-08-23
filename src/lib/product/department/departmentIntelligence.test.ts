import assert from "node:assert/strict";
import test from "node:test";
import { withCriticalAttributes } from "../criticalAttributes";
import { buildNormalizedProduct } from "../normalize";
import { scoreAttributeMatch } from "../attributeMatch";
import { getDepartmentConfig } from "./departmentConfig";
import { runDepartmentIntelligence } from "./index";
import { checkDepartmentCriticalSpecsGate } from "../matching/criticalSpecs";

function normWithCritical(title: string) {
  return withCriticalAttributes(title, buildNormalizedProduct(title));
}

test("department configs are registered for all compare-flow departments", () => {
  for (const id of ["electronics", "pools_outdoor", "tools"] as const) {
    const config = getDepartmentConfig(id);
    assert.ok(config.displayName.length > 0);
    assert.ok(config.requiredAttributes.length > 0);
    assert.ok(config.scoringWeights);
    assert.ok(config.explanationRules.length > 0);
  }
});

test("electronics department rejects wrong screen size via user selection", () => {
  const source = normWithCritical("Samsung 65 inch smart tv DU7200");
  const candidate = normWithCritical("Samsung 60 inch smart tv DU7200");
  const gate = checkDepartmentCriticalSpecsGate(source, candidate, candidate.structured.title, {
    selectedDepartment: "electronics",
  });
  assert.ok(gate);
  assert.equal(gate.ok, false);
});

test("pools department keeps close dimension mismatch as scored alternative", () => {
  const source = normWithCritical("Intex above ground pool 18x52 with pump");
  const candidate = normWithCritical("Intex above ground pool 20x51 with pump");
  const result = runDepartmentIntelligence(source, candidate, {
    selectedDepartment: "pools_outdoor",
    sourceTitle: source.structured.title,
    candidateTitle: candidate.structured.title,
  });
  assert.equal(result.rejected, false);
  assert.ok(result.departmentScore >= 36);
});

test("pools department rejects drastically different dimensions", () => {
  const source = normWithCritical("Intex 15 ft round above ground pool 52 inch");
  const candidate = normWithCritical("Intex rectangular pool 32x16 ft with pump");
  const result = runDepartmentIntelligence(source, candidate, {
    selectedDepartment: "pools_outdoor",
    sourceTitle: source.structured.title,
    candidateTitle: candidate.structured.title,
  });
  assert.equal(result.rejected, true);
  assert.match(result.matchExplanation, /dimension|Rejected/i);
});

test("tools department rejects wrong voltage", () => {
  const source = normWithCritical("DeWalt DCD777 20V drill kit with battery and charger");
  const candidate = normWithCritical("DeWalt DCD777 12V drill kit with battery and charger");
  const result = runDepartmentIntelligence(source, candidate, {
    selectedDepartment: "tools",
    sourceTitle: source.structured.title,
    candidateTitle: candidate.structured.title,
  });
  assert.equal(result.rejected, true);
  assert.match(result.matchExplanation, /voltage/i);
});

test("scoreAttributeMatch uses department intelligence when department selected", () => {
  const source = normWithCritical("DeWalt DCD777 20V drill kit with battery and charger");
  const candidate = normWithCritical("DeWalt DCD777 20V drill kit with battery and charger");
  const rel = scoreAttributeMatch(
    source,
    candidate,
    "dewalt dcd777 20v drill kit",
    candidate.structured.title,
    {
      selectedDepartment: "tools",
      sourceTitle: source.structured.title,
    }
  );
  assert.equal(rel.rejected, false);
  assert.ok(rel.matchExplanation);
  assert.ok(rel.departmentScore != null && rel.departmentScore > 0);
});

test("pools department rejects pool chemicals", () => {
  const source = normWithCritical("Intex above ground pool 18x52 with pump");
  const candidate = normWithCritical("Pool chlorine shock treatment 5 lb");
  const result = runDepartmentIntelligence(source, candidate, {
    selectedDepartment: "pools_outdoor",
    sourceTitle: source.structured.title,
    candidateTitle: candidate.structured.title,
  });
  assert.equal(result.rejected, true);
  assert.match(result.matchExplanation, /chemical/i);
});

import assert from "node:assert/strict";
import test from "node:test";
import { withCriticalAttributes } from "../../criticalAttributes";
import { buildNormalizedProduct } from "../../normalize";
import { scoreAttributeMatch } from "../../attributeMatch";
import { parsePoolDimensions } from "../poolDimensions";
import { runPoolsOutdoorHardGateV2 } from "./poolsOutdoorGate";

function normWithCritical(title: string) {
  return withCriticalAttributes(title, buildNormalizedProduct(title));
}

function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void | Promise<void>
): Promise<void> {
  const prior: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    prior[key] = process.env[key];
    const next = vars[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const key of Object.keys(vars)) {
      const prev = prior[key];
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  });
}

test("parsePoolDimensions extracts round diameter and wall depth from ft round + inch", () => {
  const spec = parsePoolDimensions("Intex 15 ft round above ground pool 52 inch");
  assert.equal(spec.diameterFt, 15);
  assert.equal(spec.depthInches, 52);
  assert.equal(spec.shape, "round");
});

test("pools V2: 15 ft round vs 24 ft round hard rejects", () => {
  const source = normWithCritical("Intex 15 ft round above ground pool 52 inch");
  const candidate = normWithCritical("Intex 24 ft round above ground pool 52 inch");
  const gate = runPoolsOutdoorHardGateV2({
    source,
    candidate,
    sourceTitle: source.structured.title,
    candidateTitle: candidate.structured.title,
  });
  assert.equal(gate.ok, false);
  if (!gate.ok) {
    assert.match(gate.reason, /pool_diameter_mismatch/);
  }
});

test("pools V2: 15 ft round vs 15 ft round passes gate", () => {
  const source = normWithCritical("Intex 15 ft round above ground pool 52 inch");
  const candidate = normWithCritical("Intex 15 ft round above ground pool 52 inch");
  const gate = runPoolsOutdoorHardGateV2({
    source,
    candidate,
    sourceTitle: source.structured.title,
    candidateTitle: candidate.structured.title,
  });
  assert.equal(gate.ok, true);
});

test("pools V2: 15x52 vs 15x48 hard rejects on depth mismatch", () => {
  const source = normWithCritical("Intex above ground pool 15x52 with pump");
  const candidate = normWithCritical("Intex above ground pool 15x48 with pump");
  const gate = runPoolsOutdoorHardGateV2({
    source,
    candidate,
    sourceTitle: source.structured.title,
    candidateTitle: candidate.structured.title,
  });
  assert.equal(gate.ok, false);
  if (!gate.ok) {
    assert.match(gate.reason, /pool_depth_mismatch/);
  }
});

test("pools V2: missing candidate diameter soft only, no hard reject", () => {
  const source = normWithCritical("Intex 15 ft round above ground pool 52 inch");
  const candidate = normWithCritical("Intex round above ground pool with pump and filter");
  const gate = runPoolsOutdoorHardGateV2({
    source,
    candidate,
    sourceTitle: source.structured.title,
    candidateTitle: candidate.structured.title,
  });
  assert.equal(gate.ok, true);
  if (gate.ok) {
    assert.ok(
      gate.softPenalties.some((p) => p.includes("pool_v2_diameter_missing_soft"))
    );
  }
});

test("scoreAttributeMatch pools V2 rejects 15 ft vs 24 ft when env enabled", async () => {
  await withEnv(
    { DEPARTMENT_HARD_GATES_V2: "true", DEPARTMENT_PIPELINE_STRICT: undefined },
    () => {
      const source = normWithCritical("Intex 15 ft round above ground pool 52 inch");
      const candidate = normWithCritical("Intex 24 ft round above ground pool 52 inch");
      const rel = scoreAttributeMatch(
        source,
        candidate,
        "intex pool",
        candidate.structured.title,
        {
          selectedDepartment: "pools_outdoor",
          sourceTitle: source.structured.title,
        }
      );
      assert.equal(rel.rejected, true);
      assert.match(rel.rejectionReason ?? "", /pool_diameter_mismatch/);
      assert.equal(rel.matchConfidenceLabel, "low");
    }
  );
});

test("scoreAttributeMatch pools V2 off preserves Phase 1 high score for 15 vs 24 ft", async () => {
  await withEnv(
    { DEPARTMENT_HARD_GATES_V2: undefined, DEPARTMENT_PIPELINE_STRICT: undefined },
    () => {
      const source = normWithCritical("Intex 15 ft round above ground pool 52 inch");
      const candidate = normWithCritical("Intex 24 ft round above ground pool 52 inch");
      const rel = scoreAttributeMatch(
        source,
        candidate,
        "intex pool",
        candidate.structured.title,
        {
          selectedDepartment: "pools_outdoor",
          sourceTitle: source.structured.title,
        }
      );
      assert.equal(rel.rejected, false);
      assert.ok(rel.relevanceScore >= 70);
    }
  );
});

test("scoreAttributeMatch pools V2 missing diameter capped under strict mode", async () => {
  await withEnv(
    {
      DEPARTMENT_HARD_GATES_V2: "true",
      DEPARTMENT_PIPELINE_STRICT: "true",
    },
    () => {
      const source = normWithCritical("Intex 15 ft round above ground pool 52 inch");
      const candidate = normWithCritical("Intex round above ground pool with pump and filter");
      const rel = scoreAttributeMatch(
        source,
        candidate,
        "intex pool",
        candidate.structured.title,
        {
          selectedDepartment: "pools_outdoor",
          sourceTitle: source.structured.title,
        }
      );
      assert.equal(rel.rejected, false);
      assert.ok(rel.relevanceScore <= 65);
      assert.notEqual(rel.matchConfidenceLabel, "high");
    }
  );
});

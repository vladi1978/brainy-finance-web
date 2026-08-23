import assert from "node:assert/strict";
import test from "node:test";
import { withCriticalAttributes } from "../criticalAttributes";
import { buildNormalizedProduct } from "../normalize";
import {
  buildDepartmentInputMismatchMessage,
  detectInputDepartmentFromSource,
  validateDepartmentPreSearchGuard,
  validateDepartmentInputGate,
} from "./departmentInputGate";

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

test("detectInputDepartmentFromSource classifies pool vs electronics vs tools", () => {
  const pool = normWithCritical("Intex above ground pool 18x52 with pump");
  assert.equal(
    detectInputDepartmentFromSource(pool, pool.structured.title),
    "pools_outdoor"
  );

  const tv = normWithCritical("Samsung 65 inch smart tv DU7200");
  assert.equal(
    detectInputDepartmentFromSource(tv, tv.structured.title),
    "electronics"
  );

  const drill = normWithCritical("DeWalt DCD777 20V drill kit with battery");
  assert.equal(
    detectInputDepartmentFromSource(drill, drill.structured.title),
    "tools"
  );

  const hoodie = normWithCritical("Nike mens fleece hoodie black large");
  assert.equal(
    detectInputDepartmentFromSource(hoodie, hoodie.structured.title),
    "apparel"
  );
});

test("buildDepartmentInputMismatchMessage uses department labels", () => {
  const msg = buildDepartmentInputMismatchMessage("electronics", "pools_outdoor");
  assert.match(msg, /Pools & Outdoor/i);
  assert.match(msg, /Electronics/i);
});

test("validateDepartmentInputGate blocks electronics selection with pool product when V2 on", () => {
  return withEnv({ DEPARTMENT_HARD_GATES_V2: "true" }, () => {
    const pool = normWithCritical("Intex above ground pool 18x52 with pump");
    const gate = validateDepartmentInputGate(
      "electronics",
      pool,
      pool.structured.title
    );
    assert.equal(gate.ok, false);
    if (!gate.ok) {
      assert.equal(gate.detectedDepartment, "pools_outdoor");
      assert.equal(gate.selectedDepartment, "electronics");
      assert.match(gate.message, /Pools & Outdoor/i);
    }
  });
});

test("validateDepartmentInputGate allows matching department when V2 on", () => {
  return withEnv({ DEPARTMENT_HARD_GATES_V2: "true" }, () => {
    const pool = normWithCritical("Intex above ground pool 18x52 with pump");
    const gate = validateDepartmentInputGate(
      "pools_outdoor",
      pool,
      pool.structured.title
    );
    assert.equal(gate.ok, true);
  });
});

test("validateDepartmentInputGate is no-op when V2 off", () => {
  return withEnv({ DEPARTMENT_HARD_GATES_V2: undefined }, () => {
    const pool = normWithCritical("Intex above ground pool 18x52 with pump");
    const gate = validateDepartmentInputGate(
      "electronics",
      pool,
      pool.structured.title
    );
    assert.equal(gate.ok, true);
  });
});

test("pre-search guard blocks electronics selected with pool title", () => {
  const pool = normWithCritical("Intex above ground pool 18x52 with pump");
  const guard = validateDepartmentPreSearchGuard(
    "electronics",
    pool,
    pool.structured.title,
    "Brainy AI description: above ground pool with filter pump."
  );
  assert.equal(guard.ok, false);
  if (!guard.ok) {
    assert.equal(guard.detectedDepartment, "pools_outdoor");
    assert.match(
      guard.message,
      /This product appears to belong to Pools & Outdoor\./i
    );
  }
});

test("pre-search guard blocks pools selected with tv title", () => {
  const tv = normWithCritical("Samsung 65 inch smart tv DU7200");
  const guard = validateDepartmentPreSearchGuard(
    "pools_outdoor",
    tv,
    tv.structured.title,
    "Brainy AI description: 65 inch 4K smart television."
  );
  assert.equal(guard.ok, false);
  if (!guard.ok) {
    assert.equal(guard.detectedDepartment, "electronics");
    assert.match(guard.message, /Please switch to Electronics/i);
  }
});

test("pre-search guard allows electronics selected with tv title", () => {
  const tv = normWithCritical("LG 55 inch OLED smart tv");
  const guard = validateDepartmentPreSearchGuard(
    "electronics",
    tv,
    tv.structured.title,
    "Brainy AI description: OLED 4K smart TV."
  );
  assert.equal(guard.ok, true);
});

test("pre-search guard allows pools selected with pool title", () => {
  const pool = normWithCritical("Bestway steel pro max above ground pool set");
  const guard = validateDepartmentPreSearchGuard(
    "pools_outdoor",
    pool,
    pool.structured.title,
    "Brainy AI description: above-ground pool set with filter pump."
  );
  assert.equal(guard.ok, true);
});

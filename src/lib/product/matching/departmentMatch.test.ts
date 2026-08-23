import assert from "node:assert/strict";
import test from "node:test";
import { withCriticalAttributes } from "../criticalAttributes";
import { buildNormalizedProduct } from "../normalize";
import { checkDepartmentCriticalSpecsGate } from "./criticalSpecs";

function normWithCritical(title: string) {
  return withCriticalAttributes(title, buildNormalizedProduct(title));
}

test("pool 18x52 allows 20x51 as possible alternative (not hard reject)", () => {
  const source = normWithCritical("Intex above ground pool 18x52 with pump");
  const candidate = normWithCritical("Intex above ground pool 20x51 with pump");
  const gate = checkDepartmentCriticalSpecsGate(source, candidate, candidate.structured.title);
  assert.ok(gate);
  assert.equal(gate.ok, true);
});

test("65 inch tv allows 60 inch tv with strong penalty not hard reject", () => {
  const source = normWithCritical("Samsung 65 inch smart tv DU7200");
  const candidate = normWithCritical("Samsung 60 inch smart tv DU7200");
  const gate = checkDepartmentCriticalSpecsGate(source, candidate, candidate.structured.title);
  assert.ok(gate);
  assert.equal(gate.ok, true);
  assert.ok(
    gate.softPenalties.some((p) => p.includes("screen_size_strong") || p.includes("department_screen_size_strong"))
  );
});

test("50 inch tv allows candidate with missing screen size via soft penalty", () => {
  const source = normWithCritical("Roku 50 inch smart tv 4K");
  const candidate = normWithCritical("Roku smart tv 4K HDR streaming");
  const gate = checkDepartmentCriticalSpecsGate(source, candidate, candidate.structured.title);
  assert.ok(gate);
  assert.equal(gate.ok, true);
  assert.ok(
    gate.softPenalties.some((p) => p.includes("department_screen_size_missing_soft"))
  );
});

test("50 inch tv still rejects known 65 inch mismatch", () => {
  const source = normWithCritical("Roku 50 inch smart tv 4K");
  const candidate = normWithCritical("Roku 65 inch smart tv 4K");
  const gate = checkDepartmentCriticalSpecsGate(source, candidate, candidate.structured.title);
  assert.ok(gate);
  assert.equal(gate.ok, false);
});

test("shoe size mismatch rejected", () => {
  const source = normWithCritical("Nike running shoe men size 10");
  const candidate = normWithCritical("Nike running shoe men size 11");
  const gate = checkDepartmentCriticalSpecsGate(source, candidate, candidate.structured.title);
  assert.ok(gate);
  assert.equal(gate.ok, false);
});

test("tool voltage mismatch rejected", () => {
  const source = normWithCritical("DeWalt DCD777 20V drill kit with battery and charger");
  const candidate = normWithCritical("DeWalt DCD777 12V drill kit with battery and charger");
  const gate = checkDepartmentCriticalSpecsGate(source, candidate, candidate.structured.title);
  assert.ok(gate);
  assert.equal(gate.ok, false);
});

test("unknown category falls back to universal", () => {
  const source = normWithCritical("Universal gadget alpha 123");
  const candidate = normWithCritical("Universal gadget alpha 123 black");
  const gate = checkDepartmentCriticalSpecsGate(source, candidate, candidate.structured.title);
  assert.equal(gate, null);
});

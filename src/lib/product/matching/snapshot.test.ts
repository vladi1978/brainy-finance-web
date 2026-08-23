import assert from "node:assert/strict";
import test from "node:test";
import { withCriticalAttributes } from "../criticalAttributes";
import { buildNormalizedProduct } from "../normalize";
import {
  buildUniversalMatchSnapshot,
  parseInchesFromDimensionSignature,
} from "./snapshot";
import { checkDepartmentCriticalSpecsGate } from "./criticalSpecs";

const HISENSE_FULL =
  "Hisense 50 inch Class 4K UHD LED LCD Roku Smart TV HDR R6 Series 50R6E3";
const HISENSE_SHORT =
  "Hisense Class 4K UHD LED LCD Roku Smart TV HDR R6 Series";

test("parseInchesFromDimensionSignature accepts common TV inch signatures", () => {
  const cases: [string, number][] = [
    ["32inch", 32],
    ["40 inch", 40],
    ["43-inch", 43],
    ["50inch", 50],
    ["55", 55],
    ["65inch", 65],
    ["75 inch", 75],
    ["85inch", 85],
  ];
  for (const [sig, expected] of cases) {
    assert.equal(
      parseInchesFromDimensionSignature(sig),
      expected,
      `expected ${expected} from ${sig}`
    );
  }
});

test("full Hisense title snapshot diagonalInches is 50", () => {
  const norm = buildNormalizedProduct(HISENSE_FULL);
  const snap = buildUniversalMatchSnapshot(norm);
  assert.equal(snap.diagonalInches, 50);
});

test("short title hydrates diagonalInches from critical dimensionSignatures", () => {
  let norm = buildNormalizedProduct(HISENSE_SHORT);
  norm = withCriticalAttributes(`${HISENSE_FULL} ${HISENSE_SHORT}`.trim(), norm);
  assert.equal(norm.sizeInches, null);
  assert.ok(norm.critical?.dimensionSignatures.includes("50inch"));

  const snap = buildUniversalMatchSnapshot(norm);
  assert.equal(snap.diagonalInches, 50);
});

test("TV source with signature 50 runs screen department gate (does not skip)", () => {
  let source = buildNormalizedProduct(HISENSE_SHORT);
  source = withCriticalAttributes(`${HISENSE_FULL} ${HISENSE_SHORT}`.trim(), source);
  assert.equal(buildUniversalMatchSnapshot(source).diagonalInches, 50);

  const candidate = withCriticalAttributes(
    "Samsung 65 inch smart tv DU7200",
    buildNormalizedProduct("Samsung 65 inch smart tv DU7200")
  );

  const gate = checkDepartmentCriticalSpecsGate(
    source,
    candidate,
    candidate.structured.title
  );
  assert.ok(gate, "expected screen department gate to run, not universal fallback skip");
  assert.equal(gate.ok, false);
  assert.match(String(gate.reason), /screen_size_mismatch/i);
});

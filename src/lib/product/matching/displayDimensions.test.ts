import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateScreenSizeGate,
  extractDiagonalInches,
  extractDisplayModelNumbers,
  screenSizeDeltaTier,
  screenSizeShouldHardReject,
} from "./displayDimensions";
import { cleanRetailerSearchQuery } from "./searchQueryCleanup";
import { withCriticalAttributes } from "../criticalAttributes";
import { buildNormalizedProduct } from "../normalize";
import { checkDepartmentCriticalSpecsGate } from "./criticalSpecs";

test("extractDiagonalInches parses common TV size phrasing", () => {
  assert.equal(extractDiagonalInches('Samsung 75" Class QLED'), 75);
  assert.equal(extractDiagonalInches("LG 75-inch UHD TV"), 75);
  assert.equal(extractDiagonalInches("TCL 65in Smart TV"), 65);
  assert.equal(extractDiagonalInches("Sony Class 55 Bravia"), 55);
});

test("extractDiagonalInches reads size from model codes", () => {
  assert.equal(extractDiagonalInches("Hisense 75U6SF ULED TV"), 75);
  assert.equal(extractDiagonalInches("Samsung QN90C Neo QLED"), null);
  assert.equal(extractDiagonalInches("Samsung 65QN90C Neo QLED TV"), 65);
  assert.equal(extractDiagonalInches("LG OLED55C4 TV"), 55);
});

test("screen size tiers: reject above 5 inches", () => {
  assert.equal(screenSizeDeltaTier(0), "exact");
  assert.equal(screenSizeDeltaTier(2), "moderate");
  assert.equal(screenSizeDeltaTier(5), "strong");
  assert.equal(screenSizeDeltaTier(6), "reject");
  assert.equal(screenSizeShouldHardReject(75, 50), true);
  assert.equal(screenSizeShouldHardReject(65, 60), false);
});

test("evaluateScreenSizeGate penalizes missing candidate size", () => {
  const result = evaluateScreenSizeGate(50, null);
  assert.equal(result.action, "penalty");
  assert.equal(result.reason, "candidate_size_missing");
  assert.ok(result.softPenalties.some((p) => p.includes("missing_soft(-10)")));
});

test("evaluateScreenSizeGate rejects known mismatch", () => {
  const result = evaluateScreenSizeGate(50, 65);
  assert.equal(result.action, "reject");
  assert.match(result.reason, /screen_size_mismatch/);
});

test("tv screen size: 65 inch rejects 55, 50, and 75", () => {
  const source = withCriticalAttributes(
    "Samsung 65 inch smart tv DU7200",
    buildNormalizedProduct("Samsung 65 inch smart tv DU7200")
  );
  for (const title of [
    "Samsung 55 inch smart tv DU7200",
    "Samsung 50 inch smart tv DU7200",
    "Samsung 75 inch smart tv DU7200",
  ]) {
    const candidate = withCriticalAttributes(
      title,
      buildNormalizedProduct(title)
    );
    const gate = checkDepartmentCriticalSpecsGate(
      source,
      candidate,
      candidate.structured.title
    );
    assert.ok(gate);
    assert.equal(gate.ok, false, `expected reject for ${title}`);
  }
});

test("search query dedupe removes repeated brand tokens", () => {
  const q = cleanRetailerSearchQuery(
    "52 embassy by doughboy round embassy century by doughboy"
  );
  assert.equal(
    q.toLowerCase().split(/\s+/).filter((w) => w === "embassy").length,
    1
  );
  assert.equal(q.toLowerCase().split(/\s+/).filter((w) => w === "by").length, 1);
});

test("extractDisplayModelNumbers captures TV SKUs", () => {
  const models = extractDisplayModelNumbers("Samsung 65QN90C Neo QLED TV");
  assert.ok(models.some((m) => m.includes("qn90") || m.includes("65qn")));
});

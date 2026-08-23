import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNormalizedProduct,
  extractBrand,
  extractTvPlatform,
} from "./normalize";
import { scoreProductIdentity } from "./matching/productIdentity";

const ROKU_OEM_SOURCE =
  "Roku 50 Inch Class Select Series 4K QLED Smart TV";
const HISENSE_ROKU_CANDIDATE =
  "Hisense 50 inch Class 4K UHD LED LCD Roku Smart TV HDR R6 Series 50R6E3";
const HISENSE_ROKU_SOURCE =
  "Hisense 50 inch Class 4K UHD LED LCD Roku Smart TV HDR R6 Series 50R6E3";
const HISENSE_ROKU_CANDIDATE_ALT =
  "Hisense 50-Inch Class R6 Series 4K UHD LED Roku Smart TV 50R6E3";

test("extractBrand separates Roku OEM from Hisense + Roku platform", () => {
  assert.equal(extractBrand(ROKU_OEM_SOURCE), "roku");
  assert.equal(extractBrand(HISENSE_ROKU_CANDIDATE), "hisense");
  assert.equal(extractTvPlatform(ROKU_OEM_SOURCE), "roku");
  assert.equal(extractTvPlatform(HISENSE_ROKU_CANDIDATE), "roku");
});

test("buildNormalizedProduct persists smartTvPlatform on TV listings", () => {
  const rokuTv = buildNormalizedProduct(ROKU_OEM_SOURCE);
  const hisenseTv = buildNormalizedProduct(HISENSE_ROKU_CANDIDATE);
  assert.equal(rokuTv.brand, "roku");
  assert.equal(rokuTv.structured.smartTvPlatform, "roku");
  assert.equal(rokuTv.tv?.platform, "roku");
  assert.equal(hisenseTv.brand, "hisense");
  assert.equal(hisenseTv.structured.smartTvPlatform, "roku");
  assert.equal(hisenseTv.tv?.platform, "roku");
});

test("Roku OEM source vs Hisense + Roku platform is not exact_match and scores below 90", () => {
  const sourceNorm = buildNormalizedProduct(ROKU_OEM_SOURCE);
  const candNorm = buildNormalizedProduct(HISENSE_ROKU_CANDIDATE);
  const identity = scoreProductIdentity(sourceNorm, candNorm, HISENSE_ROKU_CANDIDATE, {
    sourceTitle: ROKU_OEM_SOURCE,
  });
  assert.notEqual(identity.matchType, "exact_match");
  assert.ok(identity.identityScore < 90, `expected <90, got ${identity.identityScore}`);
  assert.ok(
    identity.identityReasons.some((r) => r.startsWith("brand:miss")),
    identity.identityReasons.join("; ")
  );
});

test("Hisense + Roku source vs Hisense + Roku candidate can still score high", () => {
  const sourceNorm = buildNormalizedProduct(HISENSE_ROKU_SOURCE);
  const candNorm = buildNormalizedProduct(HISENSE_ROKU_CANDIDATE_ALT);
  const identity = scoreProductIdentity(sourceNorm, candNorm, HISENSE_ROKU_CANDIDATE_ALT, {
    sourceTitle: HISENSE_ROKU_SOURCE,
  });
  assert.ok(
    identity.identityScore >= 75,
    `expected high score, got ${identity.identityScore}`
  );
  assert.ok(
    identity.matchType === "exact_match" || identity.matchType === "close_match",
    identity.matchType
  );
});

test("Roku OEM source vs Roku OEM candidate scores high when size aligns", () => {
  const sourceNorm = buildNormalizedProduct(ROKU_OEM_SOURCE);
  const candNorm = buildNormalizedProduct(ROKU_OEM_SOURCE);
  const identity = scoreProductIdentity(
    sourceNorm,
    candNorm,
    ROKU_OEM_SOURCE,
    { sourceTitle: ROKU_OEM_SOURCE }
  );
  assert.ok(identity.identityScore >= 82);
  assert.ok(
    identity.matchType === "exact_match" || identity.matchType === "close_match",
    identity.matchType
  );
});

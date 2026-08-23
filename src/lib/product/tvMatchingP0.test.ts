import assert from "node:assert/strict";
import test from "node:test";
import { scoreAttributeMatch } from "./attributeMatch";
import { buildNormalizedProduct } from "./normalize";
import {
  BAND_HIGH_CONFIDENCE_MIN,
  classifyConfidenceBand,
  displayMatchScore,
} from "./matching/confidenceBands";
import { scoreProductIdentity } from "./matching/productIdentity";
import { scoreDepartmentMatch } from "./department/departmentScoring";
import { resolveTvDisplayScoreCap } from "./department/tvMatchingPolicy";

const ROKU_SELECT_SOURCE =
  "Roku 50 inch Select Series 4K Smart TV";
const HAIER_H50_CANDIDATE =
  "Haier H50S80EU 50 inch 4K QLED Smart TV";
const ROKU_OEM_SOURCE =
  "Roku 50 Inch Class Select Series 4K QLED Smart TV";
const HISENSE_ROKU_SOURCE =
  "Hisense 50 inch Class 4K UHD LED LCD Roku Smart TV HDR R6 Series 50R6E3";
const HISENSE_ROKU_CANDIDATE_ALT =
  "Hisense 50-Inch Class R6 Series 4K UHD LED Roku Smart TV 50R6E3";

function hydrateTvListing(
  base: ReturnType<typeof buildNormalizedProduct>,
  patch: {
    brand?: string | null;
    sizeInches?: number;
    modelFamily?: string | null;
    fullModel?: string | null;
    resolution?: string | null;
    smartTv?: boolean;
    smartTvPlatform?: string | null;
    displayType?: string | null;
    productType?: string;
    category?: "tv" | "general";
  }
): ReturnType<typeof buildNormalizedProduct> {
  const brand = patch.brand ?? base.brand ?? base.structured.brand;
  return {
    ...base,
    brand: brand ?? null,
    category: patch.category ?? base.category,
    structured: {
      ...base.structured,
      brand: brand ?? null,
      category: patch.category ?? base.structured.category,
      productType: patch.productType ?? base.structured.productType ?? "tv",
      sizeInches: patch.sizeInches ?? base.structured.sizeInches,
      modelFamily: patch.modelFamily ?? base.structured.modelFamily,
      fullModel: patch.fullModel ?? base.structured.fullModel,
      resolution: patch.resolution ?? base.structured.resolution,
      smartTv: patch.smartTv ?? base.structured.smartTv,
      smartTvPlatform:
        patch.smartTvPlatform ?? base.structured.smartTvPlatform,
      displayType: patch.displayType ?? base.structured.displayType,
    },
  };
}

function scoreTvPair(
  sourceTitle: string,
  candidateTitle: string,
  sourcePatch?: Parameters<typeof hydrateTvListing>[1],
  candidatePatch?: Parameters<typeof hydrateTvListing>[1]
) {
  let source = buildNormalizedProduct(sourceTitle);
  let candidate = buildNormalizedProduct(candidateTitle);
  if (sourcePatch) source = hydrateTvListing(source, sourcePatch);
  if (candidatePatch) candidate = hydrateTvListing(candidate, candidatePatch);

  const rel = scoreAttributeMatch(source, candidate, sourceTitle, candidateTitle, {
    selectedDepartment: "electronics",
    sourceTitle,
  });
  const identity = scoreProductIdentity(source, candidate, candidateTitle, {
    sourceTitle,
  });
  const dept = scoreDepartmentMatch(
    "electronics",
    source,
    candidate,
    sourceTitle,
    candidateTitle,
    1
  );
  const tvScoreCap = resolveTvDisplayScoreCap({
    sourceNorm: source,
    candidateNorm: candidate,
    sourceTitle,
    candidateTitle,
    identity,
    departmentScore: rel.departmentScore,
  });
  const display = displayMatchScore({
    relevanceScore: rel.relevanceScore,
    identityScore: identity.identityScore,
    departmentScore: rel.departmentScore,
    tvScoreCap,
  });

  return { rel, identity, dept, display, band: classifyConfidenceBand(display) };
}

test("P0: Roku Select Series vs Haier H50S80EU is not High Confidence", () => {
  const { rel, identity, dept, display, band } = scoreTvPair(
    ROKU_SELECT_SOURCE,
    HAIER_H50_CANDIDATE,
    {
      brand: "roku",
      sizeInches: 50,
      resolution: "4k",
      smartTv: true,
      smartTvPlatform: "roku",
      category: "tv",
    },
    {
      brand: "haier",
      sizeInches: 50,
      resolution: "4k",
      smartTv: true,
      displayType: "qled",
      fullModel: "H50S80EU",
      category: "tv",
    }
  );

  assert.ok(
    display < BAND_HIGH_CONFIDENCE_MIN,
    `display ${display} should be < ${BAND_HIGH_CONFIDENCE_MIN}`
  );
  assert.notEqual(band, "high_confidence");
  assert.notEqual(band, "exact_match");
  assert.ok(dept.score <= 65, `department ${dept.score} should be capped`);
  assert.ok(
    dept.scoreReasons.some((r) => r.includes("tv_source_missing_candidate_sku")),
    dept.scoreReasons.join("; ")
  );
  assert.ok(
    rel.reasons.some((r) => r.includes("tv_brand_mismatch_cap")) ||
      identity.identityReasons.some((r) => r.startsWith("brand:miss")),
    "expected brand or TV cap signal"
  );
});

test("P0: same Roku OEM listing still scores high", () => {
  const source = hydrateTvListing(buildNormalizedProduct(ROKU_OEM_SOURCE), {
    category: "tv",
  });
  const candidate = hydrateTvListing(buildNormalizedProduct(ROKU_OEM_SOURCE), {
    category: "tv",
  });
  const rel = scoreAttributeMatch(
    source,
    candidate,
    ROKU_OEM_SOURCE,
    ROKU_OEM_SOURCE,
    { selectedDepartment: "electronics", sourceTitle: ROKU_OEM_SOURCE }
  );
  const identity = scoreProductIdentity(
    source,
    candidate,
    ROKU_OEM_SOURCE,
    { sourceTitle: ROKU_OEM_SOURCE }
  );
  const display = displayMatchScore({
    relevanceScore: rel.relevanceScore,
    identityScore: identity.identityScore,
    departmentScore: rel.departmentScore,
  });

  assert.ok(display >= 75, `display ${display} should stay high`);
  assert.ok(
    identity.matchType === "exact_match" || identity.matchType === "close_match",
    identity.matchType
  );
});

test("P0: Hisense 50R6E3 vs Hisense 50R6E3 still scores high", () => {
  const { display, identity, dept } = scoreTvPair(
    HISENSE_ROKU_SOURCE,
    HISENSE_ROKU_CANDIDATE_ALT,
    { brand: "hisense", fullModel: "50R6E3" },
    { brand: "hisense", fullModel: "50R6E3" }
  );

  assert.ok(display >= 75, `display ${display} should stay high`);
  assert.ok(dept.score >= 72, `department ${dept.score} should stay high`);
  assert.ok(
    identity.matchType === "exact_match" || identity.matchType === "close_match",
    identity.matchType
  );
});

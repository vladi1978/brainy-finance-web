import assert from "node:assert/strict";
import test from "node:test";
import { withCriticalAttributes } from "../criticalAttributes";
import { buildNormalizedProduct } from "../normalize";
import {
  applyStrictSearchUrlCapToCandidate,
  applyStrictSearchUrlScoreCap,
  buildUserMatchReasons,
  capConfidenceBandForSearchUrl,
  classifyConfidenceBand,
  dedupeCompareResponseMessages,
  POSSIBLE_ALTERNATIVES_EXPLANATION,
  NO_EXACT_WITH_ALTERNATIVES_MESSAGE,
} from "../matching/confidenceBands";
import type { CompareApiCandidate } from "../types";
import { scoreDepartmentMatch } from "./departmentScoring";
import { isDepartmentPipelineStrict } from "./departmentPipelineStrict";

function normWithCritical(title: string) {
  return withCriticalAttributes(title, buildNormalizedProduct(title));
}

function withStrictFlag<T>(enabled: boolean, fn: () => T): T {
  const prev = process.env.DEPARTMENT_PIPELINE_STRICT;
  process.env.DEPARTMENT_PIPELINE_STRICT = enabled ? "true" : "false";
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete process.env.DEPARTMENT_PIPELINE_STRICT;
    } else {
      process.env.DEPARTMENT_PIPELINE_STRICT = prev;
    }
  }
}

function buildStrictCapCandidate(overrides: Partial<CompareApiCandidate> = {}): CompareApiCandidate {
  return {
    store: "walmart",
    title: "Samsung 75 inch tv listing",
    price: 599,
    currency: "USD",
    productUrl: "https://www.walmart.com/ip/Samsung-75-inch-TV/123456",
    affiliateUrl: "https://www.walmart.com/ip/Samsung-75-inch-TV/123456",
    imageUrl: null,
    normalized: buildNormalizedProduct("Samsung 75 inch tv"),
    confidence: 0.99,
    matchConfidenceLabel: "high",
    matchType: "exact_match",
    identityScore: 100,
    identityReasons: [],
    missingCriticalAttributes: [],
    relevanceScore: 100,
    relevanceReason: "match",
    displayMatchScore: 100,
    confidenceBand: "exact_match",
    urlType: "product",
    urlConfidence: "high",
    outboundUrl: "https://www.walmart.com/ip/Samsung-75-inch-TV/123456",
    outboundIsStoreSearch: false,
    ...overrides,
  };
}

test("strict flag defaults to false", () => {
  withStrictFlag(false, () => {
    assert.equal(isDepartmentPipelineStrict(), false);
  });
  const prev = process.env.DEPARTMENT_PIPELINE_STRICT;
  delete process.env.DEPARTMENT_PIPELINE_STRICT;
  try {
    assert.equal(isDepartmentPipelineStrict(), false);
  } finally {
    if (prev !== undefined) process.env.DEPARTMENT_PIPELINE_STRICT = prev;
  }
});

test("strict mode caps department score when required attributes missing", () => {
  withStrictFlag(true, () => {
    const source = normWithCritical("Samsung smart tv");
    const candidate = normWithCritical("Samsung smart tv listing");
    const scoring = scoreDepartmentMatch(
      "electronics",
      source,
      candidate,
      source.structured.title,
      candidate.structured.title,
      1
    );
    assert.ok(scoring.confidenceCappedForMissingData);
    assert.ok(scoring.score <= 65);
    assert.ok(
      scoring.scoreReasons.some((r) => r.includes("confidence_capped_missing_data"))
    );
    assert.notEqual(scoring.tier, "exact_match");
    assert.notEqual(scoring.tier, "high_confidence");
  });
});

test("legacy mode keeps higher unknown-attribute contribution", () => {
  withStrictFlag(false, () => {
    const source = normWithCritical("Samsung smart tv");
    const candidate = normWithCritical("Samsung smart tv listing");
    const scoring = scoreDepartmentMatch(
      "electronics",
      source,
      candidate,
      source.structured.title,
      candidate.structured.title,
      1
    );
    assert.equal(scoring.confidenceCappedForMissingData, undefined);
    assert.ok(!scoring.scoreReasons.some((r) => r.includes("confidence_capped_missing_data")));
  });
});

test("strict mode scopes pool vs electronics user reason lines", () => {
  withStrictFlag(true, () => {
    const poolReasons = buildUserMatchReasons({
      rel: {
        confidence: 0.7,
        matchType: "equivalent",
        matchConfidenceLabel: "medium",
        relevanceScore: 70,
        reasons: ["diagonal_exact", "size_exact", "screen_size_exact"],
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
    assert.ok(!poolReasons.some((l) => /screen size/i.test(l)));

    const tvReasons = buildUserMatchReasons({
      rel: {
        confidence: 0.7,
        matchType: "equivalent",
        matchConfidenceLabel: "medium",
        relevanceScore: 70,
        reasons: ["pool shape matched", "shape_match", "frame_type"],
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
    assert.ok(!tvReasons.some((l) => /pool shape/i.test(l)));
    assert.ok(!tvReasons.some((l) => /frame type compatible/i.test(l)));
  });
});

test("search URL Exact Match is always demoted; strict also demotes High Confidence", () => {
  withStrictFlag(true, () => {
    assert.equal(capConfidenceBandForSearchUrl("exact_match"), "possible_alternative");
    assert.equal(
      capConfidenceBandForSearchUrl("high_confidence"),
      "possible_alternative"
    );
    assert.equal(
      capConfidenceBandForSearchUrl("possible_alternative"),
      "possible_alternative"
    );
  });
  withStrictFlag(false, () => {
    // Product-identity safety: Exact Match never sticks on search/category URLs.
    assert.equal(capConfidenceBandForSearchUrl("exact_match"), "possible_alternative");
    assert.equal(capConfidenceBandForSearchUrl("high_confidence"), "high_confidence");
  });
});

test("strict mode caps all visible search URL scores to 65", () => {
  withStrictFlag(true, () => {
    const capped = applyStrictSearchUrlScoreCap({
      displayMatchScore: 100,
      relevanceScore: 98,
      identityScore: 100,
      departmentScore: 92,
      confidence: 0.98,
      confidenceBand: "exact_match",
    });
    assert.equal(capped.displayMatchScore, 65);
    assert.equal(capped.relevanceScore, 65);
    assert.equal(capped.identityScore, 65);
    assert.equal(capped.departmentScore, 65);
    assert.equal(capped.confidence, 0.65);
    assert.equal(capped.confidenceBand, "possible_alternative");

    const candidate: CompareApiCandidate = buildStrictCapCandidate({
      title: "Samsung 75 inch tv search",
      productUrl: "https://www.walmart.com/search?q=tv",
      affiliateUrl: "https://www.walmart.com/search?q=tv",
      urlType: "search",
      urlConfidence: "low",
      outboundUrl: "https://www.walmart.com/search?q=tv",
      outboundIsStoreSearch: true,
    });
    const out = applyStrictSearchUrlCapToCandidate(candidate);
    assert.equal(out.displayMatchScore, 65);
    assert.equal(out.identityScore, 65);
    assert.equal(out.relevanceScore, 65);
    assert.equal(out.score, 65);
    assert.equal(out.confidenceBand, "possible_alternative");
    assert.equal(out.confidenceBandLabel, "Search Result — Verify Product");

    const outboundFlagOnly: CompareApiCandidate = {
      ...candidate,
      urlType: "product",
      outboundIsStoreSearch: true,
    };
    const flagged = applyStrictSearchUrlCapToCandidate(outboundFlagOnly);
    assert.equal(flagged.displayMatchScore, 65);
    assert.equal(flagged.confidenceBandLabel, "Search Result — Verify Product");
  });
});

test("strict mode caps category/homepage outbound URLs and keeps PDP uncapped", () => {
  withStrictFlag(true, () => {
    const categoryCandidate = buildStrictCapCandidate({
      outboundUrl: "https://www.walmart.com/browse?cat_id=1234",
      productUrl: "https://www.walmart.com/browse?cat_id=1234",
      affiliateUrl: "https://www.walmart.com/browse?cat_id=1234",
      outboundIsStoreSearch: false,
      urlType: "product",
      urlConfidence: "medium",
    });
    const categoryOut = applyStrictSearchUrlCapToCandidate(categoryCandidate);
    assert.equal(categoryOut.displayMatchScore, 65);
    assert.equal(categoryOut.confidenceBand, "possible_alternative");
    assert.equal(categoryOut.confidenceBandLabel, "Search Result — Verify Product");

    const homepageCandidate = buildStrictCapCandidate({
      outboundUrl: "https://www.walmart.com/",
      productUrl: "https://www.walmart.com/",
      affiliateUrl: "https://www.walmart.com/",
      outboundIsStoreSearch: false,
      urlType: "product",
      urlConfidence: "medium",
    });
    const homepageOut = applyStrictSearchUrlCapToCandidate(homepageCandidate);
    assert.equal(homepageOut.displayMatchScore, 65);
    assert.equal(homepageOut.confidenceBand, "possible_alternative");
    assert.equal(homepageOut.confidenceBandLabel, "Search Result — Verify Product");

    const pdpCandidate = buildStrictCapCandidate({
      outboundUrl: "https://www.walmart.com/ip/Samsung-75-inch-TV/123456",
      productUrl: "https://www.walmart.com/ip/Samsung-75-inch-TV/123456",
      affiliateUrl: "https://www.walmart.com/ip/Samsung-75-inch-TV/123456",
      outboundIsStoreSearch: false,
      urlType: "product",
      urlConfidence: "high",
    });
    const pdpOut = applyStrictSearchUrlCapToCandidate(pdpCandidate);
    assert.equal(pdpOut.displayMatchScore, 100);
    assert.equal(pdpOut.confidenceBand, "exact_match");
    assert.equal(pdpOut.confidenceBandLabel, "Exact Match");
  });
});

test("legacy mode demotes Exact Match on search URLs but does not score-cap", () => {
  withStrictFlag(false, () => {
    const searchCandidate = buildStrictCapCandidate({
      outboundUrl: "https://www.walmart.com/search?q=tv",
      productUrl: "https://www.walmart.com/search?q=tv",
      affiliateUrl: "https://www.walmart.com/search?q=tv",
      outboundIsStoreSearch: true,
      urlType: "search",
      urlConfidence: "low",
    });
    const out = applyStrictSearchUrlCapToCandidate(searchCandidate);
    assert.equal(out.displayMatchScore, 100);
    assert.equal(out.confidenceBand, "possible_alternative");
    assert.notEqual(out.confidenceBand, "exact_match");
  });
});

test("dedupeCompareResponseMessages removes duplicate amber copy", () => {
  const deduped = dedupeCompareResponseMessages({
    comparisonMessage: NO_EXACT_WITH_ALTERNATIVES_MESSAGE,
    message: POSSIBLE_ALTERNATIVES_EXPLANATION,
    hasPossibleAlternativesOnly: true,
  });
  assert.equal(deduped.message, null);
  assert.equal(deduped.comparisonMessage, NO_EXACT_WITH_ALTERNATIVES_MESSAGE);
});

test("known good matches unchanged in legacy mode", () => {
  withStrictFlag(false, () => {
    const tvSource = normWithCritical('Samsung 75" Class DU7200 Crystal UHD 4K Smart TV');
    const tvCandidate = normWithCritical('Samsung 75" Class DU7200 Crystal UHD 4K Smart TV');
    const tvScore = scoreDepartmentMatch(
      "electronics",
      tvSource,
      tvCandidate,
      tvSource.structured.title,
      tvCandidate.structured.title,
      1
    );
    assert.ok(tvScore.score >= 85);

    const poolSource = normWithCritical("Intex above ground pool 18x52 with pump");
    const poolCandidate = normWithCritical("Intex above ground pool 18x52 with pump");
    const poolScore = scoreDepartmentMatch(
      "pools_outdoor",
      poolSource,
      poolCandidate,
      poolSource.structured.title,
      poolCandidate.structured.title,
      1
    );
    assert.ok(poolScore.score >= 80);

    const toolSource = normWithCritical("DeWalt DCD777 20V drill kit with battery and charger");
    const toolCandidate = normWithCritical("DeWalt DCD777 20V drill kit with battery and charger");
    const toolScore = scoreDepartmentMatch(
      "tools",
      toolSource,
      toolCandidate,
      toolSource.structured.title,
      toolCandidate.structured.title,
      1
    );
    assert.ok(toolScore.score >= 80);
    assert.equal(classifyConfidenceBand(toolScore.score), "exact_match");
  });
});

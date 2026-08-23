/**
 * P1 regression: Exact Match requires confirmed strong model when reference has one.
 * Covers Vizio V4K65M-0804 production defect (generic Exact Match + parts Best Deal).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  isIncompleteOrPartsListingTitle,
  isSuspiciousPurchasePriceRatio,
} from "../commercialListingClassifier";
import { buildNormalizedProduct } from "../normalize";
import {
  applyIdentityMatchTypeToConfidenceBand,
  applyStrictSearchUrlCapToCandidate,
  buildUserMatchReasons,
  classifyConfidenceBand,
  displayMatchScore,
  isStrictSearchFallbackOutbound,
} from "./confidenceBands";
import {
  isStrongModelIdentifier,
  scoreProductIdentity,
  extractUniversalProductIdentity,
} from "./productIdentity";
import type { CompareApiCandidate } from "../types";

const SOURCE_TITLE = "Vizio V4K65M-0804 65-inch 4K HDR Smart TV";
const REFERENCE_PRICE = 348;

function sourceProduct() {
  return buildNormalizedProduct(SOURCE_TITLE, { price: REFERENCE_PRICE });
}

function identityFor(candidateTitle: string) {
  const source = sourceProduct();
  const candidate = buildNormalizedProduct(candidateTitle, { price: 299 });
  return {
    source,
    candidate,
    identity: scoreProductIdentity(source, candidate, candidateTitle, {
      sourceTitle: SOURCE_TITLE,
    }),
  };
}

function bandAfterIdentityGate(
  identity: ReturnType<typeof scoreProductIdentity>,
  scores: {
    relevanceScore: number;
    identityScore: number;
    departmentScore: number;
  }
) {
  const display = displayMatchScore(scores);
  let band = classifyConfidenceBand(display);
  band = applyIdentityMatchTypeToConfidenceBand(band, identity);
  return { display, band };
}

test("reference V4K65M-0804 extracts a strong model identifier", () => {
  const source = sourceProduct();
  const id = extractUniversalProductIdentity(source, SOURCE_TITLE);
  const strong = id.modelIdentifiers.filter(isStrongModelIdentifier);
  assert.ok(strong.some((m) => /V4K65M0804/i.test(m)));
});

test("exact same model is Exact Match eligible", () => {
  const title = "Vizio V4K65M-0804 65 inch 4K HDR Smart TV";
  const { identity } = identityFor(title);
  assert.equal(identity.matchType, "exact_match");
  const { band } = bandAfterIdentityGate(identity, {
    relevanceScore: 95,
    identityScore: identity.identityScore,
    departmentScore: 93,
  });
  assert.equal(band, "exact_match");
  const reasons = buildUserMatchReasons({
    rel: {
      confidence: 0.95,
      matchType: "high",
      matchConfidenceLabel: "high",
      relevanceScore: 95,
      reasons: ["tier:exact_match"],
      rejected: false,
      rejectionReason: null,
      matchExplanation: "Same screen size and model family",
      departmentScore: 93,
      departmentTier: "exact_match",
    },
    identity,
    displayScore: 95,
    confidenceBand: band,
    selectedDepartment: "electronics",
  });
  assert.ok(!reasons.includes("Same product line or close variant"));
});

test("candidate missing model is not Exact Match", () => {
  const title = "Vizio 65-inch 4K HDR Smart TV";
  const { identity } = identityFor(title);
  assert.notEqual(identity.matchType, "exact_match");
  assert.equal(identity.matchType, "alternative");
  assert.ok(
    identity.identityReasons.some((r) =>
      /missing_or_unconfirmed_model|tier:alternative/i.test(r)
    )
  );
  const { band } = bandAfterIdentityGate(identity, {
    relevanceScore: 92,
    identityScore: identity.identityScore,
    departmentScore: 88,
  });
  assert.notEqual(band, "exact_match");
  assert.notEqual(band, "high_confidence");
  assert.equal(band, "possible_alternative");
});

test("candidate with different strong model is alternative", () => {
  const title = "Vizio V4K65M-1234 65-inch 4K Smart TV";
  const { identity } = identityFor(title);
  assert.equal(identity.matchType, "alternative");
  assert.ok(
    identity.identityReasons.some((r) => /different_model/i.test(r))
  );
  const { band } = bandAfterIdentityGate(identity, {
    relevanceScore: 90,
    identityScore: identity.identityScore,
    departmentScore: 85,
  });
  assert.equal(band, "possible_alternative");
});

test("generic same-brand same-size TV is not Exact Match", () => {
  const title = 'VIZIO 65" Class 4K UHD LED HDR Smart TV';
  const { identity } = identityFor(title);
  assert.notEqual(identity.matchType, "exact_match");
  const { band } = bandAfterIdentityGate(identity, {
    relevanceScore: 91,
    identityScore: identity.identityScore,
    departmentScore: 90,
  });
  assert.notEqual(band, "exact_match");
});

test("search-result URL cannot remain Exact Match", () => {
  const candidate = {
    store: "walmart",
    title: "Vizio V4K65M-0804 65 inch Smart TV",
    price: 299,
    relevanceScore: 95,
    identityScore: 95,
    departmentScore: 95,
    confidence: 0.95,
    confidenceBand: "exact_match",
    confidenceBandLabel: "Exact Match",
    matchType: "exact_match",
    outboundUrl: "https://www.walmart.com/search?q=vizio+65+tv",
    affiliateUrl: "https://www.walmart.com/search?q=vizio+65+tv",
    urlType: "search",
    outboundIsStoreSearch: true,
    normalized: sourceProduct(),
  } as unknown as CompareApiCandidate;

  assert.equal(isStrictSearchFallbackOutbound(candidate), true);
  const capped = applyStrictSearchUrlCapToCandidate(candidate);
  assert.notEqual(capped.confidenceBand, "exact_match");
  assert.equal(capped.confidenceBand, "possible_alternative");
});

test("product-detail URL may keep Exact Match when identity is exact", () => {
  const candidate = {
    store: "walmart",
    title: "Vizio V4K65M-0804 65 inch Smart TV",
    price: 299,
    relevanceScore: 95,
    identityScore: 95,
    departmentScore: 95,
    confidence: 0.95,
    confidenceBand: "exact_match",
    confidenceBandLabel: "Exact Match",
    matchType: "exact_match",
    outboundUrl: "https://www.walmart.com/ip/Vizio-V4K65M-0804/123456789",
    affiliateUrl: "https://www.walmart.com/ip/Vizio-V4K65M-0804/123456789",
    urlType: "product",
    outboundIsStoreSearch: false,
    normalized: sourceProduct(),
  } as unknown as CompareApiCandidate;

  assert.equal(isStrictSearchFallbackOutbound(candidate), false);
  const capped = applyStrictSearchUrlCapToCandidate(candidate);
  assert.equal(capped.confidenceBand, "exact_match");
});

test("incomplete and parts listings are ineligible for Exact Match / Best Deal", () => {
  const titles = [
    'Vizio 65" Smart TV no screws',
    "Vizio 65 inch TV parts only",
    "Vizio 65 for parts",
    "Vizio 65 broken screen",
    "Vizio 65 needs repair",
    "Vizio 65 as-is for parts",
    "Vizio 65 screws not included",
  ];
  for (const title of titles) {
    assert.equal(
      isIncompleteOrPartsListingTitle(title),
      true,
      `expected incomplete/parts: ${title}`
    );
  }
});

test("normal new product without condition warnings remains eligible", () => {
  assert.equal(
    isIncompleteOrPartsListingTitle(
      "Vizio V4K65M-0804 65-inch 4K HDR Smart TV"
    ),
    false
  );
  assert.equal(
    isIncompleteOrPartsListingTitle('Vizio 65" Class 4K Smart TV — New'),
    false
  );
});

test("savings exclusion: incomplete listing and extreme price ratio are ineligible", () => {
  assert.equal(isIncompleteOrPartsListingTitle('eBay Vizio 65" no screws'), true);
  assert.equal(isSuspiciousPurchasePriceRatio(9.88, REFERENCE_PRICE), true);
  // $85 / $348 ≈ 0.24 — not extreme enough alone; condition phrases must block Best Deal.
  assert.equal(isSuspiciousPurchasePriceRatio(85, REFERENCE_PRICE), false);
  assert.equal(
    isIncompleteOrPartsListingTitle("Vizio 65 inch Smart TV no screws $85"),
    true
  );
});

test("without a strong reference model, brand+size Exact Match remains allowed", () => {
  const srcTitle = "Vizio 65-inch 4K HDR Smart TV";
  const source = buildNormalizedProduct(srcTitle, { price: 348 });
  const candTitle = 'Vizio 65" 4K HDR Smart TV';
  const candidate = buildNormalizedProduct(candTitle, { price: 299 });
  const strong = extractUniversalProductIdentity(source, srcTitle).modelIdentifiers.filter(
    isStrongModelIdentifier
  );
  assert.equal(strong.length, 0);
  const identity = scoreProductIdentity(source, candidate, candTitle, {
    sourceTitle: srcTitle,
  });
  assert.equal(identity.matchType, "exact_match");
});

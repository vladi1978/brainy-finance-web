/**
 * Honest Compare price-difference labels (Save vs lower / verify).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  isVerifiedSaveClaim,
  resolvePriceDifferenceClaim,
} from "./priceDifferenceClaim";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

test("verified exact match → Save $X", () => {
  const claim = resolvePriceDifferenceClaim(
    {
      amount: 49,
      confidenceBand: "exact_match",
      matchType: "exact_match",
      title: "Vizio V4K65M-0804 65 inch 4K HDR Smart TV",
      urlType: "product",
      outboundUrl: "https://www.walmart.com/ip/Vizio-V4K65M-0804/123",
      store: "walmart",
    },
    fmt
  );
  assert.ok(claim);
  assert.equal(claim!.kind, "verified_save");
  assert.equal(claim!.label, "Save $49.00");
  assert.equal(isVerifiedSaveClaim(claim), true);
  assert.match(claim!.label, /^Save /);
  assert.doesNotMatch(claim!.label, /lower/i);
});

test("different model alternative → $X lower — different or unconfirmed model", () => {
  const claim = resolvePriceDifferenceClaim(
    {
      amount: 80,
      confidenceBand: "possible_alternative",
      matchType: "alternative",
      title: "Vizio 65-inch 4K HDR Smart TV",
      urlType: "product",
      outboundUrl: "https://www.walmart.com/ip/Vizio-65/999",
      store: "walmart",
    },
    fmt
  );
  assert.ok(claim);
  assert.equal(claim!.kind, "alternative_lower");
  assert.equal(claim!.label, "$80.00 lower — different or unconfirmed model");
  assert.equal(isVerifiedSaveClaim(claim), false);
  assert.doesNotMatch(claim!.label, /\bSave\b/);
});

test("unverified search result → Listed $X lower — verify product", () => {
  const claim = resolvePriceDifferenceClaim(
    {
      amount: 60,
      confidenceBand: "possible_alternative",
      matchType: "exact_match",
      title: "Vizio V4K65M-0804 65 inch Smart TV",
      urlType: "search",
      outboundIsStoreSearch: true,
      outboundUrl: "https://www.walmart.com/search?q=vizio+65",
      store: "walmart",
    },
    fmt
  );
  assert.ok(claim);
  assert.equal(claim!.kind, "search_listed_lower");
  assert.equal(claim!.label, "Listed $60.00 lower — verify product");
  assert.doesNotMatch(claim!.label, /\bSave\b/);
});

test("incomplete listing → no favorable price claim", () => {
  const claim = resolvePriceDifferenceClaim(
    {
      amount: 263,
      confidenceBand: "possible_alternative",
      matchType: "alternative",
      title: 'Vizio 65" Smart TV no screws',
      urlType: "product",
      outboundUrl: "https://www.ebay.com/itm/123",
      store: "ebay",
      commercialListingLabel: "Incomplete / parts listing",
    },
    fmt
  );
  assert.equal(claim, null);

  const byTitleOnly = resolvePriceDifferenceClaim(
    {
      amount: 263,
      confidenceBand: "exact_match",
      matchType: "exact_match",
      title: "Vizio 65 inch TV for parts",
      urlType: "product",
      outboundUrl: "https://www.ebay.com/itm/456",
      store: "ebay",
    },
    fmt
  );
  assert.equal(byTitleOnly, null);
});

test("no exact matches → no verified Best Deal savings claim", () => {
  const alt = resolvePriceDifferenceClaim(
    {
      amount: 50,
      confidenceBand: "high_confidence",
      matchType: "close_match",
      title: "Vizio 65 Class 4K Smart TV",
      urlType: "product",
      outboundUrl: "https://www.bestbuy.com/site/tv/123.p",
      store: "bestbuy",
    },
    fmt
  );
  assert.ok(alt);
  assert.notEqual(alt!.kind, "verified_save");
  assert.equal(isVerifiedSaveClaim(alt), false);
  assert.doesNotMatch(alt!.label, /\bSave\b/);
});

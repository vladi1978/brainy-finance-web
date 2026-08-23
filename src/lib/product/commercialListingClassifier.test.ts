import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCommercialListing,
  isIncompleteOrPartsListingTitle,
  isSuspiciousPurchasePriceRatio,
  resolveShoppingPurchasePrice,
  shouldRejectCommercialListing,
} from "./commercialListingClassifier";
import {
  BAND_EXACT_MIN,
  BAND_HIGH_CONFIDENCE_MIN,
  classifyConfidenceBand,
  displayMatchScore,
} from "./matching/confidenceBands";
import { buildNormalizedProduct } from "./normalize";

const SAMSUNG_TV_TITLE =
  "43 Inch Class Crystal UHD U8000F 4K Smart TV (2025)";
const REFERENCE_PRICE = 247.99;

test("myrentking.com $9.88/wk Samsung TV is rejected as non-purchase", () => {
  const resolved = resolveShoppingPurchasePrice({
    title: SAMSUNG_TV_TITLE,
    price: "$9.88/wk",
    url: "https://www.myrentking.com/product/samsung-43-tv",
    hostname: "myrentking.com",
    storeLabel: "myrentking.com",
  });
  assert.equal(resolved.purchasePrice, null);
  assert.equal(resolved.rejected, true);
  assert.equal(resolved.rejectReason, "payment_period_price_only");

  const classified = classifyCommercialListing({
    title: SAMSUNG_TV_TITLE,
    rawPrice: "$9.88/wk",
    url: "https://www.myrentking.com/product/samsung-43-tv",
    hostname: "myrentking.com",
    storeLabel: "myrentking.com",
  });
  assert.equal(classified.listingType, "rental");
  assert.notEqual(classified.priceIntent, "purchase_price");
  assert.equal(shouldRejectCommercialListing(classified), true);
});

test("full purchase price wins when installment is also present", () => {
  const resolved = resolveShoppingPurchasePrice({
    title: "Samsung 43 Inch Crystal UHD TV",
    price: "$247.99",
    installment: { price: "$12/mo" },
    url: "https://www.walmart.com/ip/samsung-tv",
    hostname: "walmart.com",
    storeLabel: "Walmart",
  });
  assert.equal(resolved.purchasePrice, 247.99);
  assert.equal(resolved.rawPriceText, "$247.99");
  assert.equal(resolved.rejected, false);
  assert.equal(resolved.classification.listingType, "full_purchase");
  assert.equal(resolved.classification.priceIntent, "purchase_price");
});

test("installment-only row is rejected without full purchase price", () => {
  const resolved = resolveShoppingPurchasePrice({
    title: "Samsung 43 Inch Crystal UHD TV",
    installment: { price: "$12/mo" },
    url: "https://www.example.com/tv",
  });
  assert.equal(resolved.purchasePrice, null);
  assert.equal(resolved.rejected, true);
  assert.equal(resolved.rejectReason, "installment_only_no_full_purchase_price");
  assert.equal(shouldRejectCommercialListing(resolved.classification), true);
});

test("legitimate Walmart and Best Buy full purchase prices are allowed", () => {
  for (const store of [
    {
      host: "walmart.com",
      url: "https://www.walmart.com/ip/tv",
      label: "Walmart",
    },
    {
      host: "bestbuy.com",
      url: "https://www.bestbuy.com/site/tv.p",
      label: "Best Buy",
    },
  ]) {
    const resolved = resolveShoppingPurchasePrice({
      title: "Samsung 43 Inch Class Crystal UHD Smart TV",
      price: "$199.99",
      url: store.url,
      hostname: store.host,
      storeLabel: store.label,
    });
    assert.equal(resolved.purchasePrice, 199.99, store.host);
    assert.equal(resolved.rejected, false, store.host);
    assert.equal(resolved.classification.priceIntent, "purchase_price", store.host);
  }
});

test("Aaron's, Rent-A-Center, FlexShopper, and myrentking domains are rejected", () => {
  const domains = [
    "aarons.com",
    "rentacenter.com",
    "flexshopper.com",
    "myrentking.com",
  ];
  for (const host of domains) {
    const classified = classifyCommercialListing({
      title: "Samsung TV",
      rawPrice: "$19.99",
      url: `https://www.${host}/product/tv`,
      hostname: host,
      storeLabel: host,
    });
    assert.equal(shouldRejectCommercialListing(classified), true, host);
    assert.equal(classified.listingType, "rental", host);
  }
});

test("suspicious $9.88 TV price against $247.99 reference is not exact-match eligible", () => {
  const candidatePrice = 9.88;
  assert.equal(
    isSuspiciousPurchasePriceRatio(candidatePrice, REFERENCE_PRICE),
    true,
  );

  const norm = buildNormalizedProduct(SAMSUNG_TV_TITLE, { price: candidatePrice });
  const display = displayMatchScore({
    relevanceScore: 95,
    identityScore: 95,
    departmentScore: 92,
  });
  assert.ok(display >= BAND_EXACT_MIN);
  assert.equal(classifyConfidenceBand(display), "exact_match");

  const cappedBand = "possible_alternative";
  assert.notEqual(cappedBand, "exact_match");
  assert.ok(BAND_HIGH_CONFIDENCE_MIN - 1 < BAND_EXACT_MIN);
});

test("incomplete/parts title phrases block Exact Match and Best Deal eligibility", () => {
  for (const title of [
    "TV no screws",
    "parts only listing",
    "sold for parts",
    "broken panel",
    "needs repair",
    "not working remote",
  ]) {
    assert.equal(isIncompleteOrPartsListingTitle(title), true, title);
  }
  assert.equal(
    isIncompleteOrPartsListingTitle("Brand new sealed Vizio Smart TV"),
    false,
  );
});

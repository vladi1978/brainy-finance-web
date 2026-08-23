import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNormalizedProduct } from "./normalize";
import { buildAmazonUrlFallbackTitle } from "./providers/amazon.provider";
import { buildMinimalTitleForCanonicalUrl } from "./productDescriptionFromUrl";
import {
  hasManualSearchableIdentity,
  isWeakSourceIdentityForCompare,
  WEAK_SOURCE_IDENTITY_MESSAGE,
} from "./sourceIdentityGuard";
import { withCriticalAttributes } from "./criticalAttributes";
import {
  isAsinPlaceholderTitle,
  isBlockedAsinSearchQuery,
  isUsablePdpTitle,
} from "./usablePdpTitle";

const BARE_ASIN_URL = "https://www.amazon.com/dp/B0H1T8NQGM";
const SLUG_ASIN_URL =
  "https://www.amazon.com/Samsung-55-Inch-Crystal-UHD-Smart-TV/dp/B0H1T8NQGM";

test("isAsinPlaceholderTitle rejects ASIN-only patterns", () => {
  assert.equal(isAsinPlaceholderTitle("ASIN B0H1T8NQGM"), true);
  assert.equal(isAsinPlaceholderTitle("Amazon B0H1T8NQGM"), true);
  assert.equal(isAsinPlaceholderTitle("B0H1T8NQGM"), true);
  assert.equal(isAsinPlaceholderTitle("amazon product"), true);
});

test("isAsinPlaceholderTitle accepts slug plus ASIN suffix", () => {
  assert.equal(
    isAsinPlaceholderTitle("Samsung 55 Inch Crystal UHD Smart TV — ASIN B0H1T8NQGM"),
    false
  );
});

test("isUsablePdpTitle rejects ASIN-only titles", () => {
  assert.equal(isUsablePdpTitle("ASIN B0H1T8NQGM"), false);
  assert.equal(isUsablePdpTitle("Amazon B0H1T8NQGM"), false);
  assert.equal(isUsablePdpTitle("B0H1T8NQGM"), false);
});

test("isUsablePdpTitle accepts real product titles", () => {
  assert.equal(
    isUsablePdpTitle("Samsung 55 Inch Crystal UHD TU690T Smart TV"),
    true
  );
  assert.equal(
    isUsablePdpTitle("Samsung 55 Inch Crystal UHD Smart TV — ASIN B0H1T8NQGM"),
    true
  );
});

test("isBlockedAsinSearchQuery blocks ASIN placeholder queries", () => {
  assert.equal(isBlockedAsinSearchQuery("ASIN B0H1T8NQGM"), true);
  assert.equal(isBlockedAsinSearchQuery("Amazon B0H1T8NQGM"), true);
  assert.equal(isBlockedAsinSearchQuery("B0H1T8NQGM"), true);
  assert.equal(isBlockedAsinSearchQuery("Samsung 55 inch tv"), false);
});

test("buildMinimalTitleForCanonicalUrl does not emit Amazon ASIN placeholder", () => {
  const title = buildMinimalTitleForCanonicalUrl(BARE_ASIN_URL);
  assert.notEqual(title, "Amazon B0H1T8NQGM");
  assert.equal(isAsinPlaceholderTitle(title), false);
});

test("isWeakSourceIdentityForCompare blocks ASIN-only source identity", () => {
  const norm = withCriticalAttributes(
    "ASIN B0H1T8NQGM",
    buildNormalizedProduct("ASIN B0H1T8NQGM")
  );
  assert.equal(isWeakSourceIdentityForCompare("ASIN B0H1T8NQGM", norm), true);
});

test("isWeakSourceIdentityForCompare allows categorized product titles", () => {
  const title = "Samsung 55 Inch Crystal UHD TU690T Smart TV";
  const norm = withCriticalAttributes(title, buildNormalizedProduct(title));
  assert.equal(norm.category, "tv");
  assert.equal(isWeakSourceIdentityForCompare(title, norm), false);
});

test("hasManualSearchableIdentity allows manual compare to proceed", () => {
  assert.equal(
    hasManualSearchableIdentity(true, {
      brand: "Sony",
      productNameOrModel: "WH-1000XM5",
    }),
    true
  );
  assert.equal(
    isWeakSourceIdentityForCompare(
      "Sony WH-1000XM5",
      withCriticalAttributes(
        "Sony WH-1000XM5",
        buildNormalizedProduct("Sony WH-1000XM5")
      )
    ),
    false
  );
});

test("weak source identity message is user-facing", () => {
  assert.match(WEAK_SOURCE_IDENTITY_MESSAGE, /could not identify the original product/i);
});

test("bare Amazon /dp/ASIN fallback is not a usable product title", () => {
  const fallback = buildAmazonUrlFallbackTitle(BARE_ASIN_URL, "");
  assert.equal(fallback, "ASIN B0H1T8NQGM");
  assert.equal(isAsinPlaceholderTitle(fallback), true);
  assert.equal(isUsablePdpTitle(fallback), false);
});

test("Amazon slug URL fallback remains a usable product title when scrape fails", () => {
  const slugLine = "Samsung 55 Inch Crystal UHD Smart TV";
  const fallback = buildAmazonUrlFallbackTitle(SLUG_ASIN_URL, slugLine);
  assert.match(fallback, /Samsung/i);
  assert.notEqual(fallback, "ASIN B0H1T8NQGM");
  assert.equal(isAsinPlaceholderTitle(fallback), false);
  assert.equal(isUsablePdpTitle(fallback), true);
  const norm = buildNormalizedProduct(fallback);
  assert.equal(norm.category, "tv");
});

test("ASIN-only source identity blocks compare search path", () => {
  const norm = withCriticalAttributes(
    "ASIN B0H1T8NQGM",
    buildNormalizedProduct("ASIN B0H1T8NQGM")
  );
  assert.equal(
    isWeakSourceIdentityForCompare("ASIN B0H1T8NQGM", norm),
    true,
    "compare must not run with ASIN-only reference"
  );
  assert.equal(isBlockedAsinSearchQuery("ASIN B0H1T8NQGM"), true);
});

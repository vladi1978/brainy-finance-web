import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNormalizedProduct } from "./normalize";
import {
  isWeakSourceIdentityForCompare,
} from "./sourceIdentityGuard";
import {
  pickConsistentRecoveredTitle,
  recoveryRejectionReason,
  shouldAttemptSourceRecovery,
  tokenOverlapRatio,
} from "./sourceProductRecovery";
import { isAsinPlaceholderTitle, isUsablePdpTitle } from "./usablePdpTitle";
import { withCriticalAttributes } from "./criticalAttributes";

const TV_TITLE = "Samsung 55 Inch Crystal UHD TU690T Smart TV";
const TV_TITLE_ALT = "Samsung 55-Inch Crystal UHD 4K Smart TV TU690T";

test("tokenOverlapRatio detects similar product titles", () => {
  assert.ok(tokenOverlapRatio(TV_TITLE, TV_TITLE_ALT) >= 0.45);
  assert.ok(tokenOverlapRatio(TV_TITLE, "Apple MacBook Pro 14") < 0.45);
});

test("pickConsistentRecoveredTitle accepts Amazon ASIN listing match", () => {
  const picked = pickConsistentRecoveredTitle([
    { title: TV_TITLE, path: "asin_amazon", weight: 3 },
  ]);
  assert.ok(picked);
  assert.equal(picked!.path, "asin_amazon");
  assert.equal(picked!.title, TV_TITLE);
});

test("pickConsistentRecoveredTitle requires cross-store agreement for single weak path", () => {
  const lone = pickConsistentRecoveredTitle([
    { title: "Generic product item", path: "walmart", weight: 1 },
  ]);
  assert.equal(lone, null);

  const agreed = pickConsistentRecoveredTitle([
    { title: TV_TITLE, path: "walmart", weight: 1 },
    { title: TV_TITLE_ALT, path: "bestbuy", weight: 1 },
    { title: "Unrelated vacuum cleaner", path: "ebay", weight: 1 },
  ]);
  assert.ok(agreed);
  assert.match(agreed!.title, /Samsung/i);
  assert.ok(agreed!.pathsAgreed.length >= 2);
});

test("pickConsistentRecoveredTitle rejects ASIN placeholder candidates", () => {
  const onlyPlaceholder = pickConsistentRecoveredTitle([
    { title: "ASIN B0H1T8NQGM", path: "asin_amazon", weight: 3 },
  ]);
  assert.equal(onlyPlaceholder, null);

  const mixed = pickConsistentRecoveredTitle([
    { title: "ASIN B0H1T8NQGM", path: "asin_amazon", weight: 3 },
    { title: TV_TITLE, path: "walmart", weight: 1 },
    { title: TV_TITLE_ALT, path: "bestbuy", weight: 1 },
  ]);
  assert.ok(mixed);
  assert.equal(isAsinPlaceholderTitle(mixed!.title), false);
  assert.notEqual(mixed!.title, "ASIN B0H1T8NQGM");
});

test("pickConsistentRecoveredTitle accepts descriptive URL slug alone", () => {
  const slugTitle = "Samsung 55 Inch Crystal UHD Smart TV";
  const picked = pickConsistentRecoveredTitle([
    { title: slugTitle, path: "url_slug", weight: 2 },
  ]);
  assert.ok(picked);
  assert.equal(picked!.path, "url_slug");
  assert.equal(isUsablePdpTitle(picked!.title), true);
});

test("pickConsistentRecoveredTitle accepts trusted singleton google_shopping match", () => {
  const picked = pickConsistentRecoveredTitle([
    { title: TV_TITLE, path: "google_shopping", weight: 2 },
  ]);
  assert.ok(picked);
  assert.equal(picked!.path, "google_shopping");
});

test("pickConsistentRecoveredTitle accepts trusted singleton page_metadata match", () => {
  const picked = pickConsistentRecoveredTitle([
    { title: TV_TITLE, path: "page_metadata", weight: 2.5 },
  ]);
  assert.ok(picked);
  assert.equal(picked!.path, "page_metadata");
});

test("recoveryRejectionReason flags ASIN placeholder titles", () => {
  assert.equal(recoveryRejectionReason("ASIN B0H1T8NQGM"), "asin_placeholder");
  assert.equal(recoveryRejectionReason(TV_TITLE), null);
});

test("shouldAttemptSourceRecovery triggers for weak Amazon identity", () => {
  const norm = withCriticalAttributes(
    "ASIN B0H1T8NQGM",
    buildNormalizedProduct("ASIN B0H1T8NQGM")
  );
  assert.equal(
    shouldAttemptSourceRecovery({
      manualSearchableIdentity: false,
      demoMode: false,
      canonicalProductUrl: "https://www.amazon.com/dp/B0H1T8NQGM",
      scrapedOk: false,
      referenceProductQuery: "ASIN B0H1T8NQGM",
      referenceNormalized: norm,
    }),
    true
  );
});

test("shouldAttemptSourceRecovery skips when manual identity is present", () => {
  const norm = buildNormalizedProduct("Sony WH-1000XM5");
  assert.equal(
    shouldAttemptSourceRecovery({
      manualSearchableIdentity: true,
      demoMode: false,
      canonicalProductUrl: "https://www.amazon.com/dp/B0H1T8NQGM",
      scrapedOk: false,
      referenceProductQuery: "Sony WH-1000XM5",
      referenceNormalized: norm,
    }),
    false
  );
});

test("shouldAttemptSourceRecovery skips when PDP identity is already strong", () => {
  const norm = withCriticalAttributes(TV_TITLE, buildNormalizedProduct(TV_TITLE));
  assert.equal(isWeakSourceIdentityForCompare(TV_TITLE, norm), false);
  assert.equal(
    shouldAttemptSourceRecovery({
      manualSearchableIdentity: false,
      demoMode: false,
      canonicalProductUrl:
        "https://www.amazon.com/Samsung-55-Inch-Crystal-UHD-Smart-TV/dp/B0H1T8NQGM",
      scrapedOk: true,
      referenceProductQuery: TV_TITLE,
      referenceNormalized: norm,
    }),
    false
  );
});

test("ASIN placeholder titles never pass recovery candidate acceptance", () => {
  assert.equal(
    pickConsistentRecoveredTitle([
      { title: "ASIN B0H1T8NQGM", path: "asin_amazon", weight: 3 },
    ]),
    null
  );
  assert.equal(
    pickConsistentRecoveredTitle([
      { title: "Amazon B0H1T8NQGM", path: "retailer_search", weight: 1 },
      { title: "B0H1T8NQGM", path: "ebay", weight: 1 },
    ]),
    null
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { findRecommendationReviewTarget } from "./recommendationNavigation";

const cards = [
  { clusterId: "sub-peacock", normalizedName: "Peacock" },
  { clusterId: "sub-netflix", normalizedName: "Netflix.com" },
];

test("finds the statement card named by a recommendation", () => {
  assert.equal(
    findRecommendationReviewTarget("PEACOCK", cards)?.clusterId,
    "sub-peacock"
  );
});

test("normalizes punctuation and supports a merchant list", () => {
  assert.equal(
    findRecommendationReviewTarget("Hulu, Netflix com", cards)?.clusterId,
    "sub-netflix"
  );
});

test("falls back to the first subscription card when no merchant is supplied", () => {
  assert.equal(
    findRecommendationReviewTarget(undefined, cards)?.clusterId,
    "sub-peacock"
  );
});

test("does not navigate to an unrelated card", () => {
  assert.equal(findRecommendationReviewTarget("Hulu", cards), undefined);
});

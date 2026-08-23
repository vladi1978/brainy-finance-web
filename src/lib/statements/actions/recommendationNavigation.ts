type ReviewTarget = {
  clusterId: string;
  normalizedName: string;
};

function merchantKey(value: string): string {
  return value.trim().toLocaleUpperCase("en-US").replace(/[^A-Z0-9]+/gu, " ").trim();
}

export function findRecommendationReviewTarget(
  merchantReference: string | undefined,
  cards: ReviewTarget[]
): ReviewTarget | undefined {
  const requested = (merchantReference ?? "")
    .split(",")
    .map(merchantKey)
    .filter(Boolean);

  if (requested.length === 0) return cards[0];

  return cards.find((card) => requested.includes(merchantKey(card.normalizedName)));
}

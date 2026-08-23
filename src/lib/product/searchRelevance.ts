import { tokenizeSignificant } from "./normalize";
import type { SearchMatchType } from "./types";

export type QueryRelevanceResult = {
  /** 0–1 how well the listing matches the search query */
  confidence: number;
  matchType: SearchMatchType;
  /** 0–100 for display */
  relevanceScore: number;
  reasons: string[];
};

/**
 * Search-result relevance only (query ↔ listing title).
 * Not structural “same SKU” matching — that path is deprecated for the MVP.
 */
export function scoreQueryRelevance(
  searchQuery: string,
  candidateTitle: string
): QueryRelevanceResult {
  const qTokens = tokenizeSignificant(searchQuery);
  const tTokens = tokenizeSignificant(candidateTitle);
  const qSet = new Set(qTokens);
  const tSet = new Set(tTokens);

  if (qSet.size === 0) {
    return {
      confidence: 0.25,
      matchType: "low",
      relevanceScore: 25,
      reasons: ["empty_query_tokens"],
    };
  }

  let inter = 0;
  for (const x of qSet) {
    if (tSet.has(x)) inter += 1;
  }

  const union = qSet.size + tSet.size - inter;
  const jaccard = union > 0 ? inter / union : 0;
  const recall = inter / qSet.size;
  const blended = jaccard * 0.45 + recall * 0.55;
  const confidence = Math.min(1, Math.max(0, blended * 1.05));
  const relevanceScore = Math.round(confidence * 100);

  let matchType: SearchMatchType;
  if (confidence >= 0.52) matchType = "high";
  else if (confidence >= 0.28) matchType = "medium";
  else matchType = "low";

  const reasons: string[] = [
    `token_overlap=${inter}/${qSet.size}`,
    `jaccard=${jaccard.toFixed(2)}`,
    `recall=${recall.toFixed(2)}`,
  ];

  return { confidence, matchType, relevanceScore, reasons };
}

export function rankMatchTypes(a: SearchMatchType, b: SearchMatchType): number {
  const order: Record<SearchMatchType, number> = {
    high: 0,
    equivalent: 1,
    similar_product: 2,
    medium: 3,
    low: 4,
  };
  return order[a] - order[b];
}

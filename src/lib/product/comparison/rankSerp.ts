import { normalizeText } from "../normalization";
import type { ProductSearchResult } from "../providers/search-result";

/** Word overlap between normalized query and result title (legacy pre-filter). */
export function scoreSerpRelevance(
  query: string,
  result: ProductSearchResult
): number {
  const q = normalizeText(query);
  const r = normalizeText(result.title);

  let score = 0;

  for (const word of q.split(" ")) {
    if (word.length >= 3 && r.includes(word)) {
      score += 1;
    }
  }

  return score;
}

/**
 * Deduplicate repeated brand/model/filler tokens in retailer search queries.
 * Prevents malformed phrases like "52 embassy by doughboy round embassy century by".
 */

const REPEATED_FILLER = new Set([
  "a",
  "an",
  "and",
  "by",
  "for",
  "from",
  "in",
  "of",
  "the",
  "to",
  "with",
]);

function normalizeTokenKey(tok: string): string {
  return tok.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Remove consecutive and non-consecutive duplicate tokens (case-insensitive).
 * Repeated filler words ("by", "the") are kept at most once.
 */
export function dedupeRepeatedSearchTokens(query: string): string {
  const raw = query.replace(/\s+/g, " ").trim();
  if (!raw) return "";

  const words = raw.split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  const seenFillers = new Set<string>();

  for (const word of words) {
    const key = normalizeTokenKey(word);
    if (!key) continue;

    if (REPEATED_FILLER.has(key)) {
      if (seenFillers.has(key)) continue;
      seenFillers.add(key);
      out.push(word);
      continue;
    }

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }

  return out.join(" ").replace(/\s+/g, " ").trim();
}

/** Final pass for assembled shopping queries (segments + core + brand). */
export function cleanRetailerSearchQuery(query: string): string {
  return dedupeRepeatedSearchTokens(query.replace(/\s+/g, " ").trim());
}

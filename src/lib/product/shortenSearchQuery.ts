/**
 * Universal retailer search query shortener: removes low-signal filler words,
 * keeps dimensions, sizes, capacities, and product-type tokens, then truncates
 * at a word boundary.
 */

const FILLER_WORDS = new Set([
  "a",
  "an",
  "and",
  "classic",
  "for",
  "in",
  "kit",
  "model",
  "of",
  "package",
  "series",
  "the",
  "to",
  "with",
]);

const FILLER_PHRASES: RegExp[] = [/\bmade\s+in\s+north\s+america\b/gi];

/** Max fraction of `max` below which we avoid an overly aggressive word cut. */
const WORD_TRUNC_MIN_FRACTION = 0.45;

export function truncateAtWordBoundary(text: string, maxChars: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (maxChars <= 0) return "";
  if (t.length <= maxChars) return t;
  const slice = t.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace >= Math.floor(maxChars * WORD_TRUNC_MIN_FRACTION)) {
    return slice.slice(0, lastSpace).trim();
  }
  return slice.trim();
}

function stripEdgePunct(tok: string): string {
  return tok.replace(/^[^a-z0-9%]+|[^a-z0-9%]+$/gi, "");
}

/**
 * Shorten a product title into a compact, high-signal retailer search query.
 * @param maxChars — max decoded query length before URL encoding (default 60; Best Buy uses 50 at call sites).
 */
export function shortenSearchQuery(title: string, maxChars = 60): string {
  let s = title.replace(/\s+/g, " ").trim();
  if (!s) return "";

  for (const re of FILLER_PHRASES) {
    s = s.replace(re, " ");
  }

  s = s.replace(/\bw\/\b/gi, " ");

  s = s.replace(/\s+/g, " ").trim();

  const rawTokens = s.split(/\s+/).filter(Boolean);
  const digitToks: string[] = [];
  const otherToks: string[] = [];

  for (const raw of rawTokens) {
    const tok = stripEdgePunct(raw);
    if (!tok) continue;
    const lower = tok.toLowerCase();
    if (/\d/.test(tok)) {
      digitToks.push(lower);
      continue;
    }
    if (FILLER_WORDS.has(lower)) continue;
    otherToks.push(lower);
  }

  let joined = [...digitToks, ...otherToks].join(" ").replace(/\s+/g, " ").trim();

  if (joined.length < 2) {
    joined = s
      .toLowerCase()
      .replace(/[^a-z0-9\s.x/%-]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return truncateAtWordBoundary(joined, maxChars);
}

import type { NormalizedProduct, ProductCategory } from "./types";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "your",
  "new",
  "pack",
  "set",
  "each",
  "per",
  "inch",
  "inches",
  "size",
]);

/** Known consumer brands — extend as needed. */
const BRAND_PATTERN =
  /\b(samsung|lg|sony|tcl|hisense|vizio|insignia|onn|apple|google|beats|bose|jbl|sonos|anker|nike|adidas|reebok|puma|new balance|asics|crocs|ugg|microsoft|dell|hp|lenovo|asus|acer|msi)\b/i;

/**
 * Lowercase, strip punctuation noise, collapse whitespace (search / matching).
 */
export function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeSignificant(text: string): string[] {
  const n = normalizeTitle(text);
  return n
    .split(/\s+/)
    .map((w) => w.replace(/-/g, ""))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export function extractBrand(title: string): string | null {
  const m = title.match(BRAND_PATTERN);
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Model-like tokens: SKU fragments, alnum codes (e.g. QN65, XR-55X90K, air-max-270).
 */
export function extractModelTokens(title: string): string[] {
  const norm = normalizeTitle(title);
  const out = new Set<string>();

  for (const m of norm.matchAll(/\b[a-z]{0,3}\d{2,5}[a-z0-9-]*\b/gi)) {
    const t = m[0]!.replace(/-/g, "").toLowerCase();
    if (t.length >= 4) out.add(t);
  }
  for (const m of norm.matchAll(/\b(qn|un|qn|xr|oled|qled|u\d|serie)\w*\d{2,4}\w*\b/gi)) {
    out.add(m[0]!.replace(/\s+/g, "").toLowerCase());
  }
  return [...out].slice(0, 12);
}

/**
 * TV / monitor diagonal in inches when clearly stated.
 */
export function extractSizeInches(title: string): number | null {
  const norm = title.replace(/\u2033/g, '"'); // unicode double prime

  const m1 = norm.match(/\b(\d{2,3})\s*(?:\"|''|′′|inches?\b|inch\b|-inch)\b/i);
  if (m1) {
    const n = parseInt(m1[1]!, 10);
    if (n >= 20 && n <= 120) return n;
  }

  const m2 = norm.match(/\b(\d{2,3})\s*inch\b/i);
  if (m2) {
    const n = parseInt(m2[1]!, 10);
    if (n >= 20 && n <= 120) return n;
  }

  return null;
}

export function extractCategory(title: string): ProductCategory {
  const n = normalizeTitle(title);
  if (
    /\b(smart tv|oled|qled|4k tv|8k tv|uhd tv|television|tv)\b/.test(n) ||
    (/\btv\b/.test(n) && extractSizeInches(title) != null)
  ) {
    return "tv";
  }
  if (/\b(shoe|sneaker|boot|sandal|cleat|air max|yeezy)\b/.test(n)) {
    return "footwear";
  }
  if (/\b(headphone|earbud|speaker|soundbar|subwoofer)\b/.test(n)) {
    return "audio";
  }
  return "general";
}

/**
 * Pack / count when relevant (multipacks, grocery).
 */
export function extractPackCount(title: string): number | null {
  const n = normalizeTitle(title);

  const p1 = n.match(/\b(\d{1,3})\s*(?:pack|pk|ct|count)\b/);
  if (p1) return parseInt(p1[1]!, 10);

  const p2 = n.match(/\bpack of (\d{1,3})\b/);
  if (p2) return parseInt(p2[1]!, 10);

  const p3 = n.match(/\b(\d{1,3})\s*x\s*(?:count|ct)\b/);
  if (p3) return parseInt(p3[1]!, 10);

  return null;
}

export function buildNormalizedProduct(title: string): NormalizedProduct {
  const titleNorm = normalizeTitle(title);
  return {
    titleNorm,
    brand: extractBrand(title),
    modelTokens: extractModelTokens(title),
    sizeInches: extractSizeInches(title),
    category: extractCategory(title),
    packCount: extractPackCount(title),
  };
}

/**
 * Compact, high-signal query for retailer search.
 */
export function extractSearchQuery(input: string): string {
  const cleaned = normalizeTitle(input);

  const brandMatch = cleaned.match(BRAND_PATTERN);
  const modelMatch = cleaned.match(
    /\b(qn\d{2,4}[a-z0-9]*|xr[\w-]*|oled|qled|neo qled|air max|u\d{3,4}[a-z]?)\b/i
  );
  const sizeMatch = cleaned.match(/\b\d{2,3}(?:\s*-\s*)?(?:inch|inches|")\b/i);
  const typeMatch = cleaned.match(
    /\b(tv|smart tv|shoes|socks|speaker|headphones|laptop)\b/i
  );

  const parts = [
    brandMatch?.[0],
    modelMatch?.[0],
    sizeMatch?.[0]?.replace(/-/g, " "),
    typeMatch?.[0],
  ].filter(Boolean);

  if (parts.length >= 2) {
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  return cleaned;
}

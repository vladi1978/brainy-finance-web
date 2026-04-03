import { providerRegistry } from "./registry";
import type { ExtractedSourceProduct } from "./providers/base";
import type { ProductSearchResult } from "./providers/search-result";

export type CompareProductResponse = {
  sourceProduct: ExtractedSourceProduct | null;
  bestDeal: ProductSearchResult | null;
  alternatives: ProductSearchResult[];
  /** Present when no comparable cross-store match is available */
  comparisonMessage?: string | null;
};

const MATCH_THRESHOLD = 72;

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "your",
  "our",
  "are",
  "was",
  "has",
  "have",
  "new",
  "set",
  "pack",
  "packs",
  "pair",
  "pairs",
  "count",
  "size",
  "inch",
  "oz",
  "ml",
  "lb",
  "ct",
  "pk",
  "pcs",
  "piece",
  "pieces",
  "of",
  "x",
  "a",
  "an",
  "to",
  "in",
  "on",
  "at",
  "by",
  "or",
  "as",
  "per",
  "up",
  "off",
  "free",
  "shipping",
  "amazon",
  "walmart",
  "target",
  "temu",
  "basics",
  "brand",
]);

const GENDER_WOMEN = new Set([
  "women",
  "womens",
  "woman",
  "female",
  "ladies",
  "lady",
  "girls",
  "girl",
]);

const GENDER_MEN = new Set([
  "men",
  "mens",
  "man",
  "male",
  "boys",
  "boy",
]);

const GENDER_KIDS = new Set([
  "kids",
  "kid",
  "toddler",
  "toddlers",
  "infant",
  "infants",
  "youth",
  "child",
  "children",
]);

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ProductSignals = {
  brandNorm: string | null;
  packCount: number | null;
  gender: "women" | "men" | "kids" | "unisex" | null;
  keywords: string[];
};

function tokenizeSignificant(text: string): string[] {
  const n = normalizeText(text);
  return n
    .split(/\s+/)
    .map((w) => w.replace(/-/g, ""))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function extractPackCount(text: string): number | null {
  const n = normalizeText(text);
  const patterns: RegExp[] = [
    /\b(\d+)\s*(?:pairs?|pair)\b/i,
    /\b(\d+)\s*(?:pack|packs|pk|count|ct|pcs?|pieces?)\b/i,
    /\bpack\s+of\s+(\d+)\b/i,
    /\b(\d+)\s*[-]\s*(?:pack|pair|pairs|count)\b/i,
    /\b(\d+)\s*x\s*/i,
  ];
  for (const re of patterns) {
    const m = n.match(re);
    if (m?.[1]) {
      const v = parseInt(m[1], 10);
      if (Number.isFinite(v) && v > 0 && v < 10000) return v;
    }
  }
  return null;
}

function extractGenderBucket(text: string): ProductSignals["gender"] {
  const n = normalizeText(text);
  const tokens = n.split(/\s+/);
  for (const t of tokens) {
    if (GENDER_WOMEN.has(t)) return "women";
  }
  for (const t of tokens) {
    if (GENDER_MEN.has(t)) return "men";
  }
  for (const t of tokens) {
    if (GENDER_KIDS.has(t)) return "kids";
  }
  if (/\bunisex\b/i.test(n)) return "unisex";
  return null;
}

const LEADING_SKIP_BRAND = new Set([
  "the",
  "new",
  "pack",
  "set",
  "bundle",
]);

function extractBrandGuess(title: string, explicit?: string | null): string | null {
  if (explicit?.trim()) {
    return normalizeText(explicit).replace(/\s+/g, " ").trim() || null;
  }
  const n = normalizeText(title);
  const tokens = n.split(/\s+/);
  for (const raw of tokens) {
    const t = raw.replace(/-/g, "");
    if (t.length < 2) continue;
    if (/^\d+$/.test(t)) continue;
    if (LEADING_SKIP_BRAND.has(t)) continue;
    if (GENDER_WOMEN.has(t) || GENDER_MEN.has(t) || GENDER_KIDS.has(t))
      continue;
    if (t === "unisex") continue;
    return t;
  }
  return null;
}

function buildProductSignals(
  title: string,
  explicitBrand?: string | null
): ProductSignals {
  const brandNorm = extractBrandGuess(title, explicitBrand);
  const packCount = extractPackCount(title);
  const gender = extractGenderBucket(title);
  const keywords = tokenizeSignificant(title);
  return { brandNorm, packCount, gender, keywords };
}

function jaccardKeywords(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) {
    if (B.has(x)) inter += 1;
  }
  const union = A.size + B.size - inter;
  return union > 0 ? inter / union : 0;
}

function brandsCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4) {
    if (a.includes(b) || b.includes(a)) return true;
  }
  return false;
}

/**
 * Match score 0–100. Higher is a stronger same-product match.
 */
export function scoreProductMatch(
  source: ProductSignals,
  candidateTitle: string,
  candidateBrand: string | null | undefined
): number {
  const candSignals = buildProductSignals(candidateTitle, candidateBrand);

  let score = 0;

  const kwSim = jaccardKeywords(source.keywords, candSignals.keywords);
  score += kwSim * 48;

  const srcBrand = source.brandNorm;
  const candBrand = candSignals.brandNorm;

  if (srcBrand && candBrand) {
    if (brandsCompatible(srcBrand, candBrand)) {
      score += 28;
    } else {
      score -= 62;
    }
  } else {
    score -= 4;
  }

  if (source.packCount != null && candSignals.packCount != null) {
    if (source.packCount === candSignals.packCount) {
      score += 20;
    } else {
      score -= 52;
    }
  } else {
    score -= 5;
  }

  if (source.gender && candSignals.gender) {
    if (source.gender === candSignals.gender) {
      score += 6;
    } else if (
      (source.gender === "women" && candSignals.gender === "men") ||
      (source.gender === "men" && candSignals.gender === "women")
    ) {
      score -= 42;
    } else {
      score -= 22;
    }
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function extractImportantQuery(input: string): string {
  const cleaned = normalizeText(input);

  const brandMatch = cleaned.match(
    /\b(samsung|lg|sony|hisense|tcl|nike|adidas|apple|beats)\b/i
  );
  const modelMatch = cleaned.match(
    /\b(qn\d{2,4}[a-z0-9]*|oled|neo qled|air max|u8000f|u6|u7|u8)\b/i
  );
  const sizeMatch = cleaned.match(/\b\d{2,3}(-|\s)?inch\b/i);
  const typeMatch = cleaned.match(
    /\b(tv|smart tv|shoes|socks|speaker|headphones)\b/i
  );

  const parts = [
    brandMatch?.[0],
    modelMatch?.[0],
    sizeMatch?.[0]?.replace("-", " "),
    typeMatch?.[0],
  ].filter(Boolean);

  if (parts.length >= 2) {
    return parts.join(" ");
  }

  return cleaned;
}

function scoreResult(query: string, result: ProductSearchResult): number {
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

function isValidComparablePrice(price: number | null | undefined): boolean {
  return price != null && Number.isFinite(price) && price > 0;
}

function dedupeByStoreAndUrl(
  items: ProductSearchResult[]
): ProductSearchResult[] {
  const map = new Map<string, ProductSearchResult>();
  for (const item of items) {
    const key = `${item.store}|${item.productUrl.split("?")[0].toLowerCase()}`;
    const prev = map.get(key);
    if (
      !prev ||
      (item.price ?? Number.POSITIVE_INFINITY) <
        (prev.price ?? Number.POSITIVE_INFINITY)
    ) {
      map.set(key, item);
    }
  }
  return [...map.values()];
}

function normalizeUrlKey(url: string): string {
  try {
    return url.split("?")[0].toLowerCase().trim();
  } catch {
    return url.toLowerCase().trim();
  }
}

function withMatchConfidence(
  r: ProductSearchResult,
  confidence: number
): ProductSearchResult {
  const c = Math.max(0, Math.min(1, confidence));
  return { ...r, matchConfidence: c };
}

export async function compareProduct(
  rawInput: string
): Promise<CompareProductResponse> {
  const input = rawInput.trim();

  if (!input) {
    throw new Error("Missing product input");
  }

  const sourceProvider =
    providerRegistry.find((provider) => provider.canHandleUrl(input)) ?? null;

  let sourceProduct: ExtractedSourceProduct | null = null;
  let detectedStore: string | null = null;
  let searchBase = input;

  if (sourceProvider) {
    detectedStore = sourceProvider.store;

    if (sourceProvider.extractFromUrl) {
      sourceProduct = await sourceProvider.extractFromUrl(input);
    }

    if (sourceProduct?.title) {
      searchBase = sourceProduct.title;
    }
  }

  const searchQuery = extractImportantQuery(searchBase);

  const nestedResults = await Promise.all(
    providerRegistry.map((provider) =>
      provider.searchByQuery({
        raw: input,
        normalizedQuery: searchQuery,
        sourceProduct,
      })
    )
  );

  const flattened = nestedResults.flat();

  const ranked = flattened
    .map((result) => ({
      result,
      score: scoreResult(searchQuery, result),
    }))
    .filter(
      (item) =>
        item.score >= 1 ||
        item.result.store === detectedStore ||
        isValidComparablePrice(item.result.price)
    )
    .sort((a, b) => {
      const ap = a.result.price ?? Number.MAX_SAFE_INTEGER;
      const bp = b.result.price ?? Number.MAX_SAFE_INTEGER;
      if (ap !== bp) return ap - bp;
      return b.score - a.score;
    })
    .map((item) => item.result);

  const sourceTitle =
    sourceProduct?.title?.trim() || searchBase.trim() || input;
  const sourceSignals = buildProductSignals(
    sourceTitle,
    sourceProduct?.brand
  );

  const sourceUrlKey = sourceProduct?.sourceUrl
    ? normalizeUrlKey(sourceProduct.sourceUrl)
    : null;

  const sourceStore = sourceProduct?.store;
  const excludeSourceStore = Boolean(
    sourceStore && sourceStore !== "unknown"
  );

  const deduped = dedupeByStoreAndUrl(ranked.filter((r) =>
    isValidComparablePrice(r.price)
  ));

  const scored: { result: ProductSearchResult; matchScore: number }[] = [];
  for (const r of deduped) {
    if (sourceUrlKey && normalizeUrlKey(r.productUrl) === sourceUrlKey) {
      continue;
    }
    if (excludeSourceStore && r.store === sourceStore) {
      continue;
    }
    const matchScore = scoreProductMatch(
      sourceSignals,
      r.title,
      r.brand ?? null
    );
    scored.push({ result: r, matchScore });
  }

  const passing = scored
    .filter((x) => x.matchScore >= MATCH_THRESHOLD)
    .sort(
      (a, b) =>
        (a.result.price ?? Number.POSITIVE_INFINITY) -
        (b.result.price ?? Number.POSITIVE_INFINITY)
    );

  if (passing.length === 0) {
    return {
      sourceProduct,
      bestDeal: null,
      alternatives: [],
      comparisonMessage: "No comparable match found yet",
    };
  }

  const winner = passing[0]!;
  const rest = passing.slice(1);

  const bestDeal = withMatchConfidence(
    winner.result,
    winner.matchScore / 100
  );

  const alternatives = rest.map((x) =>
    withMatchConfidence(x.result, x.matchScore / 100)
  );

  return {
    sourceProduct,
    bestDeal,
    alternatives,
    comparisonMessage: null,
  };
}

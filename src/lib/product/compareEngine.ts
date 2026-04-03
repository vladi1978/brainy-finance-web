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

export type MatchType = "exact" | "strong" | "weak" | "none";

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

export type TvSignals = {
  inches: number | null;
  resolution: "4k" | "8k" | "fhd" | "other" | null;
  display: "qled" | "oled" | "mini_led" | "led" | null;
  smartTv: boolean | null;
  modelTokens: string[];
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
  const A = new Set(a.map((x) => x.toLowerCase()));
  const B = new Set(b.map((x) => x.toLowerCase()));
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

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Detect TV listings (including “65-Inch QLED …” without the word “TV”). */
export function isTvProduct(text: string): boolean {
  const n = normalizeText(text);
  if (/\b(tv|television|smart\s*tv|hdtv)\b/i.test(n)) return true;
  if (/\b(qled|oled|mini\s*led)\b/i.test(n)) return true;
  if (/\b(\d{2,3})\s*(?:inch|inches|in\b|")\b/i.test(n)) {
    if (/\b(qled|oled|mini\s*led|led|uhd|4k|8k|hdr|smart)\b/i.test(n))
      return true;
  }
  if (/\b(4k|8k|uhd)\b/i.test(n) && /\b(class|series)\b/i.test(n)) return true;
  return false;
}

function extractInches(text: string): number | null {
  const n = normalizeText(text);
  const patterns = [
    /\b(\d{2,3})\s*(?:inch|inches)\b/i,
    /\b(\d{2,3})\s*inch\b/i,
    /\b(\d{2,3})\s*in\b(?![a-z])/i,
    /\b(\d{2,3})\s*"/,
    /"\s*(\d{2,3})\b/,
  ];
  for (const re of patterns) {
    const m = n.match(re);
    if (m?.[1]) {
      const v = parseInt(m[1], 10);
      if (v >= 24 && v <= 120) return v;
    }
  }
  return null;
}

function extractResolution(text: string): TvSignals["resolution"] {
  const n = normalizeText(text);
  if (/\b8k\b/i.test(n)) return "8k";
  if (/\b(4k|uhd|ultra\s*hd)\b/i.test(n)) return "4k";
  if (/\b(1080p|fhd|full\s*hd)\b/i.test(n)) return "fhd";
  return null;
}

function extractDisplayType(text: string): TvSignals["display"] {
  const n = normalizeText(text);
  if (/\bmini\s*led\b/i.test(n)) return "mini_led";
  if (/\bqled\b/i.test(n)) return "qled";
  if (/\boled\b/i.test(n)) return "oled";
  if (/\bled\b/i.test(n)) return "led";
  return null;
}

function extractSmartTv(text: string): boolean | null {
  const n = normalizeText(text);
  if (
    /\b(smart\s*tv|smarttv|roku\s*tv|fire\s*tv|google\s*tv|webos|tizen|vidaa)\b/i.test(
      n
    )
  )
    return true;
  if (/\b(non[\s-]*smart|without\s*smart)\b/i.test(n)) return false;
  return null;
}

function extractModelTokens(text: string): string[] {
  const n = normalizeText(text);
  const out = new Set<string>();
  if (/\bneo\s*qled\b/i.test(n)) out.add("neoqled");
  const re =
    /\b([a-z]{1,4}\d{2,4}[a-z0-9]*|[a-z]{1,3}\d[a-z]\d+[a-z0-9]*)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(n)) !== null) {
    const t = m[1].replace(/-/g, "");
    const inchOnly = /^\d{2,3}$/.test(t);
    if (!inchOnly && t.length >= 3) out.add(t.toLowerCase());
  }
  return [...out];
}

export function extractTvSignals(text: string): TvSignals {
  return {
    inches: extractInches(text),
    resolution: extractResolution(text),
    display: extractDisplayType(text),
    smartTv: extractSmartTv(text),
    modelTokens: extractModelTokens(text),
  };
}

function modelFamilyKey(token: string): string {
  const t = token.toLowerCase().replace(/-/g, "");
  const m = t.match(/^([a-z]{1,4}\d{2,4})/);
  if (m) return m[1];
  const m2 = t.match(/^([a-z]+\d)/);
  return m2 ? m2[1] : t;
}

function familiesOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const fa = new Set(a.map(modelFamilyKey));
  const fb = new Set(b.map(modelFamilyKey));
  for (const x of fa) {
    if (fb.has(x)) return true;
  }
  return false;
}

function resolutionCompatible(s: TvSignals, c: TvSignals): boolean {
  if (!s.resolution || !c.resolution) return true;
  return s.resolution === c.resolution;
}

function displayCompatible(s: TvSignals, c: TvSignals): boolean {
  if (!s.display || !c.display) return true;
  return s.display === c.display;
}

function smartCompatible(s: TvSignals, c: TvSignals): boolean {
  if (s.smartTv == null || c.smartTv == null) return true;
  return s.smartTv === c.smartTv;
}

function genderClash(a: ProductSignals, b: ProductSignals): boolean {
  if (!a.gender || !b.gender) return false;
  return (
    (a.gender === "women" && b.gender === "men") ||
    (a.gender === "men" && b.gender === "women")
  );
}

function classifyGenericMatch(
  source: ProductSignals,
  cand: ProductSignals
): { kind: MatchType; score: number } {
  const srcBrand = source.brandNorm;
  const candBrand = cand.brandNorm;
  if (srcBrand && candBrand && !brandsCompatible(srcBrand, candBrand)) {
    return { kind: "none", score: 0 };
  }

  const kwSim = jaccardKeywords(source.keywords, cand.keywords);
  let score = kwSim * 52;

  if (srcBrand && candBrand && brandsCompatible(srcBrand, candBrand)) {
    score += 28;
  } else if (!srcBrand || !candBrand) {
    score += 6;
  }

  if (source.packCount != null && cand.packCount != null) {
    if (source.packCount === cand.packCount) {
      score += 18;
    } else {
      score -= 48;
    }
  }

  if (source.gender && cand.gender) {
    if (source.gender === cand.gender) {
      score += 8;
    } else if (genderClash(source, cand)) {
      score -= 45;
    } else {
      score -= 18;
    }
  }

  score = clampScore(score);

  const brandOk =
    !srcBrand || !candBrand || brandsCompatible(srcBrand, candBrand);
  const packOk =
    source.packCount == null ||
    cand.packCount == null ||
    source.packCount === cand.packCount;

  const exact =
    brandOk &&
    packOk &&
    kwSim >= 0.38 &&
    !genderClash(source, cand) &&
    (Boolean(srcBrand && candBrand) || kwSim >= 0.48);

  const strong =
    brandOk &&
    packOk &&
    kwSim >= 0.2 &&
    !genderClash(source, cand) &&
    (Boolean(srcBrand && candBrand) || kwSim >= 0.34);

  if (exact) return { kind: "exact", score: Math.max(score, 72) };
  if (strong) return { kind: "strong", score: Math.max(score, 54) };
  if (kwSim >= 0.07 && brandOk) return { kind: "weak", score };
  return { kind: "none", score };
}

function classifyTvMatch(
  srcBrand: string | null,
  candBrand: string | null,
  srcTv: TvSignals,
  candTv: TvSignals,
  srcKeywords: string[],
  candKeywords: string[]
): { kind: MatchType; score: number } {
  if (srcBrand && candBrand && !brandsCompatible(srcBrand, candBrand)) {
    return { kind: "none", score: 0 };
  }

  const kwj = jaccardKeywords(srcKeywords, candKeywords);
  const mtj = jaccardKeywords(srcTv.modelTokens, candTv.modelTokens);

  let score = 0;
  if (srcBrand && candBrand && brandsCompatible(srcBrand, candBrand)) {
    score += 36;
  } else if (!srcBrand || !candBrand) {
    score += 10;
  }

  if (srcTv.inches != null && candTv.inches != null) {
    if (srcTv.inches === candTv.inches) {
      score += 28;
    } else {
      score -= 46;
    }
  } else {
    score += 3;
  }

  if (srcTv.display && candTv.display) {
    if (srcTv.display === candTv.display) {
      score += 14;
    } else {
      score -= 20;
    }
  }

  if (srcTv.resolution && candTv.resolution) {
    if (srcTv.resolution === candTv.resolution) {
      score += 14;
    } else {
      score -= 18;
    }
  }

  if (srcTv.smartTv != null && candTv.smartTv != null) {
    if (srcTv.smartTv === candTv.smartTv) {
      score += 8;
    } else {
      score -= 12;
    }
  }

  score += mtj * 24;
  score += kwj * 18;

  score = clampScore(score);

  const brandOk =
    !srcBrand || !candBrand || brandsCompatible(srcBrand, candBrand);
  const sizeBoth = srcTv.inches != null && candTv.inches != null;
  const sizeMatch = sizeBoth && srcTv.inches === candTv.inches;
  const sizeConflict = sizeBoth && srcTv.inches !== candTv.inches;

  if (sizeConflict) {
    return { kind: "none", score: Math.max(0, score) };
  }

  const strongTokenOverlap = mtj >= 0.36 || kwj >= 0.4;
  const familyMatch = familiesOverlap(srcTv.modelTokens, candTv.modelTokens);

  const displayConflict =
    Boolean(srcTv.display && candTv.display) &&
    srcTv.display !== candTv.display;

  if (
    brandOk &&
    sizeMatch &&
    !displayConflict &&
    (familyMatch || strongTokenOverlap)
  ) {
    return { kind: "exact", score: Math.max(score, 76) };
  }

  const coreOk =
    resolutionCompatible(srcTv, candTv) &&
    displayCompatible(srcTv, candTv) &&
    smartCompatible(srcTv, candTv) &&
    (!sizeBoth || sizeMatch);

  const closeModel = mtj >= 0.2 || kwj >= 0.26;

  if (brandOk && coreOk && closeModel) {
    if (!sizeBoth) {
      if (mtj >= 0.16 || kwj >= 0.3) {
        return { kind: "strong", score: Math.max(score, 56) };
      }
      if (kwj >= 0.12 || mtj >= 0.1) return { kind: "weak", score };
      return { kind: "none", score };
    }
    return { kind: "strong", score: Math.max(score, 58) };
  }

  if ((kwj >= 0.1 || mtj >= 0.08) && brandOk) {
    return { kind: "weak", score };
  }
  return { kind: "none", score };
}

/**
 * Classify how closely a candidate matches the source listing.
 */
export function evaluateProductMatch(
  sourceTitle: string,
  sourceBrand: string | null | undefined,
  candidateTitle: string,
  candidateBrand: string | null | undefined
): { matchType: MatchType; score: number } {
  const srcIsTv = isTvProduct(sourceTitle);
  const candIsTv = isTvProduct(candidateTitle);

  if (srcIsTv !== candIsTv) {
    return { matchType: "none", score: 0 };
  }

  const srcSig = buildProductSignals(sourceTitle, sourceBrand);
  const candSig = buildProductSignals(candidateTitle, candidateBrand);

  if (srcIsTv && candIsTv) {
    const sTv = extractTvSignals(sourceTitle);
    const cTv = extractTvSignals(candidateTitle);
    const { kind, score } = classifyTvMatch(
      srcSig.brandNorm,
      candSig.brandNorm,
      sTv,
      cTv,
      srcSig.keywords,
      candSig.keywords
    );
    return { matchType: kind, score };
  }

  const { kind, score } = classifyGenericMatch(srcSig, candSig);
  return { matchType: kind, score };
}

/**
 * Match score 0–100.
 */
export function scoreProductMatch(
  sourceTitle: string,
  sourceBrand: string | null | undefined,
  candidateTitle: string,
  candidateBrand: string | null | undefined
): number {
  return evaluateProductMatch(
    sourceTitle,
    sourceBrand,
    candidateTitle,
    candidateBrand
  ).score;
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

function withMatchMeta(
  r: ProductSearchResult,
  confidence: number,
  matchType: MatchType
): ProductSearchResult {
  const c = Math.max(0, Math.min(1, confidence));
  return { ...r, matchConfidence: c, matchType };
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

  const scored: {
    result: ProductSearchResult;
    matchScore: number;
    matchType: MatchType;
  }[] = [];

  for (const r of deduped) {
    if (sourceUrlKey && normalizeUrlKey(r.productUrl) === sourceUrlKey) {
      continue;
    }
    if (excludeSourceStore && r.store === sourceStore) {
      continue;
    }
    const { matchType, score: matchScore } = evaluateProductMatch(
      sourceTitle,
      sourceProduct?.brand,
      r.title,
      r.brand ?? null
    );
    scored.push({ result: r, matchScore, matchType });
  }

  const forBestDeal = scored.filter(
    (x) => x.matchType === "exact" || x.matchType === "strong"
  );

  forBestDeal.sort(
    (a, b) =>
      (a.result.price ?? Number.POSITIVE_INFINITY) -
      (b.result.price ?? Number.POSITIVE_INFINITY)
  );

  if (forBestDeal.length === 0) {
    return {
      sourceProduct,
      bestDeal: null,
      alternatives: [],
      comparisonMessage: "No comparable match found yet",
    };
  }

  const winner = forBestDeal[0]!;
  const rest = forBestDeal.slice(1);

  const bestDeal = withMatchMeta(
    winner.result,
    winner.matchScore / 100,
    winner.matchType
  );

  const alternatives = rest.map((x) =>
    withMatchMeta(x.result, x.matchScore / 100, x.matchType)
  );

  return {
    sourceProduct,
    bestDeal,
    alternatives,
    comparisonMessage: null,
  };
}

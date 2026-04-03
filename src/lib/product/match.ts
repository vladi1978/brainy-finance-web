import type {
  CandidateProduct,
  MatchConfidenceLabel,
  NormalizedProduct,
  ProductCategory,
} from "./types";

/** Minimum score for each MVP match level (0–100 scale). */
export const SCORE_EXACT_MIN = 76;
export const SCORE_EQUIVALENT_MIN = 52;
export const SCORE_ALTERNATIVE_MIN = 34;

/** Legacy name — alternative floor for “some match”. */
export const WEAK_MATCH_MIN_SCORE = SCORE_ALTERNATIVE_MIN;

const TV_SIZE_HARD_REJECT_DIFF = 8;
const TV_SIZE_SOFT_MAX_DIFF = 3;

const SOFT_BRAND_CATEGORIES = new Set<ProductCategory>([
  "socks",
  "apparel",
  "footwear",
  "household",
  "general",
]);

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function modelOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sb = new Set(b);
  let hit = 0;
  for (const t of a) {
    if (sb.has(t)) hit += 1;
  }
  return hit / Math.max(a.length, b.length);
}

type KeywordSignals = {
  tv: boolean;
  socks: boolean;
  footwear: boolean;
  audio: boolean;
  household: boolean;
  apparel: boolean;
};

function keywordSignals(titleNorm: string): KeywordSignals {
  const t = titleNorm;
  return {
    tv: /\b(smart tv|oled|qled|television|4k tv|8k tv|uhd|\d{2,3}\s*(?:inch|"))\b/.test(t) || /\btv\b/.test(t),
    socks: /\b(sock|socks|crew|ankle|no show)\b/.test(t),
    footwear: /\b(shoe|sneaker|boot|sandal|cleat|loafer)\b/.test(t),
    audio: /\b(headphones?|earbuds?|ear bud|speaker|soundbar|airpods)\b/.test(t),
    household: /\b(detergent|cleaner|paper towel|trash|sponge|mop|battery|bulb)\b/.test(t),
    apparel: /\b(shirt|hoodie|jacket|pants|jeans|dress|shorts|legging)\b/.test(t),
  };
}

function signalsOverlap(a: KeywordSignals, b: KeywordSignals): number {
  const keys = Object.keys(a) as (keyof KeywordSignals)[];
  let n = 0;
  for (const k of keys) {
    if (a[k] && b[k]) n += 1;
  }
  return n;
}

/**
 * Reject cross-category listings (e.g. TV vs socks) unless titles clearly share product-type cues.
 */
export function checkCategoryCompatibility(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): { ok: true } | { ok: false; reason: string } {
  if (source.category === candidate.category) {
    return { ok: true };
  }

  const sa = keywordSignals(source.titleNorm);
  const sb = keywordSignals(candidate.titleNorm);
  const overlap = signalsOverlap(sa, sb);
  if (overlap >= 1) {
    return { ok: true };
  }

  // Allow general ↔ specific when titles share tokens
  const jac = jaccard(
    source.titleNorm.split(/\s+/).filter((w) => w.length >= 3),
    candidate.titleNorm.split(/\s+/).filter((w) => w.length >= 3)
  );
  if (jac >= 0.18) {
    return { ok: true };
  }

  const mixAllowed = new Set<ProductCategory>(["general", "apparel", "socks", "household"]);
  if (
    mixAllowed.has(source.category) &&
    mixAllowed.has(candidate.category) &&
    jac >= 0.1
  ) {
    return { ok: true };
  }

  // TV must stay with TV-like listings
  if (source.category === "tv") {
    if (candidate.category === "tv" || sb.tv) return { ok: true };
    return { ok: false, reason: `category_incompatible(source=tv,candidate=${candidate.category})` };
  }
  if (candidate.category === "tv" && !sa.tv) {
    return { ok: false, reason: `category_incompatible(candidate=tv,source=${source.category})` };
  }

  // Audio vs non-audio
  if (source.category === "audio" && candidate.category !== "audio" && !sb.audio) {
    return { ok: false, reason: `category_incompatible(source=audio,candidate=${candidate.category})` };
  }
  if (candidate.category === "audio" && !sa.audio) {
    return { ok: false, reason: `category_incompatible(candidate=audio,source=${source.category})` };
  }

  // Socks vs non-socks
  if (source.category === "socks" && !sb.socks && candidate.category !== "socks") {
    if (jac >= 0.12) return { ok: true };
    return { ok: false, reason: `category_incompatible(source=socks,candidate=${candidate.category})` };
  }

  // Footwear
  if (source.category === "footwear" && candidate.category !== "footwear" && !sb.footwear) {
    if (jac >= 0.15) return { ok: true };
    return { ok: false, reason: `category_incompatible(source=footwear,candidate=${candidate.category})` };
  }

  if (jac >= 0.14) return { ok: true };
  return {
    ok: false,
    reason: `category_incompatible(${source.category} vs ${candidate.category},jac=${jac.toFixed(2)})`,
  };
}

export type HardGateResult = { ok: true } | { ok: false; reason: string };

/**
 * Strong brand mismatch for electronics where brand is a primary identifier.
 */
export function checkElectronicsBrandGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  const electronics: ProductCategory[] = ["tv"];
  if (!electronics.includes(source.category)) {
    return { ok: true };
  }
  if (!source.brand || !candidate.brand) return { ok: true };
  if (source.brand === candidate.brand) return { ok: true };
  return {
    ok: false,
    reason: `brand_mismatch_electronics(source=${source.brand},candidate=${candidate.brand})`,
  };
}

/**
 * Pack count: hard-reject only wild mismatches; close counts get score penalties instead.
 */
export function checkPackHardGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  if (source.packCount == null || candidate.packCount == null) {
    return { ok: true };
  }
  const a = source.packCount;
  const b = candidate.packCount;
  if (a === b) return { ok: true };
  const ratio = Math.max(a, b) / Math.min(a, b);
  if (ratio <= 2 && Math.abs(a - b) <= 2) {
    return { ok: true };
  }
  if (ratio > 3 && Math.min(a, b) >= 2) {
    return {
      ok: false,
      reason: `pack_count_far_mismatch(source=${source.packCount},candidate=${candidate.packCount})`,
    };
  }
  return { ok: true };
}

export function checkTvSizeGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  if (source.category !== "tv" || candidate.category !== "tv") {
    return { ok: true };
  }
  if (source.sizeInches == null || candidate.sizeInches == null) {
    return { ok: true };
  }
  const diff = Math.abs(source.sizeInches - candidate.sizeInches);
  if (diff <= TV_SIZE_HARD_REJECT_DIFF) return { ok: true };
  return {
    ok: false,
    reason: `tv_size_far_mismatch(source=${source.sizeInches},candidate=${candidate.sizeInches})`,
  };
}

export function runHardGates(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  const cat = checkCategoryCompatibility(source, candidate);
  if (!cat.ok) return cat;
  const e = checkElectronicsBrandGate(source, candidate);
  if (!e.ok) return e;
  const p = checkPackHardGate(source, candidate);
  if (!p.ok) return p;
  return checkTvSizeGate(source, candidate);
}

function genderScore(source: NormalizedProduct, candidate: NormalizedProduct): number {
  if (!source.gender || !candidate.gender) return 4;
  if (source.gender === candidate.gender) return 8;
  if (source.gender === "unisex" || candidate.gender === "unisex") return 6;
  return 0;
}

function packSimilarityScore(source: NormalizedProduct, candidate: NormalizedProduct): number {
  if (source.packCount == null || candidate.packCount == null) return 6;
  if (source.packCount === candidate.packCount) return 10;
  const diff = Math.abs(source.packCount - candidate.packCount);
  if (diff === 1) return 7;
  if (diff === 2) return 4;
  return 1;
}

function tvSizeScore(source: NormalizedProduct, candidate: NormalizedProduct): number {
  if (source.category !== "tv" || candidate.category !== "tv") return 0;
  if (source.sizeInches == null || candidate.sizeInches == null) return 4;
  const diff = Math.abs(source.sizeInches - candidate.sizeInches);
  if (diff === 0) return 12;
  if (diff <= TV_SIZE_SOFT_MAX_DIFF) return 8;
  if (diff <= 5) return 4;
  return 0;
}

function brandScore(source: NormalizedProduct, candidate: NormalizedProduct): number {
  if (!source.brand && !candidate.brand) return 10;
  if (!source.brand || !candidate.brand) return 7;
  if (source.brand === candidate.brand) return 14;
  return 0;
}

function categoryAlignmentScore(source: NormalizedProduct, candidate: NormalizedProduct): number {
  if (source.category === candidate.category) return 18;
  const sa = keywordSignals(source.titleNorm);
  const sb = keywordSignals(candidate.titleNorm);
  if (signalsOverlap(sa, sb) >= 1) return 14;
  return 5;
}

function productTypeKeywordScore(source: NormalizedProduct, candidate: NormalizedProduct): number {
  const sa = keywordSignals(source.titleNorm);
  const sb = keywordSignals(candidate.titleNorm);
  const o = signalsOverlap(sa, sb);
  if (o >= 2) return 10;
  if (o === 1) return 6;
  return 2;
}

export function scoreMatch(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  const srcTokens = source.titleNorm.split(/\s+/).filter((w) => w.length >= 3);
  const candTokens = candidate.titleNorm.split(/\s+/).filter((w) => w.length >= 3);
  const jac = jaccard(srcTokens, candTokens);
  const jacScore = jac * 30;
  reasons.push(`title_jaccard=${jac.toFixed(3)}(×30=${jacScore.toFixed(1)})`);

  const catScore = categoryAlignmentScore(source, candidate);
  reasons.push(`category_alignment=${catScore}`);

  const g = genderScore(source, candidate);
  reasons.push(`gender=${g}`);

  const pk = packSimilarityScore(source, candidate);
  reasons.push(`pack=${pk}`);

  const tv = tvSizeScore(source, candidate);
  reasons.push(`tv_size=${tv}`);

  let b = brandScore(source, candidate);
  if (
    b === 0 &&
    source.brand &&
    candidate.brand &&
    SOFT_BRAND_CATEGORIES.has(source.category)
  ) {
    b = 5;
    reasons.push(`brand_soft_mvp=5`);
  } else {
    reasons.push(`brand=${b}`);
  }

  const mo = modelOverlap(source.modelTokens, candidate.modelTokens);
  const modelScore = mo * 16;
  reasons.push(`model_overlap=${mo.toFixed(2)}(×16=${modelScore.toFixed(1)})`);

  const typeKw = productTypeKeywordScore(source, candidate);
  reasons.push(`product_type_kw=${typeKw}`);

  const raw = jacScore + catScore + g + pk + tv + b + modelScore + typeKw;
  const score = Math.min(100, Math.round(raw));
  reasons.push(`total=${score}`);

  return { score, reasons };
}

export function classifyMatchConfidence(score: number): MatchConfidenceLabel | "none" {
  if (score >= SCORE_EXACT_MIN) return "exact";
  if (score >= SCORE_EQUIVALENT_MIN) return "equivalent";
  if (score >= SCORE_ALTERNATIVE_MIN) return "alternative";
  return "none";
}

export function comparisonReasonFor(
  label: MatchConfidenceLabel | "none",
  score: number
): string {
  if (label === "exact") {
    return "Strong identifier and title overlap — very likely the same product.";
  }
  if (label === "equivalent") {
    return "Same product type and use case with close attributes — suitable for MVP price comparison.";
  }
  if (label === "alternative") {
    return "Related product in the same category — useful as a lower-price option to consider.";
  }
  return `Below minimum match strength (score=${score}).`;
}

/** Exact + equivalent tiers qualify for standard “best deal” presentation. */
export function isPrimaryComparableTier(label: MatchConfidenceLabel | "none"): boolean {
  return label === "exact" || label === "equivalent";
}

export function isAlternativeTier(label: MatchConfidenceLabel | "none"): boolean {
  return label === "alternative";
}

export type EvaluateResult = {
  score: number;
  matchConfidence: MatchConfidenceLabel | "none";
  reasons: string[];
  rejected: boolean;
  rejectionDetail: string | null;
  comparisonReason: string;
};

export function evaluateCandidate(
  source: NormalizedProduct,
  candidate: CandidateProduct
): EvaluateResult {
  const gate = runHardGates(source, candidate.normalized);
  if (!gate.ok) {
    return {
      score: 0,
      matchConfidence: "none",
      reasons: [`hard_gate:${gate.reason}`],
      rejected: true,
      rejectionDetail: gate.reason,
      comparisonReason: comparisonReasonFor("none", 0),
    };
  }

  const { score, reasons } = scoreMatch(source, candidate.normalized);
  const matchConfidence = classifyMatchConfidence(score);

  if (matchConfidence === "none") {
    return {
      score,
      matchConfidence,
      reasons,
      rejected: false,
      rejectionDetail: `below_minimum_score(score=${score},need>=${SCORE_ALTERNATIVE_MIN})`,
      comparisonReason: comparisonReasonFor("none", score),
    };
  }

  return {
    score,
    matchConfidence,
    reasons,
    rejected: false,
    rejectionDetail: null,
    comparisonReason: comparisonReasonFor(matchConfidence, score),
  };
}

import type {
  CandidateProduct,
  ComparisonCategory,
  MatchConfidenceLabel,
  NormalizedProduct,
  ProductCategory,
  StructuredProduct,
  TvDisplayTechBucket,
} from "./types";
import { toComparisonCategory } from "./normalize";

/** After hard gates, TV comparables must reach this attribute score. */
export const MIN_COMPARABLE_SCORE_TV = 85;

/** Non-TV structured + title blend threshold. */
export const MIN_COMPARABLE_SCORE_OTHER = 75;

/** Minimum score for each MVP match level (non-TV legacy blend). */
export const SCORE_EXACT_MIN = 76;
export const SCORE_EQUIVALENT_MIN = 52;
export const SCORE_ALTERNATIVE_MIN = 34;

export const WEAK_MATCH_MIN_SCORE = SCORE_ALTERNATIVE_MIN;

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

function normSku(s: string | null | undefined): string {
  if (!s) return "";
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normFam(s: string | null | undefined): string {
  if (!s) return "";
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function familiesHighlySimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 6 && b.length >= 6 && (a.includes(b) || b.includes(a))) return true;
  return false;
}

export function displayTechsComparable(
  a: TvDisplayTechBucket,
  b: TvDisplayTechBucket
): boolean {
  if (a == null || b == null) return true;
  if (a === b) return true;
  if (
    (a === "neo_qled" && b === "qled") ||
    (a === "qled" && b === "neo_qled")
  ) {
    return true;
  }
  return false;
}

/**
 * Comparison bucket must align (tv / apparel / generic) — no TV ↔ fuzzy general cross-matches.
 */
export function checkComparisonCategoryGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): { ok: true } | { ok: false; reason: string } {
  const a: ComparisonCategory = toComparisonCategory(source.category);
  const b: ComparisonCategory = toComparisonCategory(candidate.category);
  if (a === b) return { ok: true };
  return {
    ok: false,
    reason: `comparison_category_mismatch(${a} vs ${b})`,
  };
}

export type HardGateResult = { ok: true } | { ok: false; reason: string };

export function checkTvBrandStrictGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  if (source.category !== "tv" || candidate.category !== "tv") {
    return { ok: true };
  }
  if (!source.brand || !candidate.brand) {
    return {
      ok: false,
      reason: `tv_brand_incomplete(source=${source.brand},candidate=${candidate.brand})`,
    };
  }
  if (source.brand !== candidate.brand) {
    return {
      ok: false,
      reason: `tv_brand_mismatch(source=${source.brand},candidate=${candidate.brand})`,
    };
  }
  return { ok: true };
}

export function checkTvSizeStrictGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  if (source.category !== "tv" || candidate.category !== "tv") {
    return { ok: true };
  }
  const a = source.structured.sizeInches;
  const b = candidate.structured.sizeInches;
  if (a == null || b == null) {
    return {
      ok: false,
      reason: `tv_size_incomplete(source=${a},candidate=${b})`,
    };
  }
  if (a !== b) {
    return {
      ok: false,
      reason: `tv_size_mismatch(source=${a},candidate=${b})`,
    };
  }
  return { ok: true };
}

export function checkTvDisplayTechGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  if (source.category !== "tv" || candidate.category !== "tv") {
    return { ok: true };
  }
  const a = source.structured.displayType;
  const b = candidate.structured.displayType;
  if (displayTechsComparable(a, b)) return { ok: true };
  return {
    ok: false,
    reason: `tv_display_tech_mismatch(source=${a},candidate=${b})`,
  };
}

export function checkTvResolutionGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  if (source.category !== "tv" || candidate.category !== "tv") {
    return { ok: true };
  }
  const a = source.structured.resolution;
  const b = candidate.structured.resolution;
  if (a == null || b == null) return { ok: true };
  if (a === b) return { ok: true };
  return {
    ok: false,
    reason: `tv_resolution_mismatch(source=${a},candidate=${b})`,
  };
}

/**
 * Same lineup: full SKU match, or same model family key, or highly similar family strings.
 */
export function checkTvStructuredModelGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  if (source.category !== "tv" || candidate.category !== "tv") {
    return { ok: true };
  }
  const s = source.structured;
  const c = candidate.structured;

  const sFull = normSku(s.fullModel);
  const cFull = normSku(c.fullModel);
  if (sFull && cFull) {
    if (sFull === cFull) return { ok: true };
    return {
      ok: false,
      reason: `tv_full_model_mismatch(source=${s.fullModel},candidate=${c.fullModel})`,
    };
  }

  const sFam = normFam(s.modelFamily);
  const cFam = normFam(c.modelFamily);
  if (sFam && cFam) {
    if (sFam === cFam || familiesHighlySimilar(sFam, cFam)) return { ok: true };
    return {
      ok: false,
      reason: `tv_model_family_mismatch(source=${s.modelFamily},candidate=${c.modelFamily})`,
    };
  }

  if (sFull || cFull) {
    return { ok: false, reason: "tv_model_identifier_asymmetric" };
  }

  const sa = source.tv?.modelFamilyTokens ?? [];
  const ca = candidate.tv?.modelFamilyTokens ?? [];
  if (sa.length === 0 || ca.length === 0) {
    return { ok: false, reason: "tv_model_family_unknown" };
  }
  for (const x of sa) {
    for (const y of ca) {
      if (x === y || familiesHighlySimilar(x, y)) return { ok: true };
    }
  }
  return {
    ok: false,
    reason: `tv_model_family_token_mismatch(source=${sa.join(",")},candidate=${ca.join(",")})`,
  };
}

export function checkTvConditionGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  if (source.category !== "tv" || candidate.category !== "tv") {
    return { ok: true };
  }
  const sc = source.structured.condition;
  const cc = candidate.structured.condition;
  const sourceSecondhand =
    sc === "renewed" ||
    sc === "refurbished" ||
    sc === "used" ||
    sc === "open_box";
  const candSecondhand =
    cc === "renewed" ||
    cc === "refurbished" ||
    cc === "used" ||
    cc === "open_box";
  const sourceExpectsNew = !sourceSecondhand;
  if (sourceExpectsNew && candSecondhand) {
    return {
      ok: false,
      reason: `tv_condition_mismatch(source=${sc},candidate=${cc})`,
    };
  }
  return { ok: true };
}

export function checkApparelGenderGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  if (toComparisonCategory(source.category) !== "apparel") return { ok: true };
  if (toComparisonCategory(candidate.category) !== "apparel") return { ok: true };
  const sg = source.structured.gender;
  const cg = candidate.structured.gender;
  if (!sg || !cg) return { ok: true };
  if (sg === cg) return { ok: true };
  if (sg === "unisex" || cg === "unisex") return { ok: true };
  return {
    ok: false,
    reason: `apparel_gender_mismatch(source=${sg},candidate=${cg})`,
  };
}

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

export function runTvHardGates(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  const gates: Array<() => HardGateResult> = [
    () => checkTvBrandStrictGate(source, candidate),
    () => checkTvSizeStrictGate(source, candidate),
    () => checkTvDisplayTechGate(source, candidate),
    () => checkTvResolutionGate(source, candidate),
    () => checkTvStructuredModelGate(source, candidate),
    () => checkTvConditionGate(source, candidate),
  ];
  for (const g of gates) {
    const r = g();
    if (!r.ok) return r;
  }
  return { ok: true };
}

function isSecondhandCondition(c: StructuredProduct["condition"]): boolean {
  return (
    c === "renewed" ||
    c === "refurbished" ||
    c === "used" ||
    c === "open_box"
  );
}

/**
 * TV attribute score (max 100): brand 30, size 25, model family 25, display 10, condition 10.
 * Core trio is only credited after `runTvHardGates` succeeds (so gates and points stay aligned).
 */
export function scoreTvStructured(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): { score: number; reasons: string[] } {
  const s = source.structured;
  const c = candidate.structured;
  const reasons: string[] = [
    "brand_match=30",
    "size_match=25",
    "model_line_match=25",
  ];
  let score = 80;

  const sd = s.displayType;
  const cd = c.displayType;
  if (sd != null && cd != null) {
    if (displayTechsComparable(sd, cd)) {
      score += 10;
      reasons.push("display_match=10");
    } else {
      reasons.push("display_match=0");
    }
  } else {
    score += 5;
    reasons.push("display_not_detected=5");
  }

  if (!isSecondhandCondition(s.condition) && !isSecondhandCondition(c.condition)) {
    score += 10;
    reasons.push("condition_match=10");
  } else if (s.condition === "new" && c.condition === "new") {
    score += 10;
    reasons.push("condition_new_match=10");
  } else {
    reasons.push("condition_match=0");
  }

  reasons.push(`tv_attr_total=${score}`);
  return { score, reasons };
}

function scoreApparelStructured(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): { score: number; reasons: string[] } {
  const s = source.structured;
  const c = candidate.structured;
  let score = 0;
  const reasons: string[] = [];

  if (s.brand && c.brand && s.brand === c.brand) {
    score += 28;
    reasons.push("brand=28");
  } else if (!s.brand || !c.brand) {
    score += 8;
    reasons.push("brand_partial=8");
  } else {
    reasons.push("brand=0");
  }

  if (s.packCount != null && c.packCount != null && s.packCount === c.packCount) {
    score += 27;
    reasons.push("pack=27");
  } else if (s.packCount == null || c.packCount == null) {
    score += 10;
    reasons.push("pack_unknown=10");
  } else {
    reasons.push("pack=0");
  }

  if (s.gender && c.gender && (s.gender === c.gender || s.gender === "unisex" || c.gender === "unisex")) {
    score += 20;
    reasons.push("gender=20");
  } else {
    score += 10;
    reasons.push("gender_neutral=10");
  }

  if (s.color && c.color && s.color === c.color) {
    score += 15;
    reasons.push("color=15");
  } else {
    score += 5;
    reasons.push("color_partial=5");
  }

  const jac = jaccard(
    source.titleNorm.split(/\s+/).filter((w) => w.length >= 3),
    candidate.titleNorm.split(/\s+/).filter((w) => w.length >= 3)
  );
  const jScore = Math.round(jac * 10);
  score += jScore;
  reasons.push(`title_overlap=${jScore}`);

  reasons.push(`apparel_total=${score}`);
  return { score, reasons };
}

function scoreGenericStructured(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const srcTokens = source.titleNorm.split(/\s+/).filter((w) => w.length >= 3);
  const candTokens = candidate.titleNorm.split(/\s+/).filter((w) => w.length >= 3);
  const jac = jaccard(srcTokens, candTokens);
  const jacScore = Math.round(jac * 35);
  reasons.push(`title_jaccard=${jac.toFixed(3)}(×35=${jacScore})`);

  let b = 0;
  if (!source.brand && !candidate.brand) b = 12;
  else if (!source.brand || !candidate.brand) b = 8;
  else if (source.brand === candidate.brand) b = 18;
  else if (SOFT_BRAND_CATEGORIES.has(source.category)) b = 6;
  reasons.push(`brand=${b}`);

  const mt = modelOverlap(source.modelTokens, candidate.modelTokens);
  const modelScore = Math.round(mt * 22);
  reasons.push(`model_overlap=${mt.toFixed(2)}(×22=${modelScore})`);

  let pk = 10;
  if (source.packCount != null && candidate.packCount != null) {
    pk = source.packCount === candidate.packCount ? 15 : 5;
  }
  reasons.push(`pack=${pk}`);

  const raw = jacScore + b + modelScore + pk;
  const score = Math.min(100, Math.round(raw));
  reasons.push(`generic_total=${score}`);
  return { score, reasons };
}

export function runHardGates(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  const bucket = checkComparisonCategoryGate(source, candidate);
  if (!bucket.ok) return bucket;

  const apparelGender = checkApparelGenderGate(source, candidate);
  if (!apparelGender.ok) return apparelGender;

  const pack = checkPackHardGate(source, candidate);
  if (!pack.ok) return pack;

  if (source.category === "tv" && candidate.category === "tv") {
    return runTvHardGates(source, candidate);
  }
  return { ok: true };
}

export function logComparisonCandidateDebug(payload: {
  sourceStructured: StructuredProduct;
  candidateStructured: StructuredProduct;
  candidateStore: string;
  rejectionReason: string | null;
  finalScore: number;
  scoreReasons: string[];
}): void {
  console.log("[compare-candidate]", JSON.stringify(payload));
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
    return "Structured attributes align — same product line for a trustworthy price comparison.";
  }
  if (label === "equivalent") {
    return "Structured attributes closely match — suitable for price comparison.";
  }
  if (label === "alternative") {
    return "Related listing in the same category — verify details before buying.";
  }
  return `Below minimum match strength (score=${score}).`;
}

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

function confidenceFromScore(
  score: number,
  kind: "tv" | "other"
): MatchConfidenceLabel | "none" {
  const min = kind === "tv" ? MIN_COMPARABLE_SCORE_TV : MIN_COMPARABLE_SCORE_OTHER;
  if (score < min) return "none";
  if (score >= 95) return "exact";
  return "equivalent";
}

export function evaluateCandidate(
  source: NormalizedProduct,
  candidate: CandidateProduct
): EvaluateResult {
  const gate = runHardGates(source, candidate.normalized);
  if (!gate.ok) {
    logComparisonCandidateDebug({
      sourceStructured: source.structured,
      candidateStructured: candidate.normalized.structured,
      candidateStore: candidate.store,
      rejectionReason: gate.reason,
      finalScore: 0,
      scoreReasons: [`hard_gate:${gate.reason}`],
    });
    return {
      score: 0,
      matchConfidence: "none",
      reasons: [`hard_gate:${gate.reason}`],
      rejected: true,
      rejectionDetail: gate.reason,
      comparisonReason: comparisonReasonFor("none", 0),
    };
  }

  const isTv = source.category === "tv" && candidate.normalized.category === "tv";
  const isApparel =
    toComparisonCategory(source.category) === "apparel" &&
    toComparisonCategory(candidate.normalized.category) === "apparel";

  let score: number;
  let reasons: string[];
  if (isTv) {
    const r = scoreTvStructured(source, candidate.normalized);
    score = r.score;
    reasons = r.reasons;
  } else if (isApparel) {
    const r = scoreApparelStructured(source, candidate.normalized);
    score = r.score;
    reasons = r.reasons;
  } else {
    const r = scoreGenericStructured(source, candidate.normalized);
    score = r.score;
    reasons = r.reasons;
  }

  const minScore = isTv ? MIN_COMPARABLE_SCORE_TV : MIN_COMPARABLE_SCORE_OTHER;
  if (score < minScore) {
    const detail = `below_structured_threshold(score=${score},need>=${minScore})`;
    logComparisonCandidateDebug({
      sourceStructured: source.structured,
      candidateStructured: candidate.normalized.structured,
      candidateStore: candidate.store,
      rejectionReason: detail,
      finalScore: score,
      scoreReasons: reasons,
    });
    return {
      score,
      matchConfidence: "none",
      reasons: [...reasons, detail],
      rejected: false,
      rejectionDetail: detail,
      comparisonReason: comparisonReasonFor("none", score),
    };
  }

  const matchConfidence = confidenceFromScore(score, isTv ? "tv" : "other");
  logComparisonCandidateDebug({
    sourceStructured: source.structured,
    candidateStructured: candidate.normalized.structured,
    candidateStore: candidate.store,
    rejectionReason: null,
    finalScore: score,
    scoreReasons: reasons,
  });

  return {
    score,
    matchConfidence,
    reasons,
    rejected: false,
    rejectionDetail: null,
    comparisonReason: comparisonReasonFor(matchConfidence, score),
  };
}

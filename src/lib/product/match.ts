import type {
  CandidateProduct,
  ComparisonCategory,
  MatchConfidenceLabel,
  NormalizedProduct,
  ProductCategory,
  StructuredProduct,
  TvDisplayTechBucket,
} from "./types";
import {
  inferTvFamilyFromFullModel,
  isLikelyScreenProductTitle,
  normalizeTitle,
  toComparisonCategory,
} from "./normalize";

/** After hard gates, TV comparables must reach this attribute score. */
export const MIN_COMPARABLE_SCORE_TV = 85;

/** Non-TV structured + title blend threshold. */
export const MIN_COMPARABLE_SCORE_OTHER = 75;

/** Minimum score for each MVP match level (non-TV legacy blend). */
export const SCORE_EXACT_MIN = 76;
export const SCORE_EQUIVALENT_MIN = 52;
export const SCORE_ALTERNATIVE_MIN = 34;

export const WEAK_MATCH_MIN_SCORE = SCORE_ALTERNATIVE_MIN;

export type HardGateResult = { ok: true } | { ok: false; reason: string };

function hardGateFail(reason: string): HardGateResult {
  return { ok: false, reason };
}

const SOFT_BRAND_CATEGORIES = new Set<ProductCategory>([
  "socks",
  "apparel",
  "footwear",
  "household",
  "general",
]);

function normSku(s: string | null | undefined): string {
  if (!s) return "";
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normFam(s: string | null | undefined): string {
  if (!s) return "";
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Sorted normalized model tokens for strict identity checks (non-TV). */
function normalizedModelKey(tokens: string[]): string {
  const u = [...new Set(tokens.map((t) => normSku(t)).filter((t) => t.length > 0))].sort();
  return u.join("|");
}

/** Word-boundary aware check so bare inch counts (e.g. `55`) do not match inside `155`. */
function blobHasSignature(blob: string, sig: string): boolean {
  if (/^\d{1,3}$/.test(sig)) {
    return new RegExp(`\\b${sig}\\b`).test(blob);
  }
  return blob.includes(sig);
}

export function checkCriticalListingGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  const c = source.critical;
  if (
    !c ||
    (c.dimensionSignatures.length === 0 &&
      c.kindPhrases.length === 0 &&
      c.accessoryMustInclude.length === 0)
  ) {
    return { ok: true };
  }

  const blob =
    candidate.titleNorm +
    " " +
    normalizeTitle(candidate.structured.title);

  for (const dim of c.dimensionSignatures) {
    if (!blobHasSignature(blob, dim)) {
      return hardGateFail(`critical_dimension_missing(${dim})`);
    }
  }

  for (const acc of c.accessoryMustInclude) {
    if (!blob.includes(acc)) {
      return hardGateFail(`critical_accessory_missing(${acc})`);
    }
  }

  if (c.kindPhrases.length > 0) {
    const hit = c.kindPhrases.some((p) => blob.includes(p));
    if (!hit) {
      return hardGateFail("critical_kind_mismatch");
    }
  }

  return { ok: true };
}

function tvRequiresStrictModelLine(source: NormalizedProduct): boolean {
  if (source.structured.fullModel) return true;
  if (source.structured.modelFamily) return true;
  const toks = source.tv?.modelFamilyTokens ?? [];
  return toks.some((t) => normFam(t).length >= 4);
}

/**
 * When either side has extractable model/SKU fragments in the title, both must list the same
 * normalized identity (MVP — no fuzzy family or partial overlap).
 */
function checkFootwearModelIdentityGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  const a = source.modelTokens;
  const b = candidate.modelTokens;
  if (a.length === 0 && b.length === 0) return { ok: true };
  if (a.length === 0 || b.length === 0) return { ok: true };
  const setA = new Set(a.map((t) => normSku(t)).filter((t) => t.length >= 4));
  const setB = new Set(b.map((t) => normSku(t)).filter((t) => t.length >= 4));
  if (setA.size === 0 || setB.size === 0) return { ok: true };
  for (const x of setA) {
    if (setB.has(x)) return { ok: true };
  }
  return hardGateFail(
    `footwear_model_no_overlap(source=${normalizedModelKey(a)},candidate=${normalizedModelKey(b)})`
  );
}

export function checkGenericModelIdentityGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  if (source.category === "tv" && candidate.category === "tv") {
    return { ok: true };
  }
  if (source.category === "monitor" && candidate.category === "monitor") {
    return { ok: true };
  }
  if (source.category === "footwear" && candidate.category === "footwear") {
    return checkFootwearModelIdentityGate(source, candidate);
  }
  const a = source.modelTokens;
  const b = candidate.modelTokens;
  if (a.length === 0 && b.length === 0) return { ok: true };
  if (a.length === 0 || b.length === 0) {
    return hardGateFail("model_identity_asymmetric");
  }
  if (normalizedModelKey(a) !== normalizedModelKey(b)) {
    return hardGateFail(
      `model_identity_mismatch(source=${normalizedModelKey(a)},candidate=${normalizedModelKey(b)})`
    );
  }
  return { ok: true };
}

/** Stricter than Jaccard: what fraction of the shorter token list is covered by the other title. */
function tokenContainmentRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  let inter = 0;
  for (const x of b) {
    if (sa.has(x)) inter += 1;
  }
  return inter / Math.min(a.length, b.length);
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
  return hardGateFail(`comparison_category_mismatch(${a} vs ${b})`);
}

/** Normalized search text: title + structured model fields (for substring / fuzzy model-id match). */
function tvSearchBlob(p: NormalizedProduct): string {
  const st = p.structured;
  const parts = [
    p.titleNorm,
    st.fullModel,
    st.modelFamily,
    ...(p.tv?.modelFamilyTokens ?? []),
  ];
  return normSku(parts.filter(Boolean).join(" "));
}

function tvModelNeedlesFromSide(p: NormalizedProduct): string[] {
  const st = p.structured;
  const out = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const n = normSku(raw ?? "");
    if (n.length >= 4) out.add(n);
  };
  add(inferTvFamilyFromFullModel(st.fullModel));
  add(st.modelFamily);
  add(st.fullModel);
  for (const t of p.tv?.modelFamilyTokens ?? []) add(t);
  return [...out];
}

/** Substring match, then single-character typo within a same-length window (e.g. OCR). */
function needleFuzzyInBlob(needle: string, blob: string): boolean {
  if (needle.length < 4) return false;
  if (blob.includes(needle)) return true;
  const n = needle.length;
  for (let i = 0; i + n <= blob.length; i++) {
    let diff = 0;
    for (let j = 0; j < n; j++) {
      if (blob[i + j] !== needle[j]) diff++;
      if (diff > 1) break;
    }
    if (diff <= 1) return true;
  }
  return false;
}

/** True if any model id from either side appears in the peer's title or model string (fuzzy). */
function tvModelIdsMatchFuzzy(a: NormalizedProduct, b: NormalizedProduct): boolean {
  const needlesA = tvModelNeedlesFromSide(a);
  const needlesB = tvModelNeedlesFromSide(b);
  const blobB = tvSearchBlob(b);
  const blobA = tvSearchBlob(a);
  for (const n of needlesA) {
    if (needleFuzzyInBlob(n, blobB)) return true;
  }
  for (const n of needlesB) {
    if (needleFuzzyInBlob(n, blobA)) return true;
  }
  return false;
}

/**
 * When both listings are uncategorized "general" but look like fixed screens with different
 * diagonals, reject (e.g. 65" panel vs 32" panel that both matched "Samsung" in search).
 */
export function checkBothGeneralDisplaySizeStrictGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  if (source.category !== "general" || candidate.category !== "general") {
    return { ok: true };
  }
  const sa = source.sizeInches ?? source.structured.sizeInches;
  const sb = candidate.sizeInches ?? candidate.structured.sizeInches;
  if (sa == null || sb == null || sa === sb) return { ok: true };
  const t1 = source.structured.title;
  const t2 = candidate.structured.title;
  if (!isLikelyScreenProductTitle(t1) || !isLikelyScreenProductTitle(t2)) {
    return { ok: true };
  }
  return hardGateFail(`general_screen_size_mismatch(source=${sa},candidate=${sb})`);
}

export function checkMonitorBrandStrictGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  if (source.category !== "monitor" || candidate.category !== "monitor") {
    return { ok: true };
  }
  if (!source.brand || !candidate.brand) {
    return hardGateFail(
      `monitor_brand_incomplete(source=${source.brand},candidate=${candidate.brand})`
    );
  }
  if (source.brand !== candidate.brand) {
    return hardGateFail(
      `monitor_brand_mismatch(source=${source.brand},candidate=${candidate.brand})`
    );
  }
  return { ok: true };
}

export function checkMonitorSizeStrictGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  if (source.category !== "monitor" || candidate.category !== "monitor") {
    return { ok: true };
  }
  const a = source.structured.sizeInches;
  const b = candidate.structured.sizeInches;
  if (a == null || b == null) {
    return hardGateFail(`monitor_size_incomplete(source=${a},candidate=${b})`);
  }
  if (a !== b) {
    return hardGateFail(`monitor_size_mismatch(source=${a},candidate=${b})`);
  }
  return { ok: true };
}

/**
 * When both sides include model-style codes, require overlap or cross-title substring match.
 */
export function checkMonitorModelGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  if (source.category !== "monitor" || candidate.category !== "monitor") {
    return { ok: true };
  }
  const sa = source.modelTokens
    .map((t) => normSku(t))
    .filter((t) => t.length >= 4);
  const ca = candidate.modelTokens
    .map((t) => normSku(t))
    .filter((t) => t.length >= 4);
  if (sa.length === 0 || ca.length === 0) return { ok: true };
  const setB = new Set(ca);
  for (const x of sa) {
    if (setB.has(x)) return { ok: true };
  }
  const blobB = normSku(candidate.titleNorm);
  const blobA = normSku(source.titleNorm);
  for (const x of sa) {
    if (blobB.includes(x)) return { ok: true };
  }
  for (const x of ca) {
    if (blobA.includes(x)) return { ok: true };
  }
  return hardGateFail(
    `monitor_model_mismatch(source_tokens=${sa.join(",")},candidate_tokens=${ca.join(",")})`
  );
}

export function runMonitorHardGates(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  const gates: Array<() => HardGateResult> = [
    () => checkMonitorModelGate(source, candidate),
  ];
  for (const g of gates) {
    const r = g();
    if (!r.ok) return r;
  }
  return { ok: true };
}

export function checkTvBrandStrictGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  if (source.category !== "tv" || candidate.category !== "tv") {
    return { ok: true };
  }
  if (!source.brand || !candidate.brand) {
    return hardGateFail(
      `tv_brand_incomplete(source=${source.brand},candidate=${candidate.brand})`
    );
  }
  if (source.brand !== candidate.brand) {
    return hardGateFail(
      `tv_brand_mismatch(source=${source.brand},candidate=${candidate.brand})`
    );
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
    return hardGateFail(`tv_size_incomplete(source=${a},candidate=${b})`);
  }
  if (a !== b) {
    return hardGateFail(`tv_size_mismatch(source=${a},candidate=${b})`);
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
  return hardGateFail(`tv_display_tech_mismatch(source=${a},candidate=${b})`);
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
  return hardGateFail(`tv_resolution_mismatch(source=${a},candidate=${b})`);
}

/**
 * Same lineup: exact normalized full SKU when both present; if SKUs differ, pass when a model id
 * from either listing (e.g. M70HB) matches via substring or fuzzy search in the peer's title or
 * model fields. Otherwise exact model family key, then token pairs, with the same fuzzy fallback.
 */
export function checkTvStructuredModelGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  if (source.category !== "tv" || candidate.category !== "tv") {
    return { ok: true };
  }
  if (!tvRequiresStrictModelLine(source)) {
    return { ok: true };
  }
  const s = source.structured;
  const c = candidate.structured;

  const sFull = normSku(s.fullModel);
  const cFull = normSku(c.fullModel);
  if (sFull && cFull) {
    if (sFull === cFull) return { ok: true };
    if (tvModelIdsMatchFuzzy(source, candidate)) return { ok: true };
    return hardGateFail(
      `tv_full_model_mismatch(source=${s.fullModel},candidate=${c.fullModel})`
    );
  }

  const sFam = normFam(s.modelFamily);
  const cFam = normFam(c.modelFamily);
  if (sFam && cFam) {
    if (sFam === cFam) return { ok: true };
    if (tvModelIdsMatchFuzzy(source, candidate)) return { ok: true };
    return hardGateFail(
      `tv_model_family_mismatch(source=${s.modelFamily},candidate=${c.modelFamily})`
    );
  }

  if (sFull || cFull) {
    if (tvModelIdsMatchFuzzy(source, candidate)) return { ok: true };
    return hardGateFail("tv_model_identifier_asymmetric");
  }

  const sa = source.tv?.modelFamilyTokens ?? [];
  const ca = candidate.tv?.modelFamilyTokens ?? [];
  if (sa.length === 0 || ca.length === 0) {
    if (tvModelIdsMatchFuzzy(source, candidate)) return { ok: true };
    return hardGateFail("tv_model_family_unknown");
  }
  for (const x of sa) {
    const nx = normFam(x);
    if (!nx) continue;
    for (const y of ca) {
      if (nx === normFam(y)) return { ok: true };
    }
  }
  if (tvModelIdsMatchFuzzy(source, candidate)) return { ok: true };
  return hardGateFail(
    `tv_model_family_token_mismatch(source=${sa.join(",")},candidate=${ca.join(",")})`
  );
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
    return hardGateFail(`tv_condition_mismatch(source=${sc},candidate=${cc})`);
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
  return hardGateFail(`apparel_gender_mismatch(source=${sg},candidate=${cg})`);
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
    return hardGateFail(
      `pack_count_far_mismatch(source=${source.packCount},candidate=${candidate.packCount})`
    );
  }
  return { ok: true };
}

/**
 * TV-specific gates after {@link checkTvSizeStrictGate} (size runs first in {@link runHardGates}).
 */
export function runTvHardGates(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  const gates: Array<() => HardGateResult> = [
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

function scoreMonitorStructured(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (source.brand && candidate.brand && source.brand === candidate.brand) {
    score += 35;
    reasons.push("brand_match=35");
  } else if (!source.brand || !candidate.brand) {
    score += 12;
    reasons.push("brand_partial=12");
  } else {
    reasons.push("brand_mismatch=0");
  }
  const sa = source.structured.sizeInches;
  const sb = candidate.structured.sizeInches;
  if (sa != null && sb != null && sa === sb) {
    score += 35;
    reasons.push("diagonal_match=35");
  } else {
    reasons.push("diagonal_unknown_or_mismatch=0");
  }
  const setA = new Set(source.modelTokens.map((t) => normSku(t)).filter((t) => t.length >= 3));
  let overlap = 0;
  for (const t of candidate.modelTokens) {
    const k = normSku(t);
    if (k.length >= 3 && setA.has(k)) overlap++;
  }
  if (overlap > 0) {
    score += 30;
    reasons.push(`model_token_overlap=${overlap}(+30)`);
  } else {
    const ctr = tokenContainmentRatio(
      source.titleNorm.split(/\s+/).filter((w) => w.length >= 3),
      candidate.titleNorm.split(/\s+/).filter((w) => w.length >= 3)
    );
    const add = Math.round(ctr * 25);
    score += add;
    reasons.push(`title_containment_monitor=${ctr.toFixed(2)}(+${add})`);
  }
  const total = Math.min(100, score);
  reasons.push(`monitor_attr_total=${total}`);
  return { score: total, reasons };
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

  const titleTokA = source.titleNorm.split(/\s+/).filter((w) => w.length >= 3);
  const titleTokB = candidate.titleNorm.split(/\s+/).filter((w) => w.length >= 3);
  const ctr = tokenContainmentRatio(titleTokA, titleTokB);
  const tScore = Math.round(ctr * 10);
  score += tScore;
  reasons.push(`title_containment=${ctr.toFixed(2)}(×10=${tScore})`);

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
  const ctr = tokenContainmentRatio(srcTokens, candTokens);
  const titleScore = Math.round(ctr * 28);
  reasons.push(`title_containment=${ctr.toFixed(3)}(×28=${titleScore})`);

  let b = 0;
  if (!source.brand && !candidate.brand) b = 12;
  else if (!source.brand || !candidate.brand) b = 8;
  else if (source.brand === candidate.brand) b = 18;
  else if (SOFT_BRAND_CATEGORIES.has(source.category)) b = 6;
  reasons.push(`brand=${b}`);

  const bothNoModel =
    source.modelTokens.length === 0 && candidate.modelTokens.length === 0;
  const modelScore = bothNoModel ? 11 : 22;
  reasons.push(
    bothNoModel
      ? "model_identity=11(no_tokens)"
      : "model_identity=22(exact_gate)"
  );

  let pk = 10;
  if (source.packCount != null && candidate.packCount != null) {
    pk = source.packCount === candidate.packCount ? 15 : 5;
  }
  reasons.push(`pack=${pk}`);

  const raw = titleScore + b + modelScore + pk;
  const score = Math.min(100, Math.round(raw));
  reasons.push(`generic_total=${score}`);
  return { score, reasons };
}

/**
 * Structured attribute score (0–100) after hard gates succeed — drives API match tiers.
 */
export function attributeScoreForPair(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): { score: number; reasons: string[] } {
  const isTv = source.category === "tv" && candidate.category === "tv";
  const isMonitor =
    source.category === "monitor" && candidate.category === "monitor";
  const isApparel =
    toComparisonCategory(source.category) === "apparel" &&
    toComparisonCategory(candidate.category) === "apparel";

  if (isTv) return scoreTvStructured(source, candidate);
  if (isMonitor) return scoreMonitorStructured(source, candidate);
  if (isApparel) return scoreApparelStructured(source, candidate);
  return scoreGenericStructured(source, candidate);
}

export function runHardGates(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  const bucket = checkComparisonCategoryGate(source, candidate);
  if (!bucket.ok) return bucket;

  const critical = checkCriticalListingGate(source, candidate);
  if (!critical.ok) return critical;

  const generalScreen = checkBothGeneralDisplaySizeStrictGate(source, candidate);
  if (!generalScreen.ok) return generalScreen;

  if (source.category === "tv" && candidate.category === "tv") {
    const tvSize = checkTvSizeStrictGate(source, candidate);
    if (!tvSize.ok) return tvSize;
  }

  if (source.category === "monitor" && candidate.category === "monitor") {
    const monSize = checkMonitorSizeStrictGate(source, candidate);
    if (!monSize.ok) return monSize;
  }

  const apparelGender = checkApparelGenderGate(source, candidate);
  if (!apparelGender.ok) return apparelGender;

  const pack = checkPackHardGate(source, candidate);
  if (!pack.ok) return pack;

  const modelId = checkGenericModelIdentityGate(source, candidate);
  if (!modelId.ok) return modelId;

  if (source.category === "tv" && candidate.category === "tv") {
    return runTvHardGates(source, candidate);
  }
  if (source.category === "monitor" && candidate.category === "monitor") {
    return runMonitorHardGates(source, candidate);
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

/**
 * @deprecated Used only for legacy tests or manual inspection. The live API scores
 * search relevance (`scoreQueryRelevance`) instead of structured exact-equivalence.
 */
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

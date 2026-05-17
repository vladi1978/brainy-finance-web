import {
  isLikelyScreenProductTitle,
  normalizeTitle,
  toComparisonCategory,
} from "../normalize";
import type {
  ComparisonCategory,
  NormalizedProduct,
  ProductCategory,
  TvDisplayTechBucket,
} from "../types";
import type { UniversalAttributeKey } from "./attributeKeys";
import { profileForCategory } from "./weightProfiles";
import type { CategoryMatchProfile } from "./weightProfiles";
import {
  blobHasSignature,
  buildUniversalMatchSnapshot,
  modelNeedlesFromSnapshot,
  snapshotSearchBlob,
  titleOverlapScore,
  tokenContainmentRatio,
  type UniversalMatchSnapshot,
} from "./snapshot";

export type UniversalHardGateResult = { ok: true } | { ok: false; reason: string };

function fail(reason: string): UniversalHardGateResult {
  return { ok: false, reason };
}

function normFam(s: string | null | undefined): string {
  if (!s) return "";
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizedModelKey(tokens: string[]): string {
  const u = [...new Set(tokens.map((t) => normFam(t)).filter((t) => t.length > 0))].sort();
  return u.join("|");
}

function listingBlob(norm: NormalizedProduct): string {
  return `${norm.titleNorm} ${normalizeTitle(norm.structured.title)}`;
}

export function displayPanelsComparable(
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
  if (
    (a === "crystal_led" && b === "led") ||
    (a === "led" && b === "crystal_led")
  ) {
    return true;
  }
  return false;
}

/** Substring match, then single-character typo within a same-length window. */
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

function tvModelIdsMatchFuzzy(a: UniversalMatchSnapshot, b: UniversalMatchSnapshot): boolean {
  const needlesA = modelNeedlesFromSnapshot(a);
  const needlesB = modelNeedlesFromSnapshot(b);
  const blobB = snapshotSearchBlob(b);
  const blobA = snapshotSearchBlob(a);
  for (const n of needlesA) {
    if (needleFuzzyInBlob(n, blobB)) return true;
  }
  for (const n of needlesB) {
    if (needleFuzzyInBlob(n, blobA)) return true;
  }
  return false;
}

function referenceHasRichModelLine(source: UniversalMatchSnapshot): boolean {
  if (source.fullModelNorm && source.fullModelNorm.length >= 6) return true;
  if (source.modelFamilyNorm && source.modelFamilyNorm.length >= 4) return true;
  if (source.tvModelFamilyTokens.length > 0) return true;
  return source.modelTokensNorm.some((t) => t.replace(/[^a-z0-9]/gi, "").length >= 5);
}

export function checkIncompatibleProductFamilyGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): UniversalHardGateResult {
  const isScreenCat = (c: ProductCategory) => c === "tv" || c === "monitor";
  const isWearElectAudio = (c: ProductCategory) =>
    c === "footwear" || c === "socks" || c === "audio";

  function shoeLikeTitle(norm: NormalizedProduct): boolean {
    const blob = listingBlob(norm);
    return /\b(shoe|sneaker|boot|sandal|cleat|loafer|yeezy|air max)\b/.test(blob);
  }
  function headphoneLikeTitle(norm: NormalizedProduct): boolean {
    const blob = listingBlob(norm);
    return /\b(headphone|earbud|airpods|ear buds)\b/.test(blob);
  }
  function screenLikeTitle(norm: NormalizedProduct): boolean {
    const blob = listingBlob(norm);
    if (/\b(monitor|\btv\b|television|smart tv|oled|qled|uhd tv|neo[\s-]*qled|mini[\s-]*led)\b/.test(blob)) {
      return true;
    }
    if (
      /\b\d{2,3}\s*(?:"|-?\s*inch|inches|class\b)\b/.test(blob) &&
      /\b(led|lcd|hdr|smart|tizen|roku|hdr10)\b/.test(blob)
    ) {
      return true;
    }
    return false;
  }

  const sScr = isScreenCat(source.category);
  const cScr = isScreenCat(candidate.category);

  if (sScr && isWearElectAudio(candidate.category)) {
    return fail(
      `incompatible_product_family(source=${source.category},candidate=${candidate.category})`
    );
  }
  if (cScr && isWearElectAudio(source.category)) {
    return fail(
      `incompatible_product_family(source=${source.category},candidate=${candidate.category})`
    );
  }

  if (source.category === "tv" || source.category === "monitor") {
    const ambiguousCand =
      candidate.category === "general" ||
      candidate.category === "household" ||
      candidate.category === "apparel";
    if (ambiguousCand) {
      if (shoeLikeTitle(candidate) || headphoneLikeTitle(candidate)) {
        if (!screenLikeTitle(candidate)) {
          return fail(
            "incompatible_product_family(screen_reference_vs_consumer_wearable_candidate)"
          );
        }
      }
    }
  }

  if (candidate.category === "tv" || candidate.category === "monitor") {
    const ambiguousSrc =
      source.category === "general" ||
      source.category === "household" ||
      source.category === "apparel";
    if (ambiguousSrc) {
      if (shoeLikeTitle(source) || headphoneLikeTitle(source)) {
        if (!screenLikeTitle(source)) {
          return fail(
            "incompatible_product_family(screen_candidate_vs_consumer_wearable_reference)"
          );
        }
      }
    }
  }

  return { ok: true };
}

export function checkComparisonCategoryGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): UniversalHardGateResult {
  const a: ComparisonCategory = toComparisonCategory(source.category);
  const b: ComparisonCategory = toComparisonCategory(candidate.category);
  if (a === b) return { ok: true };
  if (b === "generic") return { ok: true };
  return fail(`comparison_category_mismatch(${a} vs ${b})`);
}

export function checkCriticalListingGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): UniversalHardGateResult {
  const c = source.critical;
  if (
    !c ||
    (c.dimensionSignatures.length === 0 &&
      c.kindPhrases.length === 0 &&
      c.accessoryMustInclude.length === 0)
  ) {
    return { ok: true };
  }

  const blob = listingBlob(candidate);

  for (const acc of c.accessoryMustInclude) {
    if (!blob.includes(acc)) {
      return fail(`critical_accessory_missing(${acc})`);
    }
  }

  return { ok: true };
}

export function checkBothGeneralScreenDiagonalGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct,
  profile: CategoryMatchProfile
): UniversalHardGateResult {
  if (!profile.gates.rejectDiagonalMismatchWhenBothKnown) return { ok: true };
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
  return fail(`general_screen_size_mismatch(source=${sa},candidate=${sb})`);
}

export function checkPackHardGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct,
  profile: CategoryMatchProfile
): UniversalHardGateResult {
  if (!profile.gates.rejectPackFarMismatch) return { ok: true };
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
    return fail(
      `pack_count_far_mismatch(source=${source.packCount},candidate=${candidate.packCount})`
    );
  }
  return { ok: true };
}

export function checkApparelGenderGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): UniversalHardGateResult {
  if (toComparisonCategory(source.category) !== "apparel") return { ok: true };
  if (toComparisonCategory(candidate.category) !== "apparel") return { ok: true };
  const sg = source.structured.gender;
  const cg = candidate.structured.gender;
  if (!sg || !cg) return { ok: true };
  if (sg === cg) return { ok: true };
  if (sg === "unisex" || cg === "unisex") return { ok: true };
  return fail(`apparel_gender_mismatch(source=${sg},candidate=${cg})`);
}

function checkFootwearModelOverlapGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct,
  profile: CategoryMatchProfile
): UniversalHardGateResult {
  if (!profile.gates.footwearModelOverlapStrict) return { ok: true };
  if (source.category !== "footwear" || candidate.category !== "footwear") {
    return { ok: true };
  }
  const a = source.modelTokens;
  const b = candidate.modelTokens;
  if (a.length === 0 && b.length === 0) return { ok: true };
  if (a.length === 0 || b.length === 0) return { ok: true };
  const setA = new Set(a.map((t) => normFam(t)).filter((t) => t.length >= 4));
  const setB = new Set(b.map((t) => normFam(t)).filter((t) => t.length >= 4));
  if (setA.size === 0 || setB.size === 0) return { ok: true };
  for (const x of setA) {
    if (setB.has(x)) return { ok: true };
  }
  return fail(
    `footwear_model_no_overlap(source=${normalizedModelKey(a)},candidate=${normalizedModelKey(b)})`
  );
}

function checkScreenBrandGate(
  src: UniversalMatchSnapshot,
  cand: UniversalMatchSnapshot,
  profile: CategoryMatchProfile
): UniversalHardGateResult {
  if (!profile.gates.strictBrandWhenBothKnown) return { ok: true };
  if (
    (src.category !== "tv" && src.category !== "monitor") ||
    (cand.category !== "tv" && cand.category !== "monitor")
  ) {
    return { ok: true };
  }
  if (!src.brand || !cand.brand) {
    return fail(
      `screen_brand_incomplete(source=${src.brand},candidate=${cand.brand})`
    );
  }
  // Brand differences are allowed (intentional substitutes across retailers).
  return { ok: true };
}

function checkDiagonalGate(
  src: UniversalMatchSnapshot,
  cand: UniversalMatchSnapshot,
  profile: CategoryMatchProfile
): UniversalHardGateResult {
  if (!profile.gates.rejectDiagonalMismatchWhenBothKnown) return { ok: true };
  const onlyScreens =
    src.category === "tv" ||
    src.category === "monitor" ||
    (src.category === "general" &&
      isLikelyScreenProductTitle(src.titleNorm));
  if (!onlyScreens) return { ok: true };
  const candOk =
    cand.category === "tv" ||
    cand.category === "monitor" ||
    cand.category === "general";
  if (!candOk) return { ok: true };

  const a = src.diagonalInches;
  const b = cand.diagonalInches;
  if (profile.gates.rejectDiagonalOneSideUnknown) {
    if (a == null || b == null) return fail(`screen_diagonal_incomplete(source=${a},candidate=${b})`);
  }
  if (a == null || b == null) return { ok: true };
  if (a !== b) {
    return fail(`screen_diagonal_mismatch(source=${a},candidate=${b})`);
  }
  return { ok: true };
}

function checkResolutionGate(
  src: UniversalMatchSnapshot,
  cand: UniversalMatchSnapshot,
  profile: CategoryMatchProfile
): UniversalHardGateResult {
  if (!profile.gates.rejectResolutionMismatchWhenBothKnown) return { ok: true };
  if (src.category !== "tv" || cand.category !== "tv") return { ok: true };
  const a = src.resolutionTier;
  const b = cand.resolutionTier;
  if (a == null || b == null) return { ok: true };
  if (a === b) return { ok: true };
  return fail(`resolution_bucket_mismatch(source=${a},candidate=${b})`);
}

function checkDisplayPanelGate(
  src: UniversalMatchSnapshot,
  cand: UniversalMatchSnapshot,
  profile: CategoryMatchProfile
): UniversalHardGateResult {
  if (!profile.gates.rejectDisplayPanelMismatchWhenBothKnown) return { ok: true };
  if (src.category !== "tv" || cand.category !== "tv") return { ok: true };
  const a = src.displayPanel;
  const b = cand.displayPanel;
  if (displayPanelsComparable(a, b)) return { ok: true };
  return fail(`display_panel_mismatch(source=${a},candidate=${b})`);
}

function checkConditionTierGate(
  src: UniversalMatchSnapshot,
  cand: UniversalMatchSnapshot,
  profile: CategoryMatchProfile
): UniversalHardGateResult {
  if (!profile.gates.rejectUsedWhenReferenceNew) return { ok: true };
  const secondhand = (c: UniversalMatchSnapshot["condition"]) =>
    c === "renewed" ||
    c === "refurbished" ||
    c === "used" ||
    c === "open_box";
  const srcNew = !secondhand(src.condition);
  if (!srcNew) return { ok: true };
  if (secondhand(cand.condition)) {
    return fail(`condition_mismatch(source=${src.condition},candidate=${cand.condition})`);
  }
  return { ok: true };
}

function checkTvStyleModelGate(
  src: UniversalMatchSnapshot,
  cand: UniversalMatchSnapshot,
  profile: CategoryMatchProfile
): UniversalHardGateResult {
  if (!profile.gates.enforceModelLineWhenReferenceRich) return { ok: true };
  if (src.category !== "tv" || cand.category !== "tv") return { ok: true };
  if (!referenceHasRichModelLine(src)) return { ok: true };

  const sFull = src.fullModelNorm ?? "";
  const cFull = cand.fullModelNorm ?? "";
  if (sFull && cFull) {
    if (sFull === cFull) return { ok: true };
    if (tvModelIdsMatchFuzzy(src, cand)) return { ok: true };
    return fail(`tv_full_model_mismatch(source_full=${sFull},candidate_full=${cFull})`);
  }

  const sFam = src.modelFamilyNorm ?? "";
  const cFam = cand.modelFamilyNorm ?? "";
  if (sFam && cFam) {
    if (sFam === cFam) return { ok: true };
    if (tvModelIdsMatchFuzzy(src, cand)) return { ok: true };
    return fail(`tv_model_family_mismatch(source=${sFam},candidate=${cFam})`);
  }

  if (sFull || cFull) {
    if (tvModelIdsMatchFuzzy(src, cand)) return { ok: true };
    return fail("tv_model_identifier_asymmetric");
  }

  const sa = src.tvModelFamilyTokens;
  const ca = cand.tvModelFamilyTokens;
  if (sa.length === 0 || ca.length === 0) {
    if (tvModelIdsMatchFuzzy(src, cand)) return { ok: true };
    return fail("tv_model_family_unknown");
  }
  for (const x of sa) {
    const nx = normFam(x);
    if (!nx) continue;
    for (const y of ca) {
      if (nx === normFam(y)) return { ok: true };
    }
  }
  if (tvModelIdsMatchFuzzy(src, cand)) return { ok: true };
  return fail(
    `tv_model_family_token_mismatch(source=${sa.join(",")},candidate=${ca.join(",")})`
  );
}

function checkMonitorModelGate(
  src: UniversalMatchSnapshot,
  cand: UniversalMatchSnapshot,
  profile: CategoryMatchProfile
): UniversalHardGateResult {
  if (!profile.gates.monitorStyleModelGate) return { ok: true };
  if (src.category !== "monitor" || cand.category !== "monitor") return { ok: true };
  const sa = src.modelTokensNorm
    .map((t) => normFam(t))
    .filter((t) => t.length >= 4);
  const ca = cand.modelTokensNorm
    .map((t) => normFam(t))
    .filter((t) => t.length >= 4);
  if (sa.length === 0 || ca.length === 0) return { ok: true };
  const setB = new Set(ca);
  for (const x of sa) {
    if (setB.has(x)) return { ok: true };
  }
  const blobB = normFam(cand.titleNorm);
  const blobA = normFam(src.titleNorm);
  for (const x of sa) {
    if (blobB.includes(x)) return { ok: true };
  }
  for (const x of ca) {
    if (blobA.includes(x)) return { ok: true };
  }
  return fail(
    `monitor_model_mismatch(source_tokens=${sa.join(",")},candidate_tokens=${ca.join(",")})`
  );
}

function monitorDiagonalStrict(
  src: UniversalMatchSnapshot,
  cand: UniversalMatchSnapshot
): UniversalHardGateResult {
  if (src.category !== "monitor" || cand.category !== "monitor") return { ok: true };
  const a = src.diagonalInches;
  const b = cand.diagonalInches;
  if (a == null || b == null) {
    return fail(`monitor_diagonal_incomplete(source=${a},candidate=${b})`);
  }
  if (a !== b) {
    return fail(`monitor_diagonal_mismatch(source=${a},candidate=${b})`);
  }
  return { ok: true };
}

/**
 * Profile-driven hard gates (reference category selects {@link profileForCategory}).
 */
export function runUniversalHardGates(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): UniversalHardGateResult {
  const profile = profileForCategory(source.category);
  const srcSnap = buildUniversalMatchSnapshot(source);
  const candSnap = buildUniversalMatchSnapshot(candidate);

  const chain: UniversalHardGateResult[] = [
    checkComparisonCategoryGate(source, candidate),
    checkIncompatibleProductFamilyGate(source, candidate),
    checkCriticalListingGate(source, candidate),
    checkBothGeneralScreenDiagonalGate(source, candidate, profile),
    checkDiagonalGate(srcSnap, candSnap, profile),
    monitorDiagonalStrict(srcSnap, candSnap),
    checkApparelGenderGate(source, candidate),
    checkPackHardGate(source, candidate, profile),
    checkFootwearModelOverlapGate(source, candidate, profile),
    checkScreenBrandGate(srcSnap, candSnap, profile),
    checkResolutionGate(srcSnap, candSnap, profile),
    checkDisplayPanelGate(srcSnap, candSnap, profile),
    checkTvStyleModelGate(srcSnap, candSnap, profile),
    checkMonitorModelGate(srcSnap, candSnap, profile),
    checkConditionTierGate(srcSnap, candSnap, profile),
  ];

  for (const r of chain) {
    if (!r.ok) return r;
  }
  return { ok: true };
}

export type UniversalStructuredScore = {
  score: number;
  reasons: string[];
  /** Useful signals for tier labeling */
  axisQuality: Partial<Record<UniversalAttributeKey, number>>;
  sameProductLineSignals: boolean;
};

function brandQuality(
  src: UniversalMatchSnapshot,
  cand: UniversalMatchSnapshot,
  soft: boolean
): { q: number; detail: string } {
  if (!src.brand && !cand.brand) return { q: 0.62, detail: "brand_both_unknown" };
  if (!src.brand || !cand.brand) return { q: 0.58, detail: "brand_partial_unknown" };
  if (src.brand === cand.brand) return { q: 1, detail: "brand_exact" };
  if (soft) return { q: 0.38, detail: "brand_diff_soft" };
  return { q: 0.08, detail: "brand_mismatch" };
}

function diagonalQuality(
  src: UniversalMatchSnapshot,
  cand: UniversalMatchSnapshot
): { q: number; detail: string } {
  const a = src.diagonalInches;
  const b = cand.diagonalInches;
  if (a != null && b != null && a === b) return { q: 1, detail: "diagonal_exact" };
  if (a == null || b == null) return { q: 0.74, detail: "diagonal_unknown_side" };
  return { q: 0.05, detail: "diagonal_mismatch_should_have_gated" };
}

function modelLineQuality(
  src: UniversalMatchSnapshot,
  cand: UniversalMatchSnapshot,
  cat: ProductCategory
): { q: number; detail: string } {
  if (cat === "tv") {
    if (tvModelIdsMatchFuzzy(src, cand)) return { q: 1, detail: "model_fuzzy_tv" };
    if (!referenceHasRichModelLine(src)) return { q: 0.55, detail: "model_reference_sparse" };
    return { q: 0.18, detail: "model_tv_weak" };
  }
  if (cat === "monitor") {
    const sa = src.modelTokensNorm.map((t) => normFam(t)).filter((t) => t.length >= 3);
    const ca = cand.modelTokensNorm.map((t) => normFam(t)).filter((t) => t.length >= 3);
    const ratio = tokenContainmentRatio(sa, ca);
    if (ratio >= 0.5) return { q: 1, detail: `monitor_model_overlap=${ratio.toFixed(2)}` };
    const ctr = titleOverlapScore(src, cand);
    const blended = Math.max(ratio, ctr * 0.85);
    return { q: Math.min(1, blended + 0.15), detail: `monitor_model_soft=${blended.toFixed(2)}` };
  }
  if (cat === "footwear") {
    const sa = src.modelTokensNorm.map(normFam).filter((t) => t.length >= 4);
    const ca = cand.modelTokensNorm.map(normFam).filter((t) => t.length >= 4);
    if (sa.length && ca.length) {
      const setB = new Set(ca);
      for (const x of sa) {
        if (setB.has(x)) return { q: 1, detail: "footwear_model_hit" };
      }
    }
    return { q: 0.42, detail: "footwear_model_soft" };
  }

  const needles = modelNeedlesFromSnapshot(src);
  const blob = snapshotSearchBlob(cand);
  if (needles.some((n) => needleFuzzyInBlob(n, blob))) {
    return { q: 0.92, detail: "generic_model_needle_hit" };
  }
  const ctr = tokenContainmentRatio(
    src.modelTokensNorm.filter((t) => t.length >= 3),
    cand.modelTokensNorm.filter((t) => t.length >= 3)
  );
  if (ctr >= 0.45) return { q: 0.78, detail: `generic_model_token_ctr=${ctr.toFixed(2)}` };
  const titleCtr = titleOverlapScore(src, cand);
  return {
    q: Math.min(1, 0.35 + titleCtr * 0.45),
    detail: `generic_model_fallback_title=${titleCtr.toFixed(2)}`,
  };
}

function resolutionQuality(
  src: UniversalMatchSnapshot,
  cand: UniversalMatchSnapshot
): { q: number; detail: string } {
  const a = src.resolutionTier;
  const b = cand.resolutionTier;
  if (a == null || b == null) return { q: 0.78, detail: "resolution_partial" };
  if (a === b) return { q: 1, detail: "resolution_exact" };
  return { q: 0.12, detail: "resolution_clash" };
}

function displayQuality(
  src: UniversalMatchSnapshot,
  cand: UniversalMatchSnapshot
): { q: number; detail: string } {
  const a = src.displayPanel;
  const b = cand.displayPanel;
  if (a == null || b == null) return { q: 0.82, detail: "display_partial" };
  if (displayPanelsComparable(a, b)) return { q: 1, detail: "display_ok" };
  return { q: 0.1, detail: "display_clash" };
}

function smartQuality(
  src: UniversalMatchSnapshot,
  cand: UniversalMatchSnapshot
): { q: number; detail: string } {
  const a = src.smartTv;
  const b = cand.smartTv;
  if (a == null || b == null) return { q: 0.75, detail: "smart_unknown" };
  if (a === b) return { q: 1, detail: "smart_match" };
  return { q: 0.55, detail: "smart_mismatch_soft" };
}

function conditionQuality(
  src: UniversalMatchSnapshot,
  cand: UniversalMatchSnapshot
): { q: number; detail: string } {
  const secondhand = (c: UniversalMatchSnapshot["condition"]) =>
    c === "renewed" ||
    c === "refurbished" ||
    c === "used" ||
    c === "open_box";
  const sN = !secondhand(src.condition);
  const cN = !secondhand(cand.condition);
  if (sN === cN) return { q: 1, detail: "condition_tier_ok" };
  return { q: 0.22, detail: "condition_tier_diff" };
}

function packQuality(
  src: UniversalMatchSnapshot,
  cand: UniversalMatchSnapshot
): { q: number; detail: string } {
  const a = src.packCount;
  const b = cand.packCount;
  if (a == null || b == null) return { q: 0.72, detail: "pack_unknown" };
  if (a === b) return { q: 1, detail: "pack_exact" };
  const ratio = Math.max(a, b) / Math.min(a, b);
  if (ratio <= 2 && Math.abs(a - b) <= 2) return { q: 0.78, detail: "pack_close" };
  return { q: 0.25, detail: "pack_far" };
}

function genderQuality(
  src: UniversalMatchSnapshot,
  cand: UniversalMatchSnapshot
): { q: number; detail: string } {
  const a = src.gender;
  const b = cand.gender;
  if (!a || !b) return { q: 0.7, detail: "gender_unknown" };
  if (a === b || a === "unisex" || b === "unisex") return { q: 1, detail: "gender_ok" };
  return { q: 0.2, detail: "gender_clash" };
}

function colorQuality(
  src: UniversalMatchSnapshot,
  cand: UniversalMatchSnapshot
): { q: number; detail: string } {
  const a = src.color;
  const b = cand.color;
  if (!a || !b) return { q: 0.68, detail: "color_unknown" };
  if (a === b) return { q: 1, detail: "color_exact" };
  return { q: 0.45, detail: "color_diff" };
}

function categoryBucketQuality(
  src: UniversalMatchSnapshot,
  cand: UniversalMatchSnapshot
): { q: number; detail: string } {
  if (src.category === cand.category) return { q: 1, detail: "category_exact" };
  if (cand.category === "general") return { q: 0.72, detail: "category_candidate_generic" };
  return { q: 0.35, detail: "category_soft" };
}

/**
 * Weighted structured similarity (0–100) after gates succeed.
 */
export function scoreUniversalStructured(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): UniversalStructuredScore {
  const profile = profileForCategory(source.category);
  const src = buildUniversalMatchSnapshot(source);
  const cand = buildUniversalMatchSnapshot(candidate);
  const wmap = profile.weights;

  const reasons: string[] = [];
  const axisQuality: Partial<Record<UniversalAttributeKey, number>> = {};

  let weighted = 0;
  let wsum = 0;

  const apply = (
    key: UniversalAttributeKey,
    q: number,
    detail: string
  ) => {
    const w = wmap[key];
    if (w == null || w <= 0) return;
    axisQuality[key] = q;
    weighted += q * w;
    wsum += w;
    reasons.push(`${key}=${(q * w).toFixed(1)}(${detail})`);
  };

  const cb = categoryBucketQuality(src, cand);
  apply("category_bucket", cb.q, cb.detail);

  const br = brandQuality(src, cand, profile.softBrandScoring);
  apply("brand", br.q, br.detail);

  const ml = modelLineQuality(src, cand, source.category);
  apply("model_line", ml.q, ml.detail);

  const dg = diagonalQuality(src, cand);
  if (wmap.diagonal_inches != null && wmap.diagonal_inches > 0) {
    apply("diagonal_inches", dg.q, dg.detail);
  }

  const sl =
    src.sizeLabel && cand.sizeLabel && src.sizeLabel === cand.sizeLabel
      ? { q: 1, detail: "size_label_exact" }
      : !src.sizeLabel || !cand.sizeLabel
        ? { q: 0.68, detail: "size_label_unknown" }
        : { q: 0.35, detail: "size_label_diff" };
  apply("size_label", sl.q, sl.detail);

  const res = resolutionQuality(src, cand);
  apply("resolution_tier", res.q, res.detail);

  const disp = displayQuality(src, cand);
  apply("display_panel", disp.q, disp.detail);

  const sm = smartQuality(src, cand);
  apply("smart_features", sm.q, sm.detail);

  const cond = conditionQuality(src, cand);
  apply("condition", cond.q, cond.detail);

  const pk = packQuality(src, cand);
  apply("pack_quantity", pk.q, pk.detail);

  const gen = genderQuality(src, cand);
  apply("apparel_gender", gen.q, gen.detail);

  const col = colorQuality(src, cand);
  apply("color", col.q, col.detail);

  const tit = titleOverlapScore(src, cand);
  apply("title_overlap", tit, `title_ctr=${tit.toFixed(2)}`);

  const score =
    wsum > 0 ? Math.min(100, Math.round((weighted / wsum) * 100)) : 50;

  const sameProductLineSignals =
    ml.q >= 0.9 &&
    br.q >= 0.95 &&
    dg.q >= 0.95 &&
    cb.q >= 0.95;

  reasons.push(`structured_total=${score}`);
  return { score, reasons, axisQuality, sameProductLineSignals };
}

export function missingCriticalDimensionSignatures(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): string[] {
  const c = source.critical;
  if (!c || c.dimensionSignatures.length === 0) return [];

  const blob = listingBlob(candidate);
  return c.dimensionSignatures.filter((dim) => !blobHasSignature(blob, dim));
}

export function shouldApplyCriticalKindPhraseSoftPenalty(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): boolean {
  const cr = source.critical;
  if (!cr || cr.kindPhrases.length === 0) return false;
  const blob = listingBlob(candidate);
  return !cr.kindPhrases.some((p) => blob.includes(p));
}

export function shouldApplyDiagonalIncompleteSoftPenalty(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): boolean {
  const profile = profileForCategory(source.category);
  if (!profile.gates.rejectDiagonalMismatchWhenBothKnown) return false;
  const src = buildUniversalMatchSnapshot(source);
  const cand = buildUniversalMatchSnapshot(candidate);
  const screenPair =
    (src.category === "tv" || src.category === "monitor") &&
    (cand.category === "tv" || cand.category === "monitor");
  if (!screenPair) return false;
  const a = src.diagonalInches;
  const b = cand.diagonalInches;
  return (
    (a != null && b == null) ||
    (a == null && b != null)
  );
}

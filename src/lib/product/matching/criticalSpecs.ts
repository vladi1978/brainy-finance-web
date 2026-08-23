import {
  compareFlowDepartmentToProductDepartment,
  type CompareFlowDepartment,
} from "../compareFlowDepartment";
import { extractDepartmentAttributes } from "../department/attributeExtractor";
import { normalizeTitle } from "../normalize";
import type { NormalizedProduct, ProductCondition, ProductDepartment } from "../types";
import { toProductDepartment } from "../normalize";
import {
  evaluateScreenSizeGate,
  logScreenSizeGate,
  screenSizeGateReason,
  screenSizeMatchQuality,
  screenSizeShouldHardReject,
} from "./displayDimensions";
import { buildUniversalMatchSnapshot } from "./snapshot";

export type DepartmentGateOptions = {
  /** User-selected compare-flow department overrides title-derived department. */
  selectedDepartment?: CompareFlowDepartment | null;
};

export type CriticalSpecsGateResult =
  | { ok: true; softPenalties: string[] }
  | { ok: false; reason: string };

export type DimensionPair = {
  a: number;
  b: number;
  /** Canonical key e.g. `18x52` */
  key: string;
};

export type CriticalSpecsSnapshot = {
  dimensionPairs: DimensionPair[];
  diagonalInches: number | null;
  sizeLabel: string | null;
  shoeSize: number | null;
  packCount: number | null;
  capacity: string | null;
  modelKeys: string[];
  condition: ProductCondition;
};

const DIM_PAIR_RE =
  /\b(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:by|x|×)\s*(\d+(?:\.\d+)?)\s*(?:in|inch|inches|"|ft|feet|')?\b/gi;

const DIM_COMPACT_RE = /\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\b/gi;
const DIM_TRIPLE_RE =
  /\b(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:in|inch|inches|"|ft|feet|')?\b/gi;

const CAPACITY_RE =
  /\b(\d+(?:\.\d+)?)\s*(gal|gallon|gallons|liters?|l|ml|oz|ounce|ounces|lb|lbs|pound|pounds|cu\.?\s*ft|cubic\s*feet|quart|qt|kg|g|gram|grams)\b/i;

function pairKey(a: number, b: number): string {
  return `${a}x${b}`.toLowerCase();
}

export function addDimensionPair(
  out: Map<string, DimensionPair>,
  rawA: string,
  rawB: string
): void {
  const a = parseFloat(rawA);
  const b = parseFloat(rawB);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return;
  const key = pairKey(a, b);
  out.set(key, { a, b, key });
}

/** Parse WxH dimension pairs from free text (pools, furniture, filters, etc.). */
export function parseDimensionPairs(raw: string): DimensionPair[] {
  const t = raw.replace(/\u2033/g, '"').replace(/\u2032/g, "'");
  const out = new Map<string, DimensionPair>();

  for (const m of t.matchAll(DIM_TRIPLE_RE)) {
    addDimensionPair(out, m[1]!, m[2]!);
    addDimensionPair(out, m[2]!, m[3]!);
  }
  for (const m of t.matchAll(DIM_PAIR_RE)) {
    addDimensionPair(out, m[1]!, m[2]!);
  }
  for (const m of t.matchAll(DIM_COMPACT_RE)) {
    addDimensionPair(out, m[1]!, m[2]!);
  }

  return [...out.values()].slice(0, 8);
}

function extractCapacity(title: string): string | null {
  const m = normalizeTitle(title).match(CAPACITY_RE);
  if (!m) return null;
  const unit = m[2]!.toLowerCase().replace(/\s+/g, "");
  return `${m[1]}${unit}`;
}

function extractNumericShoeSize(title: string, category: NormalizedProduct["category"]): number | null {
  if (category !== "footwear" && category !== "apparel") return null;
  const n = normalizeTitle(title);
  const explicit = n.match(/\bsize\s+(\d{1,2}(?:\.\d)?)\b/);
  if (explicit) {
    const v = parseFloat(explicit[1]!);
    if (v >= 4 && v <= 20) return v;
  }
  const us = n.match(/\b(?:us|uk|eu)\s*(\d{1,2}(?:\.\d)?)\b/);
  if (us) {
    const v = parseFloat(us[1]!);
    if (v >= 4 && v <= 20) return v;
  }
  return null;
}

function modelKeysFromNorm(norm: NormalizedProduct): string[] {
  const snap = buildUniversalMatchSnapshot(norm);
  const keys = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const u = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (u.length >= 5) keys.add(u);
  };
  add(snap.fullModelNorm);
  add(snap.modelFamilyNorm);
  for (const t of snap.modelTokensNorm) {
    const u = t.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (u.length >= 5) keys.add(u);
  }
  return [...keys].slice(0, 12);
}

export function buildCriticalSpecsSnapshot(
  norm: NormalizedProduct,
  title: string
): CriticalSpecsSnapshot {
  const raw = `${title} ${norm.structured.title}`;
  const snap = buildUniversalMatchSnapshot(norm);
  const pairMap = new Map<string, DimensionPair>();
  for (const p of parseDimensionPairs(raw)) {
    pairMap.set(p.key, p);
  }
  for (const sig of norm.critical?.dimensionSignatures ?? []) {
    if (!sig.includes("x")) continue;
    const parts = sig.replace(/\s+/g, "").split("x");
    if (parts.length === 2) addDimensionPair(pairMap, parts[0]!, parts[1]!);
  }

  const st = norm.structured;
  const isPoolCategory =
    norm.category === "pool" ||
    norm.category === "outdoor_pool" ||
    norm.category === "swimming_pool";
  if (isPoolCategory) {
    const dims = [...pairMap.values()].map((p) => p.key);
    console.log(
      "[POOL_DIMENSIONS_PARSED]",
      JSON.stringify({
        title: title.slice(0, 180),
        parsedDimensionPairs: dims,
      })
    );
  }
  return {
    dimensionPairs: [...pairMap.values()],
    diagonalInches: snap.diagonalInches,
    sizeLabel: snap.sizeLabel,
    shoeSize: extractNumericShoeSize(raw, norm.category),
    packCount: snap.packCount,
    capacity: extractCapacity(raw),
    modelKeys: modelKeysFromNorm(norm),
    condition: snap.condition ?? st.condition,
  };
}

function specsSummary(spec: CriticalSpecsSnapshot): Record<string, unknown> {
  return {
    dimensionPairs: spec.dimensionPairs.map((p) => p.key),
    diagonalInches: spec.diagonalInches,
    sizeLabel: spec.sizeLabel,
    shoeSize: spec.shoeSize,
    packCount: spec.packCount,
    capacity: spec.capacity,
    modelKeys: spec.modelKeys,
    condition: spec.condition,
  };
}

function fail(
  reason: string,
  sourceSpec: CriticalSpecsSnapshot,
  candidateSpec: CriticalSpecsSnapshot
): CriticalSpecsGateResult {
  return {
    ok: false,
    reason: `critical_spec:${reason}|source=${JSON.stringify(specsSummary(sourceSpec))}|candidate=${JSON.stringify(specsSummary(candidateSpec))}`,
  };
}

function dimensionClose(a: number, b: number): boolean {
  if (a === b) return true;
  const denom = Math.max(a, b, 1);
  return Math.abs(a - b) / denom <= 0.03;
}

function parseDimensionKey(key: string): [number, number] | null {
  const parts = key.replace(/\s+/g, "").split("x");
  if (parts.length !== 2) return null;
  const a = parseFloat(parts[0]!);
  const b = parseFloat(parts[1]!);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return [a, b];
}

const ROUND_SHAPE_RE = /\b(round|circular|circle)\b/i;
const RECT_SHAPE_RE =
  /\b(rectangular|rectangle|rect|oval|square|octagon|oblong)\b/i;

/** Hard reject when pool shapes are incompatible (e.g. round vs rectangular). */
export function poolShapesIncompatible(
  sourceShape: string | null | undefined,
  candidateShape: string | null | undefined
): boolean {
  if (!sourceShape || !candidateShape) return false;
  const srcRound = ROUND_SHAPE_RE.test(sourceShape);
  const srcRect = RECT_SHAPE_RE.test(sourceShape);
  const candRound = ROUND_SHAPE_RE.test(candidateShape);
  const candRect = RECT_SHAPE_RE.test(candidateShape);
  if (srcRound && candRect) return true;
  if (srcRect && candRound) return true;
  return false;
}

/**
 * Drastic pool size mismatch (hard reject). Close alternatives (e.g. 15×52 vs 16×52)
 * should score as possible alternatives, not be filtered out.
 */
export function poolDimensionsDrasticallyDifferent(
  sourceKey: string,
  candidateKey: string
): boolean {
  const pa = parseDimensionKey(sourceKey);
  const pb = parseDimensionKey(candidateKey);
  if (!pa || !pb) return false;

  const axisRatio = (x: number, y: number) => {
    const lo = Math.min(x, y);
    const hi = Math.max(x, y);
    if (lo <= 0) return Number.POSITIVE_INFINITY;
    return hi / lo;
  };

  const rA = axisRatio(pa[0], pb[0]);
  const rB = axisRatio(pa[1], pb[1]);

  if (rA > 1.18 && rB > 1.18) return true;
  if (rA > 1.28 || rB > 1.28) return true;
  return false;
}

/** One pool dimension axis is close enough for a possible-alternative band. */
function poolDimensionAxisClose(a: number, b: number): boolean {
  if (dimensionClose(a, b)) return true;
  const delta = Math.abs(a - b);
  const denom = Math.max(a, b, 1);
  if (delta <= 1.5 && denom <= 32) return true;
  if (delta <= 5 && denom >= 40) return true;
  return delta / denom <= 0.12;
}

function pairsEquivalent(a: DimensionPair, b: DimensionPair): boolean {
  if (a.key === b.key) return true;
  return dimensionClose(a.a, b.a) && dimensionClose(a.b, b.b);
}

function pairsConflict(source: DimensionPair[], candidate: DimensionPair[]): boolean {
  if (source.length === 0 || candidate.length === 0) return false;
  for (const sp of source) {
    for (const cp of candidate) {
      if (pairsEquivalent(sp, cp)) continue;
      if (poolDimensionsDrasticallyDifferent(sp.key, cp.key)) return true;
      const shareB = poolDimensionAxisClose(sp.b, cp.b);
      const shareA = poolDimensionAxisClose(sp.a, cp.a);
      if (shareB && !poolDimensionAxisClose(sp.a, cp.a)) continue;
      if (shareA && !poolDimensionAxisClose(sp.b, cp.b)) continue;
      if (!shareA && !shareB) {
        const ratioA = Math.max(sp.a, cp.a) / Math.min(sp.a, cp.a);
        const ratioB = Math.max(sp.b, cp.b) / Math.min(sp.b, cp.b);
        if (ratioA <= 1.05 && ratioB <= 1.05) continue;
        if (ratioA > 1.03 || ratioB > 1.03) return true;
      }
    }
  }
  return false;
}

function pairPresentInBlob(pair: DimensionPair, blob: string): boolean {
  if (blob.includes(pair.key)) return true;
  const aRe = new RegExp(`\\b${pair.a}\\b`);
  const bRe = new RegExp(`\\b${pair.b}\\b`);
  return aRe.test(blob) && bRe.test(blob);
}

/**
 * Hard gate for universal critical specs: dimensions, size, capacity, pack, model, condition.
 */
export function checkUniversalCriticalSpecsGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct,
  candidateTitle: string
): CriticalSpecsGateResult {
  const sourceTitle = source.structured.title;
  const src = buildCriticalSpecsSnapshot(source, sourceTitle);
  const cand = buildCriticalSpecsSnapshot(candidate, candidateTitle);
  const candBlob = normalizeTitle(
    `${candidateTitle} ${candidate.structured.title}`
  );

  const softPenalties: string[] = [];

  if (src.dimensionPairs.length > 0) {
    const primary = src.dimensionPairs[0]!;
    if (cand.dimensionPairs.length > 0) {
      const exact = cand.dimensionPairs.some((p) => pairsEquivalent(p, primary));
      if (!exact) {
        if (pairsConflict(src.dimensionPairs, cand.dimensionPairs)) {
          return fail("dimension_pair_mismatch", src, cand);
        }
        softPenalties.push("dimension_pair_unconfirmed_soft(×0.78)");
      }
    } else if (!pairPresentInBlob(primary, candBlob)) {
      softPenalties.push("dimension_pair_unconfirmed_soft(×0.78)");
    }
  }

  if (src.diagonalInches != null && cand.diagonalInches != null) {
    if (screenSizeShouldHardReject(src.diagonalInches, cand.diagonalInches)) {
      return fail(
        screenSizeGateReason(src.diagonalInches, cand.diagonalInches),
        src,
        cand
      );
    }
    const tiered = screenSizeMatchQuality(src.diagonalInches, cand.diagonalInches);
    if (tiered.tier === "moderate") {
      softPenalties.push(`screen_size_moderate_penalty(${tiered.detail})`);
    } else if (tiered.tier === "strong") {
      softPenalties.push(`screen_size_strong_penalty(${tiered.detail})`);
    }
  }

  if (src.shoeSize != null && cand.shoeSize != null) {
    if (Math.abs(src.shoeSize - cand.shoeSize) >= 0.75) {
      return fail(`shoe_size_mismatch(${src.shoeSize} vs ${cand.shoeSize})`, src, cand);
    }
  } else if (src.sizeLabel && cand.sizeLabel && src.sizeLabel !== cand.sizeLabel) {
    return fail(`size_label_mismatch(${src.sizeLabel} vs ${cand.sizeLabel})`, src, cand);
  }

  if (src.packCount != null && cand.packCount != null && src.packCount !== cand.packCount) {
    const ratio = Math.max(src.packCount, cand.packCount) / Math.min(src.packCount, cand.packCount);
    if (ratio > 2 || Math.abs(src.packCount - cand.packCount) > 2) {
      return fail(`pack_count_mismatch(${src.packCount} vs ${cand.packCount})`, src, cand);
    }
  }

  if (src.capacity && cand.capacity && src.capacity !== cand.capacity) {
    return fail(`capacity_mismatch(${src.capacity} vs ${cand.capacity})`, src, cand);
  }

  const secondhand = (c: ProductCondition) =>
    c === "renewed" || c === "refurbished" || c === "used" || c === "open_box";
  if (!secondhand(src.condition) && secondhand(cand.condition)) {
    return fail(`condition_mismatch(${src.condition} vs ${cand.condition})`, src, cand);
  }

  return { ok: true, softPenalties };
}

function logDepartmentDetected(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): ProductDepartment {
  const department = toProductDepartment(source.category);
  console.log(
    "[DEPARTMENT_DETECTED]",
    JSON.stringify({
      sourceCategory: source.category,
      candidateCategory: candidate.category,
      department,
    })
  );
  return department;
}

function resolveDepartmentForGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct,
  options?: DepartmentGateOptions
): ProductDepartment {
  if (options?.selectedDepartment) {
    const department = compareFlowDepartmentToProductDepartment(
      options.selectedDepartment
    );
    console.log(
      "[DEPARTMENT_SELECTED]",
      JSON.stringify({
        selectedDepartment: options.selectedDepartment,
        productDepartment: department,
        sourceCategory: source.category,
        candidateCategory: candidate.category,
      })
    );
    return department;
  }
  return logDepartmentDetected(source, candidate);
}

function logDepartmentGatePass(department: string, detail: string): void {
  console.log("[DEPARTMENT_GATE_PASS]", JSON.stringify({ department, detail }));
}

function logDepartmentGateReject(department: string, reason: string): void {
  console.log("[DEPARTMENT_GATE_REJECT]", JSON.stringify({ department, reason }));
}

function logUniversalFallbackUsed(department: string, reason: string): void {
  console.log("[UNIVERSAL_FALLBACK_USED]", JSON.stringify({ department, reason }));
}

function checkPoolDepartmentGate(
  source: CriticalSpecsSnapshot,
  candidate: CriticalSpecsSnapshot,
  sourceNorm: NormalizedProduct,
  candidateNorm: NormalizedProduct,
  sourceTitle: string,
  candidateTitle: string
): CriticalSpecsGateResult | null {
  const srcAttrs = extractDepartmentAttributes(
    "pools_outdoor",
    sourceNorm,
    sourceTitle
  );
  const candAttrs = extractDepartmentAttributes(
    "pools_outdoor",
    candidateNorm,
    candidateTitle
  );
  const srcShape = srcAttrs.shape;
  const candShape = candAttrs.shape;
  if (poolShapesIncompatible(srcShape, candShape)) {
    return {
      ok: false,
      reason: `department_pool_shape_mismatch(source=${srcShape},candidate=${candShape})`,
    };
  }

  if (source.dimensionPairs.length === 0) return null;
  const srcPrimary = source.dimensionPairs[0]!;
  if (candidate.dimensionPairs.length === 0) {
    return {
      ok: true,
      softPenalties: [`department_pool_dimension_missing_soft(source=${srcPrimary.key})`],
    };
  }
  const candPrimary = candidate.dimensionPairs[0]!;
  if (poolDimensionsDrasticallyDifferent(srcPrimary.key, candPrimary.key)) {
    return {
      ok: false,
      reason: `department_pool_dimension_mismatch(source=${srcPrimary.key},candidate=${candPrimary.key})`,
    };
  }
  if (!pairsEquivalent(srcPrimary, candPrimary)) {
    return {
      ok: true,
      softPenalties: [
        `department_pool_dimension_partial(source=${srcPrimary.key},candidate=${candPrimary.key})`,
      ],
    };
  }
  return { ok: true, softPenalties: [] };
}

function checkScreenDepartmentGate(
  source: CriticalSpecsSnapshot,
  candidate: CriticalSpecsSnapshot
): CriticalSpecsGateResult {
  const evaluation = evaluateScreenSizeGate(
    source.diagonalInches,
    candidate.diagonalInches
  );
  logScreenSizeGate(source.diagonalInches, candidate.diagonalInches, evaluation);
  if (evaluation.action === "reject") {
    return {
      ok: false,
      reason: evaluation.hardRejectReason ?? evaluation.reason,
    };
  }
  return { ok: true, softPenalties: evaluation.softPenalties };
}

function checkApparelDepartmentGate(
  source: CriticalSpecsSnapshot,
  candidate: CriticalSpecsSnapshot,
  sourceNorm: NormalizedProduct,
  candidateNorm: NormalizedProduct
): CriticalSpecsGateResult | null {
  let applied = false;
  if (source.shoeSize != null) {
    applied = true;
    if (candidate.shoeSize == null || source.shoeSize !== candidate.shoeSize) {
      return {
        ok: false,
        reason: `department_apparel_shoe_size_mismatch(source=${source.shoeSize},candidate=${candidate.shoeSize})`,
      };
    }
  } else if (source.sizeLabel) {
    applied = true;
    if (!candidate.sizeLabel || source.sizeLabel !== candidate.sizeLabel) {
      return {
        ok: false,
        reason: `department_apparel_size_label_mismatch(source=${source.sizeLabel},candidate=${candidate.sizeLabel})`,
      };
    }
  }

  if (sourceNorm.gender) {
    applied = true;
    if (!candidateNorm.gender || sourceNorm.gender !== candidateNorm.gender) {
      return {
        ok: false,
        reason: `department_apparel_gender_mismatch(source=${sourceNorm.gender},candidate=${candidateNorm.gender})`,
      };
    }
  }

  const srcType = sourceNorm.structured.productType;
  if (srcType) {
    applied = true;
    const candType = candidateNorm.structured.productType;
    if (!candType || candType !== srcType) {
      return {
        ok: false,
        reason: `department_apparel_type_mismatch(source=${srcType},candidate=${candType})`,
      };
    }
  }
  return applied ? { ok: true, softPenalties: [] } : null;
}

function checkToolsDepartmentGate(
  source: CriticalSpecsSnapshot,
  candidate: CriticalSpecsSnapshot,
  sourceNorm: NormalizedProduct,
  candidateNorm: NormalizedProduct
): CriticalSpecsGateResult | null {
  let applied = false;
  if (source.modelKeys.length > 0) {
    applied = true;
    const candSet = new Set(candidate.modelKeys);
    const overlap = source.modelKeys.some((k) => candSet.has(k));
    if (!overlap) {
      return { ok: false, reason: "department_tools_model_mismatch" };
    }
  }
  if (sourceNorm.structured.toolVoltage) {
    applied = true;
    const cv = candidateNorm.structured.toolVoltage;
    if (!cv || cv !== sourceNorm.structured.toolVoltage) {
      return {
        ok: false,
        reason: `department_tools_voltage_mismatch(source=${sourceNorm.structured.toolVoltage},candidate=${cv})`,
      };
    }
  }
  if (sourceNorm.structured.toolBatteryKit != null) {
    applied = true;
    const cb = candidateNorm.structured.toolBatteryKit;
    if (cb == null || cb !== sourceNorm.structured.toolBatteryKit) {
      return {
        ok: false,
        reason: `department_tools_battery_kit_mismatch(source=${sourceNorm.structured.toolBatteryKit},candidate=${cb})`,
      };
    }
  }
  return applied ? { ok: true, softPenalties: [] } : null;
}

/**
 * Department-first strict gates. Returns null when no department gate applies,
 * so the universal matcher can continue unchanged as fallback.
 */
export function checkDepartmentCriticalSpecsGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct,
  candidateTitle: string,
  options?: DepartmentGateOptions
): CriticalSpecsGateResult | null {
  const department = resolveDepartmentForGate(source, candidate, options);
  const sourceTitle = source.structured.title;
  const src = buildCriticalSpecsSnapshot(source, sourceTitle);
  const cand = buildCriticalSpecsSnapshot(candidate, candidateTitle);

  let result: CriticalSpecsGateResult | null = null;
  if (department === "pool") {
    result = checkPoolDepartmentGate(
      src,
      cand,
      source,
      candidate,
      sourceTitle,
      candidateTitle
    );
  } else if (department === "screen") {
    result = checkScreenDepartmentGate(src, cand);
  } else if (department === "apparel") {
    result = checkApparelDepartmentGate(src, cand, source, candidate);
  } else if (department === "tools") {
    result = checkToolsDepartmentGate(src, cand, source, candidate);
  } else {
    logUniversalFallbackUsed(department, "generic_department");
    return null;
  }

  if (result == null) {
    logUniversalFallbackUsed(department, "missing_department_data");
    return null;
  }
  if (result.ok === true) {
    logDepartmentGatePass(department, "department_rules_satisfied");
  } else {
    logDepartmentGateReject(department, result.reason);
  }
  return result;
}

export function logCriticalSpecRejected(payload: {
  reason: string;
  sourceSpec: Record<string, unknown>;
  candidateSpec: Record<string, unknown>;
  title: string;
}): void {
  console.log("[CRITICAL_SPEC_REJECTED]", JSON.stringify(payload));
}

export function criticalSpecRejectPayload(
  gateReason: string,
  source: NormalizedProduct,
  candidate: NormalizedProduct,
  candidateTitle: string
): {
  reason: string;
  sourceSpec: Record<string, unknown>;
  candidateSpec: Record<string, unknown>;
  title: string;
} {
  const src = buildCriticalSpecsSnapshot(source, source.structured.title);
  const cand = buildCriticalSpecsSnapshot(candidate, candidateTitle);
  const detail = gateReason.startsWith("critical_spec:")
    ? gateReason.slice("critical_spec:".length).split("|")[0] ?? gateReason
    : gateReason;
  return {
    reason: detail,
    sourceSpec: specsSummary(src),
    candidateSpec: specsSummary(cand),
    title: candidateTitle.slice(0, 200),
  };
}

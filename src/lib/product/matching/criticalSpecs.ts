import { normalizeTitle } from "../normalize";
import type { NormalizedProduct, ProductCondition } from "../types";
import { buildUniversalMatchSnapshot } from "./snapshot";

export type CriticalSpecsGateResult = { ok: true } | { ok: false; reason: string };

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

function pairsEquivalent(a: DimensionPair, b: DimensionPair): boolean {
  if (a.key === b.key) return true;
  return dimensionClose(a.a, b.a) && dimensionClose(a.b, b.b);
}

function pairsConflict(source: DimensionPair[], candidate: DimensionPair[]): boolean {
  if (source.length === 0 || candidate.length === 0) return false;
  for (const sp of source) {
    for (const cp of candidate) {
      if (pairsEquivalent(sp, cp)) continue;
      const shareB = dimensionClose(sp.b, cp.b);
      const shareA = dimensionClose(sp.a, cp.a);
      if (shareB && !dimensionClose(sp.a, cp.a)) return true;
      if (shareA && !dimensionClose(sp.b, cp.b)) return true;
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

  if (src.dimensionPairs.length > 0) {
    const primary = src.dimensionPairs[0]!;
    if (cand.dimensionPairs.length > 0) {
      const exact = cand.dimensionPairs.some((p) => pairsEquivalent(p, primary));
      if (!exact) {
        if (pairsConflict(src.dimensionPairs, cand.dimensionPairs)) {
          return fail("dimension_pair_mismatch", src, cand);
        }
        return fail("dimension_pair_missing", src, cand);
      }
    } else if (!pairPresentInBlob(primary, candBlob)) {
      return fail("dimension_pair_unconfirmed", src, cand);
    }
  }

  if (src.diagonalInches != null && cand.diagonalInches != null) {
    if (src.diagonalInches !== cand.diagonalInches) {
      return fail(
        `diagonal_inches_mismatch(${src.diagonalInches} vs ${cand.diagonalInches})`,
        src,
        cand
      );
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

  return { ok: true };
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

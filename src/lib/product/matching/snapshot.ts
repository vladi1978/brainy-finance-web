import {
  extractDiagonalInches,
  detectDisplayDeviceKind,
  type DisplayDeviceKind,
} from "./displayDimensions";
import { inferTvFamilyFromFullModel } from "../normalize";
import type {
  NormalizedProduct,
  ProductCategory,
  ProductCondition,
  TvDisplayTechBucket,
  TvResolutionBucket,
} from "../types";

const TV_INCH_MIN = 20;
const TV_INCH_MAX = 120;
const MONITOR_INCH_MIN = 15;
const MONITOR_INCH_MAX = 60;

function screenKindForProduct(
  p: NormalizedProduct,
  blob: string
): DisplayDeviceKind | null {
  if (p.category === "tv") return "tv";
  if (p.category === "monitor") return "monitor";
  const detected = detectDisplayDeviceKind(blob);
  if (detected === "tv" || detected === "monitor") return detected;
  return null;
}

function inchInScreenRange(n: number, kind: DisplayDeviceKind): boolean {
  if (!Number.isFinite(n)) return false;
  if (kind === "monitor") return n >= MONITOR_INCH_MIN && n <= MONITOR_INCH_MAX;
  return n >= TV_INCH_MIN && n <= TV_INCH_MAX;
}

/** Parse inch count from critical listing dimension signatures (e.g. 50inch, 55, 75 inch). */
export function parseInchesFromDimensionSignature(sig: string): number | null {
  const s = sig.replace(/\s+/g, " ").trim().toLowerCase();
  if (!s || s.includes("x")) return null;

  const inchWord = s.match(/^(\d{2,3})\s*-?\s*in(?:ch(?:es)?)?$/);
  if (inchWord) return parseInt(inchWord[1]!, 10);

  const inchSuffix = s.match(/^(\d{2,3})inch$/);
  if (inchSuffix) return parseInt(inchSuffix[1]!, 10);

  const bare = s.match(/^(\d{2,3})$/);
  if (bare) return parseInt(bare[1]!, 10);

  return null;
}

function diagonalFromCriticalSignatures(
  p: NormalizedProduct,
  kind: DisplayDeviceKind
): number | null {
  const sigs = p.critical?.dimensionSignatures;
  if (!sigs?.length) return null;

  const candidates: number[] = [];
  for (const sig of sigs) {
    const n = parseInchesFromDimensionSignature(sig);
    if (n != null && inchInScreenRange(n, kind)) candidates.push(n);
  }
  if (candidates.length === 0) return null;

  const freq = new Map<number, number>();
  for (const c of candidates) {
    freq.set(c, (freq.get(c) ?? 0) + 1);
  }
  let best = candidates[0]!;
  let bestCount = 0;
  for (const [inch, count] of freq) {
    if (count > bestCount || (count === bestCount && inch > best)) {
      best = inch;
      bestCount = count;
    }
  }
  return best;
}
/**
 * Normalized snapshot used only by the universal matcher — easy to extend with
 * embeddings / taxonomy IDs later without changing `NormalizedProduct`.
 */
export type UniversalMatchSnapshot = {
  category: ProductCategory;
  titleNorm: string;
  brand: string | null;
  modelTokensNorm: string[];
  fullModelNorm: string | null;
  modelFamilyNorm: string | null;
  diagonalInches: number | null;
  sizeLabel: string | null;
  resolutionTier: TvResolutionBucket;
  displayPanel: TvDisplayTechBucket;
  smartTv: boolean | null;
  productType: string | null;
  toolVoltage: string | null;
  toolBatteryKit: boolean | null;
  condition: ProductCondition;
  packCount: number | null;
  gender: string | null;
  color: string | null;
  tvModelFamilyTokens: string[];
};

function normSku(s: string | null | undefined): string {
  if (!s) return "";
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function resolveDiagonalInches(p: NormalizedProduct): number | null {
  const fromStructured = stSize(p);
  if (fromStructured != null) return fromStructured;
  const blob = `${p.structured.title} ${p.titleNorm}`;
  const kind =
    p.category === "tv"
      ? "tv"
      : p.category === "monitor"
        ? "monitor"
        : detectDisplayDeviceKind(blob);
  const fromTitle = extractDiagonalInches(blob, { deviceKind: kind });
  if (fromTitle != null) return fromTitle;

  const screenKind = screenKindForProduct(p, blob);
  if (screenKind == null) return null;
  return diagonalFromCriticalSignatures(p, screenKind);
}

function stSize(p: NormalizedProduct): number | null {
  return p.structured.sizeInches ?? p.sizeInches ?? null;
}

export function buildUniversalMatchSnapshot(p: NormalizedProduct): UniversalMatchSnapshot {
  const st = p.structured;
  const tvToks = (p.tv?.modelFamilyTokens ?? []).map((t) =>
    t.toLowerCase().replace(/[^a-z0-9]/g, "")
  );
  return {
    category: p.category,
    titleNorm: p.titleNorm,
    brand: p.brand,
    modelTokensNorm: p.modelTokens.map((t) => t.replace(/-/g, "").toLowerCase()),
    fullModelNorm: st.fullModel ? normSku(st.fullModel) : null,
    modelFamilyNorm: st.modelFamily ? normSku(st.modelFamily) : null,
    diagonalInches: resolveDiagonalInches(p),
    sizeLabel: st.sizeLabel,
    resolutionTier: st.resolution,
    displayPanel: st.displayType,
    smartTv: st.smartTv,
    productType: st.productType,
    toolVoltage: st.toolVoltage,
    toolBatteryKit: st.toolBatteryKit,
    condition: st.condition,
    packCount: st.packCount ?? p.packCount,
    gender: st.gender ?? p.gender,
    color: st.color,
    tvModelFamilyTokens: tvToks.filter((t) => t.length >= 4).slice(0, 16),
  };
}

export function snapshotSearchBlob(s: UniversalMatchSnapshot): string {
  const parts = [
    s.titleNorm,
    s.fullModelNorm,
    s.modelFamilyNorm,
    ...s.modelTokensNorm,
    ...s.tvModelFamilyTokens,
  ];
  return normSku(parts.filter(Boolean).join(" "));
}

export function modelNeedlesFromSnapshot(s: UniversalMatchSnapshot): string[] {
  const out = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const n = normSku(raw ?? "");
    if (n.length >= 4) out.add(n);
  };
  add(inferTvFamilyFromFullModel(s.fullModelNorm));
  add(s.modelFamilyNorm);
  add(s.fullModelNorm);
  for (const t of s.tvModelFamilyTokens) add(t);
  for (const t of s.modelTokensNorm) {
    const u = normSku(t);
    if (u.length >= 4) out.add(u);
  }
  return [...out];
}

/** Word-boundary aware check so bare inch counts do not match inside larger numbers. */
export function blobHasSignature(blob: string, sig: string): boolean {
  if (/^\d{1,3}$/.test(sig)) {
    return new RegExp(`\\b${sig}\\b`).test(blob);
  }
  return blob.includes(sig);
}

export function tokenContainmentRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  let inter = 0;
  for (const x of b) {
    if (sa.has(x)) inter += 1;
  }
  return inter / Math.min(a.length, b.length);
}

export function titleOverlapScore(a: UniversalMatchSnapshot, b: UniversalMatchSnapshot): number {
  const ta = a.titleNorm.split(/\s+/).filter((w) => w.length >= 3);
  const tb = b.titleNorm.split(/\s+/).filter((w) => w.length >= 3);
  return tokenContainmentRatio(ta, tb);
}

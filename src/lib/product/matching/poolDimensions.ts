import { normalizeTitle } from "../normalize";
import { parseDimensionPairs } from "./criticalSpecs";

export type ParsedPoolDimensions = {
  shape: string | null;
  diameterFt: number | null;
  depthInches: number | null;
  dimensionPairKey: string | null;
};

const POOL_SHAPE_RE =
  /\b(round|oval|rectangular|rectangle|square|octagon)\b/i;

const FT_BEFORE_ROUND_RE =
  /\b(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\s+(?:round|circular|circle)\b/i;

const ROUND_BEFORE_FT_RE =
  /\b(?:round|circular|circle)\s+(?:above\s*ground\s+)?(?:pool\s+)?(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\b/i;

const FT_DEPTH_RE =
  /\b(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\s*(?:deep|depth|tall|high)\b/i;

const INCH_WALL_RE =
  /\b(\d+(?:\.\d+)?)\s*(?:in|inch|inches|"|″)\b/gi;

function canonicalPoolText(raw: string): string {
  return raw
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2032/g, "'")
    .replace(/\u2033/g, '"');
}

export function extractPoolShape(title: string): string | null {
  const m = normalizeTitle(title).match(POOL_SHAPE_RE);
  return m ? m[1]!.toLowerCase() : null;
}

function isRoundPoolTitle(title: string, shape: string | null): boolean {
  if (shape === "round") return true;
  return /\b(round|circular|circle)\b/i.test(normalizeTitle(title));
}

function parseDiameterFromRoundPhrases(title: string): number | null {
  const raw = canonicalPoolText(title);
  const m1 = raw.match(FT_BEFORE_ROUND_RE);
  if (m1) {
    const v = parseFloat(m1[1]!);
    if (Number.isFinite(v) && v > 0 && v <= 60) return v;
  }
  const m2 = raw.match(ROUND_BEFORE_FT_RE);
  if (m2) {
    const v = parseFloat(m2[1]!);
    if (Number.isFinite(v) && v > 0 && v <= 60) return v;
  }
  return null;
}

function parseDepthInchesFromTitle(
  title: string,
  diameterFt: number | null,
  pairKey: string | null
): number | null {
  const raw = canonicalPoolText(title);

  if (pairKey) {
    const parts = pairKey.split("x");
    if (parts.length === 2) {
      const a = parseFloat(parts[0]!);
      const b = parseFloat(parts[1]!);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        if (diameterFt != null && Math.abs(a - diameterFt) < 0.01 && b >= 20 && b <= 120) {
          return b;
        }
        if (diameterFt != null && Math.abs(b - diameterFt) < 0.01 && a >= 20 && a <= 120) {
          return a;
        }
        const wall = Math.max(a, b);
        const diam = Math.min(a, b);
        if (diam <= 40 && wall >= 20 && wall <= 120) {
          return wall;
        }
      }
    }
  }

  const depthFt = raw.match(FT_DEPTH_RE);
  if (depthFt) {
    const ft = parseFloat(depthFt[1]!);
    if (Number.isFinite(ft) && ft > 0) return Math.round(ft * 12);
  }

  const inchCandidates: number[] = [];
  for (const m of raw.matchAll(INCH_WALL_RE)) {
    const n = parseFloat(m[1]!);
    if (Number.isFinite(n) && n >= 20 && n <= 120) {
      inchCandidates.push(n);
    }
  }
  if (inchCandidates.length === 0) return null;
  return inchCandidates[inchCandidates.length - 1]!;
}

/** Parse pool diameter (ft), wall depth (in), and shape from listing title + structured title. */
export function parsePoolDimensions(
  title: string,
  structuredTitle?: string
): ParsedPoolDimensions {
  const blob = `${title} ${structuredTitle ?? ""}`.trim();
  const shape = extractPoolShape(blob);
  const pairs = parseDimensionPairs(blob);
  const dimensionPairKey = pairs.length > 0 ? pairs[0]!.key : null;

  let diameterFt = parseDiameterFromRoundPhrases(blob);
  const round = isRoundPoolTitle(blob, shape);

  if (diameterFt == null && round && dimensionPairKey) {
    const parts = dimensionPairKey.split("x");
    if (parts.length === 2) {
      const a = parseFloat(parts[0]!);
      const b = parseFloat(parts[1]!);
      if (Number.isFinite(a) && a > 0 && a <= 60) {
        diameterFt = a;
      } else if (Number.isFinite(b) && b > 0 && b <= 60) {
        diameterFt = b;
      }
    }
  }

  const depthInches = parseDepthInchesFromTitle(blob, diameterFt, dimensionPairKey);

  return {
    shape,
    diameterFt: round ? diameterFt : null,
    depthInches,
    dimensionPairKey,
  };
}

export function poolDiametersMateriallyDifferent(
  sourceFt: number,
  candidateFt: number
): boolean {
  return Math.abs(sourceFt - candidateFt) > 0.01;
}

/** Wall depth mismatch beyond close-alternative tolerance (e.g. 52in vs 48in). */
export function poolDepthsMateriallyDifferent(
  sourceIn: number,
  candidateIn: number
): boolean {
  if (sourceIn === candidateIn) return false;
  const delta = Math.abs(sourceIn - candidateIn);
  if (delta <= 2) return false;
  const denom = Math.max(sourceIn, candidateIn, 1);
  return delta > 2 || delta / denom > 0.04;
}

export function poolSpecsSummary(spec: ParsedPoolDimensions): Record<string, unknown> {
  return {
    shape: spec.shape,
    diameterFt: spec.diameterFt,
    depthInches: spec.depthInches,
    dimensionPairKey: spec.dimensionPairKey,
  };
}

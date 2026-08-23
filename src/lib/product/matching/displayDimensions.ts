import { normalizeTitle } from "../normalize";

export type DisplayDeviceKind = "tv" | "monitor" | "laptop" | null;

export type ParsedDisplayDimensions = {
  deviceKind: DisplayDeviceKind;
  diagonalInches: number | null;
  /** Normalized model tokens (e.g. qn90c, u6sf, oled55) */
  modelNumbers: string[];
};

export type ScreenSizeDeltaTier = "exact" | "moderate" | "strong" | "reject";

const TV_INCH_MIN = 20;
const TV_INCH_MAX = 120;
const MONITOR_INCH_MIN = 15;
const MONITOR_INCH_MAX = 60;
const LAPTOP_INCH_MIN = 10;
const LAPTOP_INCH_MAX = 22;

function canonicalTitleForParsing(raw: string): string {
  return raw
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2032/g, "'")
    .replace(/\u2033/g, '"')
    .replace(/[–—]/g, "-");
}

function inchInRange(n: number, kind: DisplayDeviceKind): boolean {
  if (!Number.isFinite(n)) return false;
  if (kind === "laptop") return n >= LAPTOP_INCH_MIN && n <= LAPTOP_INCH_MAX;
  if (kind === "monitor") return n >= MONITOR_INCH_MIN && n <= MONITOR_INCH_MAX;
  return n >= TV_INCH_MIN && n <= TV_INCH_MAX;
}

function roundInch(n: number): number {
  return Math.round(n * 10) / 10;
}

/** TVs, monitors, laptops from title cues. */
export function detectDisplayDeviceKind(title: string): DisplayDeviceKind {
  const n = normalizeTitle(title);
  if (/\b(laptop|notebook|macbook|chromebook|ultrabook)\b/.test(n)) return "laptop";
  if (/\bmonitor\b/.test(n)) return "monitor";
  if (
    /\b(smart\s*tv|television|\btv\b|oled\s*tv|qled\s*tv|uhd\s*tv|neo\s*qled)\b/.test(n) ||
    (/\b(oled|qled|neo\s*qled|mini\s*led)\b/.test(n) && /\b\d{2,3}\b/.test(n))
  ) {
    return "tv";
  }
  return null;
}

function normalizeModelToken(raw: string): string {
  return raw.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/** Model-like codes: QN90C, 75U6SF, OLED55, UN75TU690. */
export function extractDisplayModelNumbers(title: string): string[] {
  const norm = normalizeTitle(title);
  const out = new Set<string>();

  for (const m of norm.matchAll(
    /\b(?:qn|un|xr|oled|qled|neoqled|u\d)?(\d{2,3})[a-z0-9]{1,6}\b/gi
  )) {
    const tok = normalizeModelToken(m[0]!);
    if (tok.length >= 4) out.add(tok);
  }
  for (const m of norm.matchAll(/\b(oled|qled|neoqled)(\d{2,3})\b/gi)) {
    out.add(normalizeModelToken(`${m[1]}${m[2]}`));
  }
  for (const m of norm.matchAll(/\b(qn|un|xr)(\d{2,3})[a-z0-9]*\b/gi)) {
    out.add(normalizeModelToken(m[0]!));
  }
  for (const m of norm.matchAll(/\b(\d{2,3})([a-z]\d[a-z0-9]{2,})\b/gi)) {
    out.add(normalizeModelToken(m[0]!));
  }

  return [...out].slice(0, 16);
}

function tryInch(n: number, kind: DisplayDeviceKind): number | null {
  const rounded = roundInch(n);
  return inchInRange(rounded, kind) ? rounded : null;
}

/**
 * Parse screen diagonal (inches) from TVs, monitors, and laptops.
 * Handles 75", 75-inch, 75in, Class 75, OLED55, 75U6SF, QN65QN90C, etc.
 */
export function extractDiagonalInches(
  title: string,
  hints?: { deviceKind?: DisplayDeviceKind }
): number | null {
  const kind = hints?.deviceKind ?? detectDisplayDeviceKind(title);
  const norm = canonicalTitleForParsing(title);
  const candidates: number[] = [];

  const push = (raw: string | undefined) => {
    if (!raw) return;
    const n = parseFloat(raw);
    const v = tryInch(n, kind);
    if (v != null) candidates.push(v);
  };

  // Do not require a word-boundary after " — `"75" Class` has no \b between " and space.
  for (const m of norm.matchAll(/\b(\d{2,3})\s*(?:"|″)/g)) push(m[1]);
  for (const m of norm.matchAll(/\b(\d{2,3})\s*-?\s*in(?:ch(?:es)?)?\b/gi)) push(m[1]);
  for (const m of norm.matchAll(/\b(\d{2,3})in\b/gi)) push(m[1]);
  for (const m of norm.matchAll(/\b(\d{2,3})\s*-?\s*class\b/gi)) push(m[1]);
  for (const m of norm.matchAll(/\bclass\s+(\d{2,3})\b/gi)) push(m[1]);

  if (kind === "laptop") {
    for (const m of norm.matchAll(/\b(\d{1,2}(?:\.\d)?)\s*-?\s*in(?:ch(?:es)?)?\b/gi)) {
      push(m[1]);
    }
    for (const m of norm.matchAll(/\b(\d{1,2}(?:\.\d)?)\s*(?:"|″)/g)) push(m[1]);
  }

  const oledInline = norm.match(/\b(?:oled|qled|neo\s*qled|mini\s*led)\s*(\d{2,3})\b/i);
  if (oledInline) push(oledInline[1]);
  // OLED55C4 / QLED65x — size digits may be followed by series letters.
  for (const m of norm.matchAll(/\b(oled|qled|neoqled)(\d{2,3})[a-z0-9]*\b/gi)) {
    push(m[2]);
  }

  const qn = norm.match(/\bQN(\d{2,3})\b/i);
  if (qn) push(qn[1]);
  const un = norm.match(/\bUN(\d{2,3})\b/i);
  if (un) push(un[1]);
  const xr = norm.match(/\bXR(\d{2,3})\b/i);
  if (xr) push(xr[1]);

  // Size-leading model codes: 75U6SF, 65QN90C (letter run then digit, not only Letter+Digit).
  for (const m of norm.matchAll(/\b(\d{2,3})([A-Za-z]{1,4}\d[A-Za-z0-9]{0,6})\b/g)) {
    push(m[1]);
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

export function parseDisplayDimensions(
  title: string,
  hints?: { deviceKind?: DisplayDeviceKind }
): ParsedDisplayDimensions {
  const deviceKind = hints?.deviceKind ?? detectDisplayDeviceKind(title);
  return {
    deviceKind,
    diagonalInches: extractDiagonalInches(title, { deviceKind }),
    modelNumbers: extractDisplayModelNumbers(title),
  };
}

export function screenSizeDelta(a: number, b: number): number {
  return Math.abs(a - b);
}

export function screenSizeDeltaTier(delta: number): ScreenSizeDeltaTier {
  if (delta === 0) return "exact";
  if (delta <= 2) return "moderate";
  if (delta <= 5) return "strong";
  return "reject";
}

export function screenSizeShouldHardReject(
  sourceInches: number,
  candidateInches: number
): boolean {
  return screenSizeDeltaTier(screenSizeDelta(sourceInches, candidateInches)) === "reject";
}

/** Scoring quality 0–1 from diagonal delta tier. */
export function screenSizeMatchQuality(
  sourceInches: number | null,
  candidateInches: number | null
): { q: number; detail: string; tier: ScreenSizeDeltaTier | "unknown" } {
  if (sourceInches == null || candidateInches == null) {
    return { q: 0.74, detail: "screen_size_unknown_side", tier: "unknown" };
  }
  const delta = screenSizeDelta(sourceInches, candidateInches);
  const tier = screenSizeDeltaTier(delta);
  if (tier === "exact") {
    return { q: 1, detail: "screen_size_exact", tier };
  }
  if (tier === "moderate") {
    return { q: 0.58, detail: `screen_size_close_moderate(delta=${delta})`, tier };
  }
  if (tier === "strong") {
    return { q: 0.15, detail: `screen_size_close_strong(delta=${delta})`, tier };
  }
  return { q: 0.02, detail: `screen_size_mismatch(delta=${delta})`, tier };
}

export function screenSizeGateReason(
  sourceInches: number,
  candidateInches: number
): string {
  const delta = screenSizeDelta(sourceInches, candidateInches);
  return `screen_size_mismatch(source=${sourceInches},candidate=${candidateInches},delta=${delta})`;
}

export const SCREEN_SIZE_MISSING_SCORE_PENALTY = 10;
export const SCREEN_SIZE_BOTH_MISSING_SCORE_PENALTY = 20;

export type ScreenSizeGateAction = "pass" | "penalty" | "reject";

export type ScreenSizeGateEvaluation = {
  action: ScreenSizeGateAction;
  reason: string;
  softPenalties: string[];
  hardRejectReason?: string;
};

/** Department/universal screen size gate — missing sizes are penalized, not rejected. */
export function evaluateScreenSizeGate(
  sourceInches: number | null,
  candidateInches: number | null
): ScreenSizeGateEvaluation {
  if (sourceInches == null && candidateInches == null) {
    return {
      action: "penalty",
      reason: "both_sizes_missing",
      softPenalties: [
        `department_screen_size_both_missing_soft(-${SCREEN_SIZE_BOTH_MISSING_SCORE_PENALTY})`,
      ],
    };
  }
  if (sourceInches == null || candidateInches == null) {
    return {
      action: "penalty",
      reason:
        sourceInches == null ? "source_size_missing" : "candidate_size_missing",
      softPenalties: [
        `department_screen_size_missing_soft(-${SCREEN_SIZE_MISSING_SCORE_PENALTY})`,
      ],
    };
  }
  if (screenSizeShouldHardReject(sourceInches, candidateInches)) {
    const reason = screenSizeGateReason(sourceInches, candidateInches);
    return {
      action: "reject",
      reason,
      softPenalties: [],
      hardRejectReason: reason,
    };
  }
  const softPenalties: string[] = [];
  const tiered = screenSizeMatchQuality(sourceInches, candidateInches);
  if (tiered.tier === "moderate") {
    softPenalties.push(`department_screen_size_moderate(${tiered.detail})`);
  } else if (tiered.tier === "strong") {
    softPenalties.push(`department_screen_size_strong(${tiered.detail})`);
  }
  return {
    action: softPenalties.length > 0 ? "penalty" : "pass",
    reason:
      softPenalties.length > 0
        ? softPenalties[0]!
        : "exact_or_within_tolerance",
    softPenalties,
  };
}

export function logScreenSizeGate(
  sourceInches: number | null,
  candidateInches: number | null,
  evaluation: ScreenSizeGateEvaluation
): void {
  console.log(
    "[SCREEN_SIZE_GATE]",
    JSON.stringify({
      sourceSize: sourceInches,
      candidateSize: candidateInches,
      action: evaluation.action,
      reason: evaluation.reason,
    })
  );
}

/** User-facing line for match cards / department explanations. */
export function screenSizeExplanation(
  sourceInches: number | null,
  candidateInches: number | null
): string | null {
  if (sourceInches == null || candidateInches == null) return null;
  const tier = screenSizeDeltaTier(screenSizeDelta(sourceInches, candidateInches));
  if (tier === "exact") return "Exact screen size matched";
  if (tier === "reject" || tier === "strong" || tier === "moderate") {
    return "Screen size mismatch";
  }
  return null;
}

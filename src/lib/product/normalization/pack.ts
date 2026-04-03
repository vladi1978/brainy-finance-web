import { normalizeText } from "./text";

export function extractPackCount(text: string): number | null {
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

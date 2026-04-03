import { normalizeText } from "./text";

export type TvSignals = {
  inches: number | null;
  resolution: "4k" | "8k" | "fhd" | "other" | null;
  display: "qled" | "oled" | "mini_led" | "led" | null;
  smartTv: boolean | null;
  modelTokens: string[];
};

/** Detect TV listings (including “65-Inch QLED …” without the word “TV”). */
export function isTvProduct(text: string): boolean {
  const n = normalizeText(text);
  if (/\b(tv|television|smart\s*tv|hdtv)\b/i.test(n)) return true;
  if (/\b(qled|oled|mini\s*led)\b/i.test(n)) return true;
  if (/\b(\d{2,3})\s*(?:inch|inches|in\b|")\b/i.test(n)) {
    if (/\b(qled|oled|mini\s*led|led|uhd|4k|8k|hdr|smart)\b/i.test(n))
      return true;
  }
  if (/\b(4k|8k|uhd)\b/i.test(n) && /\b(class|series)\b/i.test(n)) return true;
  return false;
}

function extractInches(text: string): number | null {
  const n = normalizeText(text);
  const patterns = [
    /\b(\d{2,3})\s*(?:inch|inches)\b/i,
    /\b(\d{2,3})\s*inch\b/i,
    /\b(\d{2,3})\s*in\b(?![a-z])/i,
    /\b(\d{2,3})\s*"/,
    /"\s*(\d{2,3})\b/,
  ];
  for (const re of patterns) {
    const m = n.match(re);
    if (m?.[1]) {
      const v = parseInt(m[1], 10);
      if (v >= 24 && v <= 120) return v;
    }
  }
  return null;
}

function extractResolution(text: string): TvSignals["resolution"] {
  const n = normalizeText(text);
  if (/\b8k\b/i.test(n)) return "8k";
  if (/\b(4k|uhd|ultra\s*hd)\b/i.test(n)) return "4k";
  if (/\b(1080p|fhd|full\s*hd)\b/i.test(n)) return "fhd";
  return null;
}

function extractDisplayType(text: string): TvSignals["display"] {
  const n = normalizeText(text);
  if (/\bmini\s*led\b/i.test(n)) return "mini_led";
  if (/\bqled\b/i.test(n)) return "qled";
  if (/\boled\b/i.test(n)) return "oled";
  if (/\bled\b/i.test(n)) return "led";
  return null;
}

function extractSmartTv(text: string): boolean | null {
  const n = normalizeText(text);
  if (
    /\b(smart\s*tv|smarttv|roku\s*tv|fire\s*tv|google\s*tv|webos|tizen|vidaa)\b/i.test(
      n
    )
  )
    return true;
  if (/\b(non[\s-]*smart|without\s*smart)\b/i.test(n)) return false;
  return null;
}

function extractModelTokens(text: string): string[] {
  const n = normalizeText(text);
  const out = new Set<string>();
  if (/\bneo\s*qled\b/i.test(n)) out.add("neoqled");
  const re =
    /\b([a-z]{1,4}\d{2,4}[a-z0-9]*|[a-z]{1,3}\d[a-z]\d+[a-z0-9]*)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(n)) !== null) {
    const t = m[1].replace(/-/g, "");
    const inchOnly = /^\d{2,3}$/.test(t);
    if (!inchOnly && t.length >= 3) out.add(t.toLowerCase());
  }
  return [...out];
}

export function extractTvSignals(text: string): TvSignals {
  return {
    inches: extractInches(text),
    resolution: extractResolution(text),
    display: extractDisplayType(text),
    smartTv: extractSmartTv(text),
    modelTokens: extractModelTokens(text),
  };
}

export function modelFamilyKey(token: string): string {
  const t = token.toLowerCase().replace(/-/g, "");
  const m = t.match(/^([a-z]{1,4}\d{2,4})/);
  if (m) return m[1];
  const m2 = t.match(/^([a-z]+\d)/);
  return m2 ? m2[1] : t;
}

export function familiesOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const fa = new Set(a.map(modelFamilyKey));
  const fb = new Set(b.map(modelFamilyKey));
  for (const x of fa) {
    if (fb.has(x)) return true;
  }
  return false;
}

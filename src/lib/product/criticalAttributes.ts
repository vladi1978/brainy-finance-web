import { parseDimensionPairs } from "./matching/criticalSpecs";
import { normalizeTitle } from "./normalize";
import type { CriticalListingAttributes, NormalizedProduct } from "./types";

function isPoolCategory(category: NormalizedProduct["category"]): boolean {
  return (
    category === "pool" ||
    category === "outdoor_pool" ||
    category === "swimming_pool"
  );
}

const ACCESSORY_RULES: { re: RegExp; stems: string[] }[] = [
  { re: /\b(pump|bomba)\b/i, stems: ["pump"] },
  { re: /\b(filter|filtro)\b/i, stems: ["filter"] },
  { re: /\b(ladder|escalera)\b/i, stems: ["ladder"] },
  { re: /\b(cover|cubre|tapa)\b/i, stems: ["cover"] },
  { re: /\bchlorinator\b/i, stems: ["chlorinator"] },
  { re: /\bsaltwater\b/i, stems: ["salt"] },
  { re: /\b(chemical\s*kit|kit\s+de\s+bomba|pump\s*kit)\b/i, stems: ["kit"] },
];

function dimensionSignaturesFromText(raw: string): string[] {
  const t = raw.replace(/\u2033/g, '"').replace(/\u2032/g, "'");
  const sigs = new Set<string>();

  for (const p of parseDimensionPairs(t)) {
    sigs.add(p.key);
  }

  for (const m of t.matchAll(/\b(\d{2,3})\s*(?:"|''|′′|inches?\b|inch\b|-inch)\b/gi)) {
    const n = m[1]!;
    sigs.add(`${n}inch`);
    sigs.add(`${n} inch`);
    sigs.add(`${n}`);
  }

  for (const m of t.matchAll(/\b(\d{2,3})\s*-?\s*class\b/gi)) {
    sigs.add(`${m[1]}inch`);
    sigs.add(`${m[1]} inch`);
    sigs.add(`${m[1]}`);
  }

  const n = normalizeTitle(t);
  for (const m of n.matchAll(/\bsize\s+(\d{1,2}(?:\.\d)?)\b/gi)) {
    sigs.add(`size ${m[1]}`);
    sigs.add(m[1]!);
  }

  return [...sigs].filter((s) => s.length >= 2).slice(0, 12);
}

function kindPhrasesFromText(norm: NormalizedProduct, raw: string): string[] {
  const n = normalizeTitle(raw);
  const out: string[] = [];

  if (norm.category === "tv") {
    out.push("tv");
    if (/\bsmart\b/.test(n)) out.push("smart tv");
  }
  if (norm.category === "monitor") out.push("monitor");

  if (isPoolCategory(norm.category)) {
    if (/\babove[\s-]+ground[\s-]+pool\b/.test(n)) {
      out.push("above ground pool");
    }
    if (/\bin[\s-]?ground\s+pool\b/.test(n)) {
      out.push("in ground pool");
    }
    if (/\bpool\b/.test(n) && !out.some((p) => p.includes("pool"))) {
      out.push("pool");
    }
  }

  if (/\b(shoe|sneaker|boot|sandal)\b/.test(n)) out.push("shoe");

  if (/\b(headphone|earbud|airpods|ear buds)\b/.test(n)) {
    out.push("headphone");
  }

  const cat = norm.category;
  if (cat === "household") out.push("cleaner");
  if (cat === "socks") out.push("sock");
  if (cat === "apparel") out.push("shirt");
  if (cat === "footwear" && !out.includes("shoe")) out.push("shoe");
  if (cat === "audio" && !out.some((p) => p.includes("headphone"))) {
    out.push("speaker");
  }

  return [...new Set(out)].filter(Boolean);
}

function accessoryMustIncludeFromText(
  raw: string,
  category: NormalizedProduct["category"]
): string[] {
  if (!isPoolCategory(category)) return [];
  const out = new Set<string>();
  for (const rule of ACCESSORY_RULES) {
    if (rule.re.test(raw)) {
      for (const s of rule.stems) out.add(s);
    }
  }
  return [...out];
}

export function buildCriticalListingAttributes(
  rawText: string,
  norm: NormalizedProduct
): CriticalListingAttributes {
  const dimensionSignatures = dimensionSignaturesFromText(rawText);
  const kindPhrases = kindPhrasesFromText(norm, rawText);
  const accessoryMustInclude = accessoryMustIncludeFromText(
    rawText,
    norm.category
  );
  return {
    dimensionSignatures,
    kindPhrases,
    accessoryMustInclude,
  };
}

/**
 * Attaches `critical` to a normalized profile for gate evaluation.
 */
export function withCriticalAttributes(
  rawText: string,
  norm: NormalizedProduct
): NormalizedProduct {
  const critical = buildCriticalListingAttributes(rawText, norm);
  const empty =
    critical.dimensionSignatures.length === 0 &&
    critical.kindPhrases.length === 0 &&
    critical.accessoryMustInclude.length === 0;
  if (empty) return norm;
  return { ...norm, critical };
}

export function buildCriticalShoppingCoreSegments(
  norm: NormalizedProduct,
  referenceTitle: string
): string[] {
  const raw = `${referenceTitle} ${norm.structured.title}`;
  const segs: string[] = [];

  for (const d of dimensionSignaturesFromText(raw)) {
    if (d.includes("x")) segs.push(d);
  }
  const inch = raw.match(/\b(\d{2,3})\s*(?:"|inch|inches)\b/i);
  if (inch?.[1]) segs.push(`${inch[1]} inch`);

  for (const p of accessoryMustIncludeFromText(raw, norm.category)) {
    segs.push(p);
  }

  for (const k of kindPhrasesFromText(norm, raw)) {
    if (k.length >= 4 || k === "tv") segs.push(k);
  }

  if (norm.category === "tv" && norm.structured.displayType) {
    segs.push(String(norm.structured.displayType).replace(/_/g, " "));
  }
  return [...new Set(segs.map((s) => s.trim()).filter(Boolean))];
}

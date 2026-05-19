/**
 * Universal manual product form → compact normalization title + retailer query pack.
 * Link-based compare continues to use `parseProductInput` + PDP scrape; this path only
 * applies when the user has no URL.
 */

export type ManualProductFormFields = {
  link?: string | null;
  brand?: string | null;
  productNameOrModel?: string | null;
  category?: string | null;
  sizeDimensionsCapacity?: string | null;
  colorVariant?: string | null;
  keyFeatures?: string | null;
  pricePaid?: string | null;
};

function squish(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function joinParts(parts: (string | null | undefined)[]): string {
  return squish(parts.filter((p) => p && String(p).trim()).join(" "));
}

export function normalizeManualProductForm(
  raw: unknown
): ManualProductFormFields | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pick = (k: string): string => {
    const v = o[k];
    if (typeof v === "string") return v;
    if (v == null) return "";
    return String(v);
  };
  const name =
    pick("productNameOrModel").trim() ||
    pick("productName").trim() ||
    pick("model").trim();

  return {
    link: pick("link").trim() || null,
    brand: pick("brand").trim() || null,
    productNameOrModel: name || null,
    category: pick("category").trim() || null,
    sizeDimensionsCapacity:
      pick("sizeDimensionsCapacity").trim() || pick("size").trim() || null,
    colorVariant:
      pick("colorVariant").trim() || pick("color").trim() || null,
    keyFeatures: pick("keyFeatures").trim() || null,
    pricePaid: pick("pricePaid").trim() || null,
  };
}

export function manualFormHasSearchableCore(f: ManualProductFormFields): boolean {
  return Boolean(
    joinParts([f.brand, f.productNameOrModel, f.category]).length >= 2
  );
}

export function truncateFeatures(s: string, maxLen: number): string {
  const t = squish(s);
  if (!t.length || maxLen <= 0) return "";
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen);
  return cut.replace(/\s+\S*$/, "").trim();
}

/** Full compact title for `buildNormalizedProduct` — not the primary retailer query. */
export function buildManualNormalizationTitle(f: ManualProductFormFields): string {
  const features = truncateFeatures(f.keyFeatures ?? "", 160);
  return joinParts([
    f.brand,
    f.productNameOrModel,
    f.category,
    f.sizeDimensionsCapacity,
    f.colorVariant,
    features,
  ]);
}

export const REFERENCE_PRICE_REQUIRED_MESSAGE =
  "Enter the price you found so Brainy can compare cheaper options.";

export function parsePricePaidRaw(raw: string | null | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = parseFloat(raw.replace(/[$,]/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function isValidReferencePriceInput(
  raw: string | null | undefined
): boolean {
  return parsePricePaidRaw(raw) != null;
}

type ManualQueryPack = {
  primaryQuery: string;
  simplifiedQuery: string;
  specsQuery: string;
};

function ensureQueryChain(primary: string, fallbacks: string[]): string {
  const t = squish(primary);
  if (t.length >= 2) return t;
  for (const f of fallbacks) {
    const u = squish(f);
    if (u.length >= 2) return u;
  }
  return t.length ? t : "product";
}

/**
 * Maps to engine query order:
 * - primaryQuery: brand + product name/model
 * - simplifiedQuery: brand + category + size (specs-oriented)
 * - specsQuery: category + size + key features (broad)
 */
export function buildUniversalManualQueryPack(
  f: ManualProductFormFields
): ManualQueryPack {
  const primaryRaw = joinParts([f.brand, f.productNameOrModel]);
  const specsRaw = joinParts([
    f.brand,
    f.category,
    f.sizeDimensionsCapacity,
  ]);
  const broadRaw = joinParts([
    f.category,
    f.sizeDimensionsCapacity,
    truncateFeatures(f.keyFeatures ?? "", 120),
  ]);

  const primaryQuery = ensureQueryChain(primaryRaw, [specsRaw, broadRaw]);
  const simplifiedQuery = ensureQueryChain(specsRaw, [primaryRaw, broadRaw]);
  const specsQuery = ensureQueryChain(broadRaw, [specsRaw, primaryRaw]);

  return { primaryQuery, simplifiedQuery, specsQuery };
}

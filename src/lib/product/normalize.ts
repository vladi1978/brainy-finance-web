import type {
  ComparisonCategory,
  NormalizedProduct,
  ProductCategory,
  ProductCondition,
  StoreId,
  StructuredProduct,
  TvDisplayTechBucket,
  TvNormalizedAttributes,
  TvResolutionBucket,
} from "./types";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "your",
  "new",
  "pack",
  "set",
  "each",
  "per",
  "inch",
  "inches",
  "size",
]);

/** Known consumer brands — extend as needed. */
const BRAND_PATTERN =
  /\b(samsung|lg|sony|tcl|hisense|vizio|insignia|onn|apple|google|beats|bose|jbl|sonos|anker|nike|adidas|reebok|puma|new balance|asics|crocs|ugg|hanes|gildan|champion|microsoft|dell|hp|lenovo|asus|acer|msi)\b/i;

/**
 * Lowercase, strip punctuation noise, collapse whitespace (search / matching).
 */
export function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeSignificant(text: string): string[] {
  const n = normalizeTitle(text);
  return n
    .split(/\s+/)
    .map((w) => w.replace(/-/g, ""))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export function extractBrand(title: string): string | null {
  const m = title.match(BRAND_PATTERN);
  return m ? m[1]!.toLowerCase().replace(/\s+/g, " ") : null;
}

/**
 * Model-like tokens: SKU fragments, alnum codes (e.g. QN65, XR-55X90K, air-max-270).
 */
export function extractModelTokens(title: string): string[] {
  const norm = normalizeTitle(title);
  const out = new Set<string>();

  for (const m of norm.matchAll(/\b[a-z]{0,3}\d{2,5}[a-z0-9-]*\b/gi)) {
    const t = m[0]!.replace(/-/g, "").toLowerCase();
    if (t.length >= 4) out.add(t);
  }
  for (const m of norm.matchAll(/\b(qn|un|qn|xr|oled|qled|u\d|serie)\w*\d{2,4}\w*\b/gi)) {
    out.add(m[0]!.replace(/\s+/g, "").toLowerCase());
  }
  return [...out].slice(0, 12);
}

/**
 * TV / monitor diagonal in inches when clearly stated.
 */
export function extractSizeInches(title: string): number | null {
  const norm = title.replace(/\u2033/g, '"'); // unicode double prime

  const m1 = norm.match(/\b(\d{2,3})\s*(?:\"|''|′′|inches?\b|inch\b|-inch)\b/i);
  if (m1) {
    const n = parseInt(m1[1]!, 10);
    if (n >= 20 && n <= 120) return n;
  }

  const m2 = norm.match(/\b(\d{2,3})\s*inch\b/i);
  if (m2) {
    const n = parseInt(m2[1]!, 10);
    if (n >= 20 && n <= 120) return n;
  }

  /** "85 Class" / "85-Inch Class" (common retailer phrasing) */
  const m3 = norm.match(/\b(\d{2,3})\s*-?\s*class\b/i);
  if (m3) {
    const n = parseInt(m3[1]!, 10);
    if (n >= 20 && n <= 120) return n;
  }

  return null;
}

function extractTvDisplayTech(title: string): TvDisplayTechBucket {
  const n = normalizeTitle(title);
  if (/\bmini[\s-]*led\b/.test(n)) return "mini_led";
  if (/\bneo[\s-]*qled\b/.test(n)) return "neo_qled";
  if (/\bqled\b/.test(n)) return "qled";
  if (/\boled\b/.test(n)) return "oled";
  if (/\bcrystal[\s-]*led\b/.test(n)) return "crystal_led";
  if (/\bcrystal\b/.test(n) && /\b(series|uhd|4k)\b/.test(n)) return "crystal_led";
  if (/\bled\b/.test(n)) return "led";
  return null;
}

function extractTvResolution(title: string): TvResolutionBucket {
  const n = normalizeTitle(title);
  if (/\b8k\b/.test(n)) return "8k";
  if (/\b(4k|uhd|ultra\s*hd)\b/.test(n)) return "4k";
  if (/\b(720p|1080p|full\s*hd|fhd|hd)\b/.test(n)) return "hd";
  return null;
}

function extractTvSmart(title: string): boolean | null {
  const n = normalizeTitle(title);
  if (/\b(non[\s-]*smart|not[\s-]*smart)\b/.test(n)) return false;
  if (/\b(smart\s*tv|smart\s*tizen|roku\s*tv|fire\s*tv|google\s*tv|webos)\b/.test(n))
    return true;
  return null;
}

/** Title-derived condition for any category. */
export function extractProductCondition(title: string): ProductCondition {
  const n = normalizeTitle(title);
  if (/\b(renewed|amazon\s*renewed)\b/.test(n)) return "renewed";
  if (/\b(refurb|refurbished|factory\s*recertified)\b/.test(n)) return "refurbished";
  if (/\b(pre[\s-]*owned|used\b)\b/.test(n)) return "used";
  if (/\bopen[\s-]*box\b/.test(n)) return "open_box";
  return "new";
}

/**
 * Samsung/LG-style model and series tokens for strict TV family matching.
 */
export function extractTvModelFamilyTokens(title: string): string[] {
  const raw = title.replace(/\u2033/g, '"');
  const n = normalizeTitle(raw);
  const out = new Set<string>();

  const pushNorm = (frag: string) => {
    const t = frag.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (t.length >= 4) out.add(t);
  };

  for (const m of n.matchAll(/\b([a-z]\d{2}[a-z]{2,8})\b/g)) pushNorm(m[1]!);
  for (const m of n.matchAll(/\b([a-z]{2}\d{4}[a-z0-9]*)\b/g)) pushNorm(m[1]!);
  for (const m of n.matchAll(/\b(un|qn|xr)(\d{2,3})([a-z0-9]{6,})\b/g)) {
    pushNorm(m[3]!.replace(/(20\d{2})$/i, ""));
  }
  for (const m of raw.matchAll(/\b([A-Z]\d{2}[A-Z]{2,8})\b/g)) pushNorm(m[1]!);

  return [...out].slice(0, 16);
}

/**
 * Retail SKU token when present (Samsung UN… / QN… style).
 */
export function extractTvFullModel(title: string): string | null {
  const upper = title.toUpperCase().replace(/\u2033/g, '"');
  const found: string[] = [];
  for (const m of upper.matchAll(/\b(UN|QN|QR)(\d{2,3})([A-Z0-9]{4,})\b/g)) {
    found.push(`${m[1]}${m[2]}${m[3]}`);
  }
  for (const m of upper.matchAll(/\b(UN\d{2}[A-Z0-9]{6,18})\b/g)) {
    found.push(m[1]!);
  }
  if (found.length === 0) return null;
  return [...new Set(found)].sort((a, b) => b.length - a.length)[0]!;
}

function seriesTailFromFullModelSku(tail: string): string | null {
  const t = tail.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (!t.length) return null;
  const du = t.match(/^(DU\d{4})/);
  if (du) return du[1]!;
  const m = t.match(/^([A-Z]\d{2}[A-Z]{2,})/);
  if (m) {
    let s = m[1]!;
    s = s.replace(/(FXZA|XZA|XZ)$/i, "");
    return s.length >= 4 ? s : null;
  }
  const m2 = t.match(/^([A-Z]{2,3}\d{3,5})/);
  return m2 && m2[1]!.length >= 5 ? m2[1]! : null;
}

/** Derive series key (e.g. M70HB, DU7200) from a parsed full SKU. */
export function inferTvFamilyFromFullModel(fullModel: string | null): string | null {
  if (!fullModel) return null;
  const u = fullModel.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const um = u.match(/^(?:UN|QN|QR)(\d{2,3})([A-Z0-9]+)$/);
  if (!um) return null;
  return seriesTailFromFullModelSku(um[2]!);
}

/**
 * Marketing or SKU-derived family token for TV lineup matching.
 */
export function extractTvModelFamilyKey(title: string, fullModel: string | null): string | null {
  const n = normalizeTitle(title);
  const ser = n.match(/\b([a-z]\d{2}[a-z]{2,})\s+series\b/);
  if (ser) return ser[1]!.toUpperCase();
  const du = n.match(/\b(du\d{4})\b/);
  if (du) return du[1]!.toUpperCase();
  const inferred = inferTvFamilyFromFullModel(fullModel);
  if (inferred) return inferred;
  return null;
}

export function extractColor(title: string): string | null {
  const n = normalizeTitle(title);
  const m = n.match(
    /\b(black|white|navy|red|blue|green|grey|gray|beige|pink|purple|brown|charcoal|multicolor|multi[\s-]?color)\b/
  );
  return m ? m[1]!.toLowerCase() : null;
}

export function extractSizeLabel(title: string): string | null {
  const n = normalizeTitle(title);
  const m = n.match(/\b(xs|s|m|l|xl|xxl|xxxl|\d+xl)\b/);
  return m ? m[1]!.toUpperCase() : null;
}

export type StructuredListingContext = {
  price?: number | null;
  currency?: string | null;
  productUrl?: string | null;
};

export function buildStructuredProduct(
  title: string,
  ctx?: StructuredListingContext
): StructuredProduct {
  const trimmed = title.trim();
  const category = extractCategory(trimmed);
  const brand = extractBrand(trimmed);
  const condition = extractProductCondition(trimmed);
  const base: StructuredProduct = {
    title: trimmed,
    brand,
    category,
    price: ctx?.price ?? null,
    currency: ctx?.currency ?? null,
    productUrl: ctx?.productUrl ?? null,
    condition,
    sizeInches: extractSizeInches(trimmed),
    modelFamily: null,
    fullModel: null,
    displayType: null,
    resolution: null,
    smartTv: null,
    gender: extractGender(trimmed),
    packCount: extractPackCount(trimmed),
    sizeLabel: extractSizeLabel(trimmed),
    color: extractColor(trimmed),
  };

  if (category === "tv") {
    const fullModel = extractTvFullModel(trimmed);
    const modelFamily =
      extractTvModelFamilyKey(trimmed, fullModel) ??
      inferTvFamilyFromFullModel(fullModel);
    return {
      ...base,
      fullModel,
      modelFamily,
      displayType: extractTvDisplayTech(trimmed),
      resolution: extractTvResolution(trimmed),
      smartTv: extractTvSmart(trimmed),
      sizeInches: extractSizeInches(trimmed),
    };
  }

  return base;
}

function buildTvAttributesFromStructured(
  title: string,
  structured: StructuredProduct
): TvNormalizedAttributes {
  const tokenSet = new Set<string>();
  for (const t of extractTvModelFamilyTokens(title)) tokenSet.add(t);
  if (structured.modelFamily) {
    tokenSet.add(structured.modelFamily.toLowerCase().replace(/[^a-z0-9]/g, ""));
  }
  if (structured.fullModel) {
    const tail = inferTvFamilyFromFullModel(structured.fullModel);
    if (tail) tokenSet.add(tail.toLowerCase().replace(/[^a-z0-9]/g, ""));
  }
  const modelFamilyTokens = [...tokenSet].filter((t) => t.length >= 4).slice(0, 16);

  return {
    displayTech: structured.displayType,
    resolution: structured.resolution,
    smartTv: structured.smartTv,
    condition: structured.condition,
    modelFamilyTokens:
      modelFamilyTokens.length > 0 ? modelFamilyTokens : extractTvModelFamilyTokens(title),
  };
}

/** Maps ProductCategory into comparison buckets (tv / apparel / generic). */
export function toComparisonCategory(category: ProductCategory): ComparisonCategory {
  if (category === "tv") return "tv";
  if (category === "socks" || category === "apparel") return "apparel";
  return "generic";
}

const HOUSEHOLD_RE =
  /\b(detergent|cleaner|bleach|disinfectant|paper towel|trash bag|garbage bag|sponge|mop|broom|laundry|dish soap|soap|ziploc|aluminum foil|batteries aa|batteries aaa|aa battery|aaa battery|light bulb|led bulb)\b/i;

const APPAREL_RE =
  /\b(shirt|tee|t-shirt|hoodie|sweatshirt|jacket|coat|pants|jeans|shorts|dress|skirt|underwear|bra|legging|joggers|sweater|polo)\b/i;

const SOCKS_RE = /\b(sock|socks|crew|ankle sock|no show|quarter sock)\b/i;

export function extractGender(title: string): string | null {
  const n = normalizeTitle(title);
  if (/\b(men|mens|man|male)\b/.test(n)) return "men";
  if (/\b(women|womens|woman|female|ladies|lady)\b/.test(n)) return "women";
  if (/\b(kids|kid|boys|girls|toddler|youth|junior)\b/.test(n)) return "kids";
  if (/\bunisex\b/.test(n)) return "unisex";
  return null;
}

export function extractCategory(title: string): ProductCategory {
  const n = normalizeTitle(title);
  if (
    /\b(smart tv|oled|qled|4k tv|8k tv|uhd tv|television)\b/.test(n) ||
    (/\b(mini[\s-]*led|neo[\s-]*qled)\b/.test(n) && extractSizeInches(title) != null) ||
    (/\btv\b/.test(n) && extractSizeInches(title) != null) ||
    (/\bneo qled\b/.test(n) && /\b\d{2,3}\b/.test(n))
  ) {
    return "tv";
  }
  if (SOCKS_RE.test(n)) {
    return "socks";
  }
  if (/\b(shoe|sneaker|boot|sandal|cleat|air max|yeezy|loafer|slip-on)\b/.test(n)) {
    return "footwear";
  }
  if (/\b(headphone|earbud|ear buds|airpods|speaker|soundbar|subwoofer)\b/.test(n)) {
    return "audio";
  }
  if (HOUSEHOLD_RE.test(n)) {
    return "household";
  }
  if (APPAREL_RE.test(n)) {
    return "apparel";
  }
  return "general";
}

/**
 * Pack / count when relevant (multipacks, grocery).
 */
export function extractPackCount(title: string): number | null {
  const n = normalizeTitle(title);

  const p1 = n.match(/\b(\d{1,3})\s*(?:pack|pk|ct|count)\b/);
  if (p1) return parseInt(p1[1]!, 10);

  const p2 = n.match(/\bpack of (\d{1,3})\b/);
  if (p2) return parseInt(p2[1]!, 10);

  const p3 = n.match(/\b(\d{1,3})\s*x\s*(?:count|ct)\b/);
  if (p3) return parseInt(p3[1]!, 10);

  const p4 = n.match(/\b(\d{1,3})\s*[- ]\s*pair\b/);
  if (p4) return parseInt(p4[1]!, 10);

  return null;
}

export function buildNormalizedProduct(
  title: string,
  ctx?: StructuredListingContext
): NormalizedProduct {
  const structured = buildStructuredProduct(title, ctx);
  const titleNorm = normalizeTitle(structured.title);
  const category = structured.category;
  const base: NormalizedProduct = {
    structured,
    titleNorm,
    brand: structured.brand,
    modelTokens: extractModelTokens(title),
    sizeInches: structured.sizeInches,
    category,
    packCount: structured.packCount,
    gender: structured.gender,
  };
  if (category === "tv") {
    return {
      ...base,
      tv: buildTvAttributesFromStructured(title, structured),
    };
  }
  return base;
}

const CATEGORY_SEARCH_KEYWORD: Record<ProductCategory, string | null> = {
  tv: "tv",
  footwear: "shoes",
  audio: "headphones",
  socks: "socks",
  apparel: "shirt",
  household: "household",
  general: null,
};

/**
 * Build a compact search string from normalized fields (brand, model, size, category, keywords).
 */
export function buildNormalizedSearchQuery(
  norm: NormalizedProduct,
  fallbackRaw: string
): string {
  const parts: string[] = [];
  if (norm.brand) parts.push(norm.brand);
  for (const t of norm.modelTokens.slice(0, 6)) {
    if (t.length >= 3 && !parts.includes(t)) parts.push(t);
  }
  if (norm.sizeInches != null) {
    parts.push(String(norm.sizeInches));
  }
  if (norm.packCount != null && norm.packCount > 1) {
    parts.push(`${norm.packCount} pack`);
  }
  const catKw = CATEGORY_SEARCH_KEYWORD[norm.category];
  if (catKw) parts.push(catKw);

  const significant = tokenizeSignificant(fallbackRaw).slice(0, 8);
  for (const w of significant) {
    if (parts.length >= 12) break;
    if (!parts.some((p) => p.includes(w) || w.includes(p))) parts.push(w);
  }

  const joined = [...new Set(parts.map((p) => p.trim()).filter(Boolean))].join(" ").trim();
  if (joined.length >= 6) {
    return joined.replace(/\s+/g, " ");
  }

  return extractSearchQuery(fallbackRaw);
}

/**
 * Compact, high-signal query for retailer search.
 */
export function extractSearchQuery(input: string): string {
  const cleaned = normalizeTitle(input);

  const brandMatch = cleaned.match(BRAND_PATTERN);
  const modelMatch = cleaned.match(
    /\b(qn\d{2,4}[a-z0-9]*|xr[\w-]*|oled|qled|neo qled|air max|u\d{3,4}[a-z]?)\b/i
  );
  const sizeMatch = cleaned.match(/\b\d{2,3}(?:\s*-\s*)?(?:inch|inches|")\b/i);
  const typeMatch = cleaned.match(
    /\b(tv|smart tv|shoes|socks|crew socks|speaker|headphones|earbuds|laptop|detergent|hoodie|sneakers)\b/i
  );

  const parts = [
    brandMatch?.[0],
    modelMatch?.[0],
    sizeMatch?.[0]?.replace(/-/g, " "),
    typeMatch?.[0],
  ].filter(Boolean);

  if (parts.length >= 2) {
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  return cleaned;
}

/**
 * Detect retailer from a product URL (used when scrape/extract did not set `SourceProduct`).
 */
export function detectStoreFromProductUrl(raw: string): StoreId | null {
  const t = raw.trim();
  if (!/^https?:\/\//i.test(t)) return null;
  if (/\bamazon\.[a-z.]{2,}\b|\/\/a\.co\/|\/\/amzn\.to\//i.test(t)) return "amazon";
  if (/walmart\.com/i.test(t)) return "walmart";
  if (/target\.com/i.test(t)) return "target";
  if (/temu\.com/i.test(t)) return "temu";
  return null;
}

/** Amazon ASIN — matches `/dp/`, `/gp/product/`, and slug-style `/dp/` paths. */
export function extractAmazonAsinFromUrl(url: string): string | null {
  const m = url.match(
    /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin|o\/ASIN|d)\/([A-Z0-9]{10})\b/i
  );
  return m ? m[1]!.toUpperCase() : null;
}

/** Walmart numeric item id (last path segment under `/ip/` when it is 6+ digits). */
export function extractWalmartItemIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/walmart\.com$/i.test(u.hostname.replace(/^www\./, ""))) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const ip = parts.indexOf("ip");
    if (ip === -1) return null;
    const after = parts.slice(ip + 1);
    for (let i = after.length - 1; i >= 0; i--) {
      const seg = after[i]!;
      if (/^\d{6,}$/.test(seg)) return seg;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Target TCIN from `/A-12345678` style paths. */
export function extractTargetTcinFromUrl(url: string): string | null {
  const m = url.match(/\/A-(\d{6,12})\b/i);
  return m ? m[1]! : null;
}

/** Temu: best-effort product key from `-g-<id>` or last `.html` slug segment. */
export function extractTemuListingKeyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/temu\.com$/i.test(u.hostname.replace(/^www\./, ""))) return null;
    const g = url.match(/-g-(\d{4,20})\b/i);
    if (g?.[1]) return `g-${g[1]}`;
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && /\.html$/i.test(last)) {
      return last.replace(/\.html$/i, "").toLowerCase().slice(0, 120);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function fallbackUrlIdentityKey(url: string): string {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "").toLowerCase() || "/";
    return `${host}${path}`;
  } catch {
    return url.split("?")[0].split("#")[0].toLowerCase().trim();
  }
}

/**
 * Stable identity for “same listing” checks across canonical vs pretty URLs
 * (e.g. Amazon `/title/dp/ASIN` vs `/dp/ASIN`).
 */
export function retailerListingIdentityKey(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";

  const noFrag = trimmed.split("#")[0] ?? trimmed;
  const noQuery = noFrag.split("?")[0] ?? noFrag;

  if (/\bamazon\.[a-z.]{2,}\b|a\.co|amzn\.to/i.test(trimmed)) {
    const asin = extractAmazonAsinFromUrl(noQuery);
    if (asin) return `amazon:asin:${asin}`;
  }

  if (/walmart\.com/i.test(noQuery)) {
    const wid = extractWalmartItemIdFromUrl(trimmed);
    if (wid) return `walmart:id:${wid}`;
  }

  if (/target\.com/i.test(noQuery)) {
    const tc = extractTargetTcinFromUrl(noQuery);
    if (tc) return `target:tcin:${tc}`;
  }

  if (/temu\.com/i.test(noQuery)) {
    const tk = extractTemuListingKeyFromUrl(trimmed);
    if (tk) return `temu:${tk}`;
  }

  return `url:${fallbackUrlIdentityKey(trimmed)}`;
}

export function areSameRetailerListings(urlA: string, urlB: string): boolean {
  const a = retailerListingIdentityKey(urlA);
  const b = retailerListingIdentityKey(urlB);
  return a.length > 0 && a === b;
}

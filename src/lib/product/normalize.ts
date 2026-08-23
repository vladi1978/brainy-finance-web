import {
  detectDisplayDeviceKind,
  extractDiagonalInches,
} from "./matching/displayDimensions";
import { cleanRetailerSearchQuery } from "./matching/searchQueryCleanup";
import type {
  ComparisonCategory,
  NormalizedProduct,
  ProductCategory,
  ProductDepartment,
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

/** Known consumer brands — extend as needed (non-TV and general fallback). */
const BRAND_PATTERN =
  /\b(samsung|lg|sony|tcl|hisense|vizio|insignia|onn|apple|google|beats|bose|jbl|sonos|anker|nike|adidas|reebok|puma|new balance|asics|crocs|ugg|hanes|gildan|champion|microsoft|dell|hp|lenovo|asus|acer|msi|intex|bestway|coleman|dewalt|milwaukee|makita|ryobi|bosch|craftsman|ridgid)\b/i;

/** TV panel OEM brands — includes Roku hardware; excludes platform-only mentions. */
const OEM_TV_BRAND_PATTERN =
  /\b(samsung|lg|sony|tcl|hisense|vizio|insignia|onn|roku|sharp|philips|panasonic)\b/gi;

/** Smart TV operating systems — must not be treated as OEM brand when another OEM is present. */
export const SMART_TV_PLATFORM_TOKENS = new Set([
  "roku",
  "tizen",
  "fire_tv",
  "google_tv",
  "webos",
  "android_tv",
]);

export function isSmartTvPlatformToken(brand: string | null | undefined): boolean {
  if (!brand) return false;
  return SMART_TV_PLATFORM_TOKENS.has(brand.toLowerCase().replace(/\s+/g, "_"));
}

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

function canonicalTitleForParsing(raw: string): string {
  return raw
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2032/g, "'")
    .replace(/\u2033/g, '"')
    .replace(/[–—]/g, "-");
}

export function tokenizeSignificant(text: string): string[] {
  const n = normalizeTitle(text);
  return n
    .split(/\s+/)
    .map((w) => w.replace(/-/g, ""))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export function extractBrand(title: string): string | null {
  const n = normalizeTitle(title);
  const oemMatches: { brand: string; index: number }[] = [];
  for (const m of n.matchAll(OEM_TV_BRAND_PATTERN)) {
    oemMatches.push({ brand: m[1]!.toLowerCase(), index: m.index ?? 0 });
  }

  const nonRokuOem = oemMatches.filter((hit) => hit.brand !== "roku");
  if (nonRokuOem.length > 0) {
    nonRokuOem.sort((a, b) => a.index - b.index);
    return nonRokuOem[0]!.brand;
  }

  const rokuHits = oemMatches.filter((hit) => hit.brand === "roku");
  if (rokuHits.length > 0) {
    const firstRoku = rokuHits.sort((a, b) => a.index - b.index)[0]!;
    if (firstRoku.index === 0) return "roku";
    return null;
  }

  const m = title.match(BRAND_PATTERN);
  return m ? m[1]!.toLowerCase().replace(/\s+/g, " ") : null;
}

/** Size / dimension fragments that must never count as model identifiers. */
function isSizeLikeModelToken(token: string): boolean {
  const t = token.toLowerCase().replace(/[^a-z0-9]/g, "");
  return /^\d{2,3}inch(?:es)?$/.test(t) || /^\d{2,3}$/.test(t);
}

/**
 * Model-like tokens: SKU fragments, alnum codes (e.g. QN65, XR-55X90K, V4K65M-0804).
 * Excludes screen-size tokens such as `65inch`.
 */
export function extractModelTokens(title: string): string[] {
  const norm = normalizeTitle(title);
  const out = new Set<string>();

  // Hyphenated retail SKUs (Vizio V4K65M-0804, etc.) before loose digit fragments.
  for (const m of title.toUpperCase().matchAll(/\b([A-Z]\d[A-Z0-9]*(?:-\d{2,8})+)\b/g)) {
    const t = m[1]!.replace(/-/g, "").toLowerCase();
    if (t.length >= 6 && !isSizeLikeModelToken(t)) out.add(t);
  }

  for (const m of norm.matchAll(/\b[a-z]{0,3}\d{2,5}[a-z0-9-]*\b/gi)) {
    const t = m[0]!.replace(/-/g, "").toLowerCase();
    if (t.length >= 4 && !isSizeLikeModelToken(t)) out.add(t);
  }
  for (const m of norm.matchAll(/\b(qn|un|qn|xr|oled|qled|u\d|serie)\w*\d{2,4}\w*\b/gi)) {
    const t = m[0]!.replace(/\s+/g, "").toLowerCase();
    if (!isSizeLikeModelToken(t)) out.add(t);
  }
  return [...out].slice(0, 12);
}

/**
 * TV / monitor / laptop diagonal in inches when clearly stated.
 * @see matching/displayDimensions.ts
 */
export function extractSizeInches(title: string): number | null {
  return extractDiagonalInches(title, {
    deviceKind: detectDisplayDeviceKind(title),
  });
}

function extractTvDisplayTech(title: string): TvDisplayTechBucket {
  const n = normalizeTitle(title);
  if (/\bmini[\s-]*led\b|\bminiled\b/.test(n)) return "mini_led";
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
  if (/\b(720p|1080p|full\s*hd|fhd|hd|hdr)\b/.test(n)) return "hd";
  return null;
}

function extractTvSmart(title: string): boolean | null {
  const n = normalizeTitle(title);
  if (/\b(non[\s-]*smart|not[\s-]*smart)\b/.test(n)) return false;
  if (
    /\b(smart\s*tv|smart\s*tizen|roku(?:\s*tv)?|fire\s*tv|google\s*tv|android\s*tv|webos)\b/.test(
      n
    )
  )
    return true;
  return null;
}

export function extractTvPlatform(title: string): string | null {
  const n = normalizeTitle(title);
  if (/\broku(?:\s*tv)?\b/.test(n)) return "roku";
  if (/\bgoogle\s*tv\b|\bandroid\s*tv\b/.test(n)) return "google_tv";
  if (/\bfire\s*tv\b/.test(n)) return "fire_tv";
  if (/\bwebos\b/.test(n)) return "webos";
  if (/\btizen\b/.test(n)) return "tizen";
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
 * Retail SKU token when present (Samsung UN… / QN…, Vizio V4K65M-0804, etc.).
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
  // Vizio / generic: letter+digit retail codes with optional numeric suffix (V4K65M-0804).
  for (const m of upper.matchAll(/\b([A-Z]\d[A-Z0-9]{2,}(?:-\d{2,8})+)\b/g)) {
    const compact = m[1]!.replace(/[^A-Z0-9]/g, "");
    if (compact.length >= 8 && /[A-Z]/.test(compact) && /\d/.test(compact)) {
      found.push(compact);
    }
  }
  for (const m of upper.matchAll(/\b([A-Z]\d[A-Z0-9]{6,18})\b/g)) {
    const compact = m[1]!.replace(/[^A-Z0-9]/g, "");
    if (
      compact.length >= 8 &&
      /[A-Z]/.test(compact) &&
      /\d/.test(compact) &&
      !/^\d/.test(compact)
    ) {
      found.push(compact);
    }
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

export function extractProductType(title: string): string | null {
  const n = normalizeTitle(title);
  const m = n.match(
    /\b(shoe|sneaker|boot|sandal|cleat|loafer|slip-on|shirt|tee|t-shirt|hoodie|sweatshirt|jacket|coat|pants|jeans|shorts|dress|skirt|legging|socks?|drill|impact driver|driver|circular saw|reciprocating saw|grinder|sander|nailer|router|multitool)\b/
  );
  if (!m) return null;
  const token = m[1]!.toLowerCase();
  if (token === "tee" || token === "t-shirt") return "shirt";
  return token;
}

export function extractToolVoltage(title: string): string | null {
  const n = canonicalTitleForParsing(title);
  const m = n.match(/\b(\d{1,3})\s*(?:v|volt|volts)\b/i);
  if (!m) return null;
  return `${m[1]}v`;
}

export function extractToolBatteryKitStatus(title: string): boolean | null {
  const n = normalizeTitle(title);
  if (
    /\b(tool[\s-]*only|bare[\s-]*tool|battery(?:\s+and|\s*&)?\s*charger\s*not\s*included|no\s*battery)\b/.test(
      n
    )
  ) {
    return false;
  }
  if (
    /\b(with\s+battery|battery\s+included|battery\s+and\s+charger|includes?\s+charger|starter\s+kit|combo\s+kit|kit)\b/.test(
      n
    )
  ) {
    return true;
  }
  return null;
}

export function extractSizeLabel(title: string): string | null {
  const n = normalizeTitle(title);
  const m = n.match(/\b(xs|s|m|l|xl|xxl|xxxl|\d+xl|small|medium|large)\b/);
  if (!m) return null;
  const raw = m[1]!.toLowerCase();
  if (raw === "small") return "S";
  if (raw === "medium") return "M";
  if (raw === "large") return "L";
  return raw.toUpperCase();
}

function extractNumericApparelSize(title: string): number | null {
  const n = normalizeTitle(title);
  const tagged = n.match(/\b(?:size|w|waist)\s*(\d{1,2}(?:\.\d)?)\b/);
  if (tagged) {
    const v = parseFloat(tagged[1]!);
    if (v >= 0 && v <= 60) return v;
  }
  const shoe = n.match(/\b(?:mens?|womens?|unisex)\s+(\d{1,2}(?:\.\d)?)\b/);
  if (shoe) {
    const v = parseFloat(shoe[1]!);
    if (v >= 4 && v <= 20) return v;
  }
  return null;
}

function extractPoolShape(title: string): "round" | "oval" | "rectangular" | null {
  const n = normalizeTitle(title);
  if (/\bround\b/.test(n)) return "round";
  if (/\boval\b/.test(n)) return "oval";
  if (/\b(rectangle|rectangular|rect)\b/.test(n)) return "rectangular";
  return null;
}

function extractPoolConstruction(title: string): "steel_frame" | "hard_sided" | "inflatable" | null {
  const n = normalizeTitle(title);
  if (/\b(inflatable|airjet|easy set)\b/.test(n)) return "inflatable";
  if (/\b(steel\s*frame|metal\s*frame)\b/.test(n)) return "steel_frame";
  if (/\b(hard\s*sided|resin\s*frame|rigid\s*wall)\b/.test(n)) return "hard_sided";
  return null;
}

function extractToolFamily(title: string): string | null {
  const n = normalizeTitle(title);
  const platform = n.match(/\b(m12|m18|20v\s*max|40v|max|60v|max|xgt|lxt|one\+|18v\s*lxt)\b/);
  if (platform) return platform[1]!.replace(/\s+/g, "");
  return extractProductType(title);
}

function logAttributeHydration(payload: {
  title: string;
  structured: StructuredProduct;
  modelTokens: string[];
  category: ProductCategory;
}): void {
  const poolAttrs =
    payload.category === "pool" ||
    payload.category === "outdoor_pool" ||
    payload.category === "swimming_pool"
      ? {
          shape: extractPoolShape(payload.title),
          construction: extractPoolConstruction(payload.title),
        }
      : null;
  const tvAttrs =
    payload.category === "tv" || payload.category === "monitor"
      ? {
          screenInches: payload.structured.sizeInches,
          resolution: payload.structured.resolution,
          displayType: payload.structured.displayType,
          smartTv: payload.structured.smartTv,
          platform: payload.structured.smartTvPlatform ?? extractTvPlatform(payload.title),
        }
      : null;
  console.log(
    "[ATTRIBUTE_HYDRATION]",
    JSON.stringify({
      category: payload.category,
      title: payload.title.slice(0, 180),
      structured: {
        sizeInches: payload.structured.sizeInches,
        productType: payload.structured.productType,
        toolVoltage: payload.structured.toolVoltage,
        toolBatteryKit: payload.structured.toolBatteryKit,
        gender: payload.structured.gender,
        sizeLabel: payload.structured.sizeLabel,
      },
      apparelNumericSize: extractNumericApparelSize(payload.title),
      toolFamily: extractToolFamily(payload.title),
      modelTokens: payload.modelTokens.slice(0, 8),
      pool: poolAttrs,
      tv: tvAttrs,
    })
  );
  if (tvAttrs) {
    console.log("[TV_ATTRIBUTES_PARSED]", JSON.stringify(tvAttrs));
  }
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
    smartTvPlatform: null,
    productType: extractProductType(trimmed),
    toolVoltage: extractToolVoltage(trimmed),
    toolBatteryKit: extractToolBatteryKitStatus(trimmed),
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
      smartTvPlatform: extractTvPlatform(trimmed),
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
    platform: structured.smartTvPlatform,
    condition: structured.condition,
    modelFamilyTokens:
      modelFamilyTokens.length > 0 ? modelFamilyTokens : extractTvModelFamilyTokens(title),
  };
}

/**
 * True when `sourceBrand` appears in the candidate title as an OEM brand mention,
 * not merely as a smart-TV platform token on a different OEM listing.
 */
export function candidateTitleMentionsSourceOemBrand(args: {
  sourceBrand: string;
  candidateBrand: string | null;
  candidateTitle: string;
}): boolean {
  const { sourceBrand, candidateBrand, candidateTitle } = args;
  const normalizedSourceBrand = sourceBrand.toLowerCase().replace(/\s+/g, " ");
  const titleNorm = normalizeTitle(candidateTitle);
  if (!titleNorm.includes(normalizedSourceBrand)) return false;
  if (
    isSmartTvPlatformToken(normalizedSourceBrand) &&
    candidateBrand &&
    candidateBrand !== normalizedSourceBrand
  ) {
    return false;
  }
  return true;
}

/** Maps ProductCategory into comparison buckets (tv / monitor / apparel / generic). */
export function toComparisonCategory(category: ProductCategory): ComparisonCategory {
  if (category === "tv") return "tv";
  if (category === "monitor") return "monitor";
  if (category === "socks" || category === "apparel") return "apparel";
  return "generic";
}

export function toProductDepartment(category: ProductCategory): ProductDepartment {
  if (category === "tv" || category === "monitor") return "screen";
  if (category === "pool" || category === "outdoor_pool" || category === "swimming_pool") {
    return "pool";
  }
  if (category === "footwear" || category === "socks" || category === "apparel") {
    return "apparel";
  }
  if (category === "tools") return "tools";
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

/**
 * True when the title describes a fixed-pixel screen (TV or monitor class) we can size-match.
 */
export function isLikelyScreenProductTitle(title: string): boolean {
  const n = normalizeTitle(title);
  if (extractSizeInches(title) == null) return false;
  if (/\b(monitor|television|smart tv|\btv\b|display screen|computer screen)\b/.test(n))
    return true;
  if (/\b(uhd|4k|8k|qled|oled|neo[\s-]*qled|mini[\s-]*led|hdr|curved|gaming)\b/.test(n))
    return true;
  if (/\b(class|diagonal)\b/.test(n) && /\b(led|lcd|qled|oled)\b/.test(n)) return true;
  return false;
}

export function extractCategory(title: string): ProductCategory {
  const n = normalizeTitle(title);
  const inches = extractSizeInches(title);

  /** Computer / gaming monitors — before TV so "32 inch monitor" is not classified as TV */
  if (/\bmonitor\b/.test(n)) {
    return "monitor";
  }

  if (
    /\b(smart tv|oled tv|qled tv|4k tv|8k tv|uhd tv|television)\b/.test(n) ||
    (/\b(mini[\s-]*led|neo[\s-]*qled)\b/.test(n) && inches != null) ||
    (/\btv\b/.test(n) && inches != null) ||
    (/\bneo qled\b/.test(n) && /\b\d{2,3}\b/.test(n)) ||
    /** Large-panel TVs often omit the word "TV" but include panel + smart/UHD cues */
    (inches != null &&
      inches >= 32 &&
      !/\bmonitor\b/.test(n) &&
      /\b(smart|uhd|ultra hd|4k|8k|qled|oled|neo[\s-]*qled|hdr|tizen|roku|fire tv|google tv|webos)\b/.test(
        n
      ))
  ) {
    return "tv";
  }

  // Pool categories (BrainyFinance is universal; pool rules must be category-gated elsewhere).
  if (/\bswimming\s+pool\b/.test(n)) {
    return "swimming_pool";
  }
  if (/\babove[\s-]+ground[\s-]+pool\b/.test(n)) {
    return "outdoor_pool";
  }
  if (/\bin[\s-]?ground\s+pool\b/.test(n)) {
    return "outdoor_pool";
  }
  if (/\bpool\b/.test(n)) {
    return "pool";
  }

  if (
    /\b(drill|driver|impact|saw|grinder|sander|nailer|compressor|multitool|tool\s+only|bare\s+tool)\b/.test(
      n
    )
  ) {
    return "tools";
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
    const out: NormalizedProduct = {
      ...base,
      tv: buildTvAttributesFromStructured(title, structured),
    };
    logAttributeHydration({
      title,
      structured,
      modelTokens: out.modelTokens,
      category,
    });
    return out;
  }
  logAttributeHydration({
    title,
    structured,
    modelTokens: base.modelTokens,
    category,
  });
  return base;
}

/** High-level attributes parsed from a title (brand, category, size, model codes). */
export type ParsedProductAttributes = {
  brand: string | null;
  category: ProductCategory;
  sizeInches: number | null;
  modelTokens: string[];
  fullModel: string | null;
};

export function parseProductAttributesFromTitle(title: string): ParsedProductAttributes {
  const n = buildNormalizedProduct(title);
  return {
    brand: n.brand,
    category: n.category,
    sizeInches: n.sizeInches,
    modelTokens: n.modelTokens,
    fullModel: n.structured.fullModel,
  };
}

const CATEGORY_SEARCH_KEYWORD: Record<ProductCategory, string | null> = {
  tv: "tv",
  monitor: "monitor",
  pool: "pool",
  outdoor_pool: "pool",
  swimming_pool: "pool",
  tools: "tools",
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
  const seen = new Set<string>();
  const add = (tok: string) => {
    const key = tok.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key || seen.has(key)) return;
    seen.add(key);
    parts.push(tok);
  };

  if (norm.brand) add(norm.brand);
  for (const t of norm.modelTokens.slice(0, 6)) {
    if (t.length >= 3) add(t);
  }
  if (norm.sizeInches != null) {
    add(String(norm.sizeInches));
  }
  if (norm.packCount != null && norm.packCount > 1) {
    add(`${norm.packCount} pack`);
  }
  const catKw = CATEGORY_SEARCH_KEYWORD[norm.category];
  if (catKw) add(catKw);

  const significant = tokenizeSignificant(fallbackRaw).slice(0, 8);
  for (const w of significant) {
    if (parts.length >= 12) break;
    if (![...seen].some((k) => k.includes(w) || w.includes(k))) add(w);
  }

  const joined = parts.join(" ").trim();
  if (joined.length >= 6) {
    return cleanRetailerSearchQuery(joined);
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
    /\b(qn\d{2,4}[a-z0-9]*|xr[\w-]*|oled\d{2,3}|qled\d{2,3}|neo qled|air max|u\d{3,4}[a-z]?|\d{2,3}[a-z]\d[a-z0-9]+)\b/i
  );
  const sizeInches = extractSizeInches(input);
  const sizePart =
    sizeInches != null ? `${sizeInches} inch` : cleaned.match(/\b\d{2,3}(?:\s*-\s*)?(?:inch|inches|")\b/i)?.[0]?.replace(/-/g, " ");
  const typeMatch = cleaned.match(
    /\b(tv|smart tv|shoes|socks|crew socks|speaker|headphones|earbuds|laptop|detergent|hoodie|sneakers)\b/i
  );

  const parts: string[] = [];
  const seen = new Set<string>();
  for (const p of [brandMatch?.[0], modelMatch?.[0], sizePart, typeMatch?.[0]]) {
    if (!p) continue;
    const key = p.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(p);
  }

  if (parts.length >= 2) {
    return cleanRetailerSearchQuery(parts.join(" "));
  }

  return cleanRetailerSearchQuery(cleaned);
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
  if (/bestbuy\.com/i.test(t)) return "bestbuy";
  if (/homedepot\.com/i.test(t)) return "homedepot";
  if (/lowes\.com/i.test(t)) return "lowes";
  if (/costco\.com/i.test(t)) return "costco";
  if (/samsclub\.com/i.test(t)) return "samsclub";
  if (/ebay\.com/i.test(t)) return "ebay";
  if (/macys\.com/i.test(t)) return "macys";
  if (/kohls\.com/i.test(t)) return "kohls";
  if (/wayfair\.com/i.test(t)) return "wayfair";
  if (/overstock\.com/i.test(t)) return "overstock";
  if (/chewy\.com/i.test(t)) return "chewy";
  if (/academy\.com/i.test(t)) return "academy";
  if (/tractorsupply\.com/i.test(t)) return "tractorsupply";
  if (/nike\.com/i.test(t)) return "nike";
  if (/adidas\.com/i.test(t) || /adidas\.us/i.test(t)) return "adidas";
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

/**
 * Phase 1 structured product “understanding”: deterministic extraction + normalization.
 * Same shapes can later be filled by LLMs, embeddings, or retailer APIs without changing compare callers.
 */

import {
  extractAmazonAsinFromUrl,
  extractPackCount,
  extractProductCondition,
  extractTargetTcinFromUrl,
  extractTemuListingKeyFromUrl,
  extractTvFullModel,
  extractTvModelFamilyKey,
  extractWalmartItemIdFromUrl,
  normalizeTitle,
} from "./normalize";
import type {
  NormalizedProduct,
  ProductCategory,
  ProductCondition,
  SourceScrapedHints,
} from "./types";

export type ProductUnderstandingProvenance =
  | "url_metadata"
  | "url_slug_fallback"
  | "title_description";

export type ProductUnderstandingFlags = {
  smart: boolean | null;
  wireless: boolean | null;
  cordlessOrBattery: boolean | null;
  electric: boolean | null;
};

/**
 * Canonical snapshot used for structured overlap scoring (not raw title similarity).
 */
export type ProductUnderstanding = {
  categoryHintNorm: string | null;
  productTypeHintNorm: string | null;
  brandNorm: string | null;
  modelFamilyNorm: string | null;
  retailerSkuNorm: string | null;
  gtinNorm: string | null;
  dimensionsNorm: string | null;
  capacityStorageNorm: string | null;
  quantityCount: number | null;
  materialHintsNorm: string[];
  condition: ProductCondition | null;
  generationYear: string | null;
  colorNorm: string | null;
  compatibilityNorm: string[];
  keySpecsNorm: string[];
  resolutionPerfNorm: string | null;
  flags: ProductUnderstandingFlags;
  provenance: ProductUnderstandingProvenance;
  extractionConfidence: number;
};

export type UnderstandingOverlapResult = {
  score: number;
  reasons: string[];
  exactIdentityMatch: boolean;
};

const MATERIAL_RE =
  /\b(leather|cotton|polyester|nylon|steel|stainless\s*steel|aluminum|aluminium|plastic|wood|glass|rubber|silicone|ceramic|vinyl|brass|copper|iron)\b/gi;

function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Normalize retailer / model tokens for fuzzy equality. */
export function normTokenAlnum(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Expand common retailer wording so “50 inch”, 50-inch, 50″ compare cleanly.
 */
export function normalizeUnderstandingBlob(raw: string): string {
  let s = normalizeTitle(raw).replace(/\u2033/g, '"').replace(/\u2019/g, "'");
  s = s.replace(/\b(\d{2,3})\s*-?\s*(?:inch|inches)\b/gi, "$1inch");
  s = s.replace(/\b(\d{2,3})\s*["″]+\s*/g, "$1inch ");
  s = s.replace(/\b(\d{2,3})\s*-?\s*class\b/gi, "$1inch_class ");
  s = s.replace(/\bultra\s*hd\b|\buhd\b|\b4k\b|\b2160p\b/gi, "res_4k_uhd");
  s = s.replace(/\b8k\b|\b4320p\b/gi, "res_8k");
  s = s.replace(/\bcordless\b|\bbattery\s*(?:powered|operated)\b/gi, "power_cordless");
  s = s.replace(/\bcorded\b|\bac\s+powered\b/gi, "power_corded");
  s = s.replace(/\bwifi\b|\bwi[\s-]?fi\b|\bwireless\b|\bbluetooth\b/gi, "connect_wireless");
  return collapseWs(s);
}

function uniqNormTokens(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const t = collapseWs(raw).toLowerCase();
    if (t.length < 2 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, 24);
}

function extractDimensionsPhrase(text: string): string | null {
  const n = text.replace(/\u2033/g, '"');

  const multi = n.match(
    /\b\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?\s*(?:inch|inches|in\b|"|″|ft|')\b/i
  );
  if (multi) return collapseWs(multi[0]).toLowerCase();

  const inch =
    n.match(/\b\d{2,3}\s*-?\s*(?:"|″|''|inch|inches)\b/i) ??
    n.match(/\b\d{2,3}\s*-?\s*class\b/i);
  if (inch) return collapseWs(inch[0]).toLowerCase();

  const metric = n.match(/\b\d+(?:\.\d+)?\s*(?:cm|mm)\b/i);
  if (metric) return collapseWs(metric[0]).toLowerCase();

  return null;
}

function extractCapacity(text: string): string | null {
  const n = normalizeTitle(text);
  const m =
    n.match(/\b(\d{2,5})\s*(gb|tb)\b/) ??
    n.match(/\b(\d)\s*(tb)\b/);
  if (!m) return null;
  return `${m[1]}${m[2]}`.toLowerCase();
}

function extractGtin(text: string): string | null {
  const m = text.match(/\b(\d{12,14})\b/);
  return m ? m[1]! : null;
}

function extractColorNorm(text: string): string | null {
  const n = normalizeTitle(text);
  const m = n.match(
    /\b(black|white|navy|red|blue|green|grey|gray|beige|pink|purple|brown|charcoal|silver|gold)\b/
  );
  return m ? m[1]! : null;
}

function extractGenerationYear(text: string): string | null {
  const n = text;
  const labeled = n.match(
    /\b(?:model\s*year|year)\s*:?\s*(20\d{2})\b/i
  );
  if (labeled?.[1]) return labeled[1];
  const gen = n.match(/\b(?:iphone|galaxy|ipad)\s+(?:\w+\s+)?(20\d{2})\b/i);
  if (gen?.[1]) return gen[1];
  return null;
}

function extractCompatibilityPhrases(text: string): string[] {
  const out: string[] = [];
  const re =
    /\b(?:compatible\s+with|fits|for)\s+([^,;.]{3,80})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const line = collapseWs(m[1]).toLowerCase();
    if (line.length >= 3) out.push(line.slice(0, 120));
  }
  return uniqNormTokens(out);
}

function inferCategoryHint(cat: ProductCategory): string | null {
  switch (cat) {
    case "tv":
      return "tv television display";
    case "monitor":
      return "monitor display";
    case "footwear":
      return "shoes footwear";
    case "audio":
      return "audio headphones speakers";
    case "socks":
      return "socks hosiery";
    case "apparel":
      return "apparel clothing";
    case "household":
      return "household home supplies";
    default:
      return null;
  }
}

function inferFlagsFromText(text: string): ProductUnderstandingFlags {
  const n = normalizeTitle(text);
  let smart: boolean | null = null;
  if (/\b(non[\s-]*smart|not[\s-]*smart)\b/.test(n)) smart = false;
  else if (/\bsmart\b/.test(n)) smart = true;

  const wireless =
    /\b(wifi|wi[\s-]fi|wireless|bluetooth)\b/.test(n) ? true : null;

  let cordlessOrBattery: boolean | null = null;
  if (/\bcordless\b|\bbattery\s*(powered|operated)\b|\brechargeable\b/.test(n))
    cordlessOrBattery = true;
  else if (/\bcorded\b|\bac\s+power(ed)?\b/.test(n)) cordlessOrBattery = false;

  const electric = /\belectric\b|\b\d+v\b|\bvolt\b|\bwatt\b|\bhp\b/.test(n)
    ? true
    : null;

  return { smart, wireless, cordlessOrBattery, electric };
}

function extractResolutionPerf(text: string): string | null {
  const b = normalizeUnderstandingBlob(text);
  if (/\bres_8k\b/.test(b)) return "res_8k";
  if (/\bres_4k_uhd\b/.test(b)) return "res_4k_uhd";
  const n = normalizeTitle(text);
  if (/\b(720p|1080p|fhd|full\s*hd)\b/.test(n)) return "res_hd";
  return null;
}

function extractKeySpecs(text: string): string[] {
  const n = normalizeTitle(text);
  const specs: string[] = [];

  const dim = extractDimensionsPhrase(text);
  if (dim) specs.push(normalizeUnderstandingBlob(dim));

  const cap = extractCapacity(text);
  if (cap) specs.push(cap);

  for (const m of n.matchAll(/\b(\d{3,5})\s*mah\b/g)) {
    specs.push(`${m[1]}mah`);
  }
  for (const m of n.matchAll(/\b(\d{1,3})\s*(?:v|volt)\b/g)) {
    specs.push(`${m[1]}volt`);
  }
  for (const m of n.matchAll(/\b(\d{2,4})\s*(w|watt|watts)\b/g)) {
    specs.push(`${m[1]}w`);
  }

  const rpm = n.match(/\b(\d{3,5})\s*rpm\b/);
  if (rpm) specs.push(`${rpm[1]}rpm`);

  return uniqNormTokens(specs);
}

function extractMaterials(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(MATERIAL_RE.source, MATERIAL_RE.flags);
  while ((m = re.exec(text)) !== null) {
    out.push(m[1]!.toLowerCase().replace(/\s+/g, ""));
  }
  return uniqNormTokens(out);
}

function extractProductTypeHint(text: string): string | null {
  const n = normalizeTitle(text);
  const hints = [
    /\b(smart\s+tv|\btv\b|television|monitor)\b/,
    /\b(laptop|notebook|chromebook)\b/,
    /\b(refrigerator|fridge|dishwasher|washer|dryer|oven|microwave)\b/,
    /\b(pool|above\s+ground\s+pool)\b/,
    /\b(drill|impact\s+driver|circular\s+saw)\b/,
    /\b(sofa|couch|desk|dresser|nightstand)\b/,
    /\b(car\s+battery|motor\s+oil|spark\s+plug)\b/,
    /\b(shampoo|moisturizer|sunscreen)\b/,
    /\b(running\s+shoe|sneaker|boot)\b/,
  ];
  for (const re of hints) {
    const mm = n.match(re);
    if (mm) return collapseWs(mm[0]).toLowerCase();
  }
  return null;
}

function retailerIdsFromUrl(url: string | null | undefined): string[] {
  if (!url?.trim()) return [];
  const ids: string[] = [];
  const asin = extractAmazonAsinFromUrl(url);
  if (asin) ids.push(asin.toLowerCase());
  const wm = extractWalmartItemIdFromUrl(url);
  if (wm) ids.push(wm);
  const tc = extractTargetTcinFromUrl(url);
  if (tc) ids.push(`tcin${tc}`);
  const temu = extractTemuListingKeyFromUrl(url);
  if (temu) ids.push(normTokenAlnum(temu));
  return ids;
}

function mergeUnderstandingBase(
  a: ProductUnderstanding,
  b: Partial<ProductUnderstanding>
): ProductUnderstanding {
  return {
    categoryHintNorm: b.categoryHintNorm ?? a.categoryHintNorm,
    productTypeHintNorm: b.productTypeHintNorm ?? a.productTypeHintNorm,
    brandNorm: b.brandNorm ?? a.brandNorm,
    modelFamilyNorm: b.modelFamilyNorm ?? a.modelFamilyNorm,
    retailerSkuNorm: b.retailerSkuNorm ?? a.retailerSkuNorm,
    gtinNorm: b.gtinNorm ?? a.gtinNorm,
    dimensionsNorm: b.dimensionsNorm ?? a.dimensionsNorm,
    capacityStorageNorm: b.capacityStorageNorm ?? a.capacityStorageNorm,
    quantityCount: b.quantityCount ?? a.quantityCount,
    materialHintsNorm:
      b.materialHintsNorm && b.materialHintsNorm.length > 0
        ? uniqNormTokens([...a.materialHintsNorm, ...b.materialHintsNorm])
        : a.materialHintsNorm,
    condition: b.condition ?? a.condition,
    generationYear: b.generationYear ?? a.generationYear,
    colorNorm: b.colorNorm ?? a.colorNorm,
    compatibilityNorm:
      b.compatibilityNorm && b.compatibilityNorm.length > 0
        ? uniqNormTokens([...a.compatibilityNorm, ...b.compatibilityNorm])
        : a.compatibilityNorm,
    keySpecsNorm:
      b.keySpecsNorm && b.keySpecsNorm.length > 0
        ? uniqNormTokens([...a.keySpecsNorm, ...b.keySpecsNorm])
        : a.keySpecsNorm,
    resolutionPerfNorm: b.resolutionPerfNorm ?? a.resolutionPerfNorm,
    flags: {
      smart: b.flags?.smart ?? a.flags.smart,
      wireless: b.flags?.wireless ?? a.flags.wireless,
      cordlessOrBattery:
        b.flags?.cordlessOrBattery ?? a.flags.cordlessOrBattery,
      electric: b.flags?.electric ?? a.flags.electric,
    },
    provenance: b.provenance ?? a.provenance,
    extractionConfidence: Math.max(
      a.extractionConfidence,
      b.extractionConfidence ?? 0
    ),
  };
}

function emptyUnderstanding(
  provenance: ProductUnderstandingProvenance,
  extractionConfidence: number
): ProductUnderstanding {
  return {
    categoryHintNorm: null,
    productTypeHintNorm: null,
    brandNorm: null,
    modelFamilyNorm: null,
    retailerSkuNorm: null,
    gtinNorm: null,
    dimensionsNorm: null,
    capacityStorageNorm: null,
    quantityCount: null,
    materialHintsNorm: [],
    condition: null,
    generationYear: null,
    colorNorm: null,
    compatibilityNorm: [],
    keySpecsNorm: [],
    resolutionPerfNorm: null,
    flags: {
      smart: null,
      wireless: null,
      cordlessOrBattery: null,
      electric: null,
    },
    provenance,
    extractionConfidence,
  };
}

/**
 * Core structured extraction from plain title / description (no network).
 */
export function extractUnderstandingFromText(text: string): ProductUnderstanding {
  const raw = collapseWs(text);
  const base = emptyUnderstanding("title_description", 0.22);

  if (!raw) return base;

  const cond = extractProductCondition(raw);
  const qty = extractPackCount(raw);
  const dims = extractDimensionsPhrase(raw);
  const cap = extractCapacity(raw);
  const gtin = extractGtin(raw);
  const year = extractGenerationYear(raw);
  const flags = inferFlagsFromText(raw);
  const resolutionPerfNorm = extractResolutionPerf(raw);
  const materials = extractMaterials(raw);
  const compat = extractCompatibilityPhrases(raw);
  const keys = extractKeySpecs(raw);
  const typeHint = extractProductTypeHint(raw);

  let brandNorm: string | null = null;
  const brandMatch = raw.match(
    /\b(samsung|lg|sony|tcl|hisense|vizio|insignia|onn|apple|google|beats|bose|jbl|sonos|anker|nike|adidas|reebok|puma|new balance|asics|crocs|ugg|microsoft|dell|hp|lenovo|asus|acer|msi|intex|bestway|coleman|makita|dewalt|milwaukee|ryobi)\b/i
  );
  if (brandMatch) brandNorm = brandMatch[1]!.toLowerCase();

  let modelFamilyNorm: string | null = null;
  const fullTv = extractTvFullModel(raw);
  const tvFamKey = extractTvModelFamilyKey(raw, fullTv);
  modelFamilyNorm = tvFamKey
    ? tvFamKey.toLowerCase().replace(/[^a-z0-9]/g, "")
    : null;
  if (!modelFamilyNorm) {
    const mod = raw.match(/\b([a-z]{1,3}\d{3,5}[a-z0-9]*)\b/i);
    if (mod?.[1] && mod[1].length >= 5) modelFamilyNorm = normTokenAlnum(mod[1]);
  }

  let extractionConfidence = 0.26;
  let filled = 0;
  if (brandNorm) filled++;
  if (modelFamilyNorm) filled++;
  if (dims || cap || gtin) filled++;
  if (typeHint) filled++;
  extractionConfidence = Math.min(0.88, 0.22 + filled * 0.09);

  return mergeUnderstandingBase(base, {
    brandNorm,
    modelFamilyNorm,
    retailerSkuNorm: fullTv
      ? fullTv.toLowerCase().replace(/[^a-z0-9]/g, "")
      : null,
    gtinNorm: gtin,
    dimensionsNorm: dims ? normalizeUnderstandingBlob(dims) : null,
    capacityStorageNorm: cap,
    quantityCount: qty,
    materialHintsNorm: materials,
    condition: cond === "unknown" ? null : cond,
    generationYear: year,
    colorNorm: extractColorNorm(raw),
    compatibilityNorm: compat,
    keySpecsNorm: keys,
    resolutionPerfNorm,
    flags,
    extractionConfidence,
    productTypeHintNorm: typeHint,
  });
}

function overlayNormalizedSnapshot(
  norm: NormalizedProduct,
  u: ProductUnderstanding
): ProductUnderstanding {
  const st = norm.structured;
  const brandNorm = norm.brand ?? u.brandNorm;
  const tvFam =
    norm.category === "tv"
      ? st.modelFamily?.toLowerCase().replace(/[^a-z0-9]/g, "") ??
        u.modelFamilyNorm
      : u.modelFamilyNorm;
  const sku =
    st.fullModel?.toLowerCase().replace(/[^a-z0-9]/g, "") ??
    u.retailerSkuNorm;

  const inferred = inferCategoryHint(norm.category);
  const catHint = collapseWs(
    uniqNormTokens(
      [u.categoryHintNorm, inferred].filter((x): x is string => Boolean(x))
    ).join(" ")
  );

  const resolutionPerfNorm =
    u.resolutionPerfNorm ??
    (st.resolution
      ? st.resolution === "8k"
        ? "res_8k"
        : st.resolution === "4k"
          ? "res_4k_uhd"
          : st.resolution === "hd"
            ? "res_hd"
            : null
      : null);

  const flags: ProductUnderstandingFlags = {
    smart:
      u.flags.smart ??
      (norm.category === "tv" ? st.smartTv : null),
    wireless: u.flags.wireless,
    cordlessOrBattery: u.flags.cordlessOrBattery,
    electric: u.flags.electric,
  };

  let extraSpecs = [...u.keySpecsNorm];
  if (norm.sizeInches != null) {
    extraSpecs.push(`${norm.sizeInches}inch`);
  }

  return mergeUnderstandingBase(u, {
    categoryHintNorm: catHint.length >= 3 ? catHint : inferred,
    brandNorm,
    modelFamilyNorm: tvFam,
    retailerSkuNorm: sku,
    quantityCount: norm.packCount ?? u.quantityCount,
    colorNorm: st.color ?? u.colorNorm,
    resolutionPerfNorm,
    flags,
    keySpecsNorm: uniqNormTokens(extraSpecs),
    extractionConfidence: Math.min(
      0.92,
      u.extractionConfidence + (brandNorm ? 0.04 : 0) + (tvFam ? 0.05 : 0)
    ),
  });
}

function applyScrapedHints(
  hints: SourceScrapedHints | null | undefined,
  u: ProductUnderstanding
): ProductUnderstanding {
  if (!hints) return u;

  let next = u;
  if (hints.brand?.trim()) {
    next = mergeUnderstandingBase(next, {
      brandNorm: hints.brand.trim().toLowerCase(),
      extractionConfidence: Math.min(0.93, next.extractionConfidence + 0.06),
    });
  }
  if (hints.modelOrMpn?.trim()) {
    const m = normTokenAlnum(hints.modelOrMpn);
    if (m.length >= 4) {
      next = mergeUnderstandingBase(next, {
        modelFamilyNorm: next.modelFamilyNorm ?? m,
        extractionConfidence: Math.min(0.94, next.extractionConfidence + 0.07),
      });
    }
  }
  if (hints.retailerSku?.trim()) {
    const s = hints.retailerSku.replace(/\s+/g, "").toLowerCase();
    if (s.length >= 4) {
      next = mergeUnderstandingBase(next, {
        retailerSkuNorm: next.retailerSkuNorm ?? s,
        extractionConfidence: Math.min(0.94, next.extractionConfidence + 0.08),
      });
    }
  }
  if (hints.categoryTrail?.trim()) {
    const trail = normalizeUnderstandingBlob(hints.categoryTrail.replace(/›/g, " "));
    if (trail.length >= 6) {
      next = mergeUnderstandingBase(next, {
        categoryHintNorm: uniqNormTokens([
          ...(next.categoryHintNorm?.split(/\s+/) ?? []),
          trail,
        ]).join(" "),
        extractionConfidence: Math.min(0.94, next.extractionConfidence + 0.05),
      });
    }
  }
  return next;
}

function applyUrlIdentity(
  url: string | null | undefined,
  u: ProductUnderstanding
): ProductUnderstanding {
  if (!url?.trim()) return u;
  const ids = retailerIdsFromUrl(url);
  if (ids.length === 0) return u;
  const longest = [...ids].sort((a, b) => b.length - a.length)[0]!;
  return mergeUnderstandingBase(u, {
    retailerSkuNorm: u.retailerSkuNorm ?? longest,
    extractionConfidence: Math.min(0.9, u.extractionConfidence + 0.04),
  });
}

/**
 * Reference listing: combine PDP hints, URL identities, normalized snapshot, and free text.
 */
export function buildReferenceUnderstanding(args: {
  primaryTitle: string;
  supplementaryText?: string;
  sourceUrl?: string | null;
  scrapedHints?: SourceScrapedHints | null;
  normalized: NormalizedProduct;
  scrapedListingOk: boolean;
}): ProductUnderstanding {
  const blob = collapseWs(
    `${args.primaryTitle}\n${args.supplementaryText ?? ""}`
  );

  const provenance: ProductUnderstandingProvenance = args.scrapedListingOk
    ? "url_metadata"
    : args.sourceUrl?.trim()
      ? "url_slug_fallback"
      : "title_description";

  let u = extractUnderstandingFromText(blob);
  u = mergeUnderstandingBase(u, { provenance });
  u = overlayNormalizedSnapshot(args.normalized, u);
  u = applyScrapedHints(args.scrapedHints, u);
  u = applyUrlIdentity(args.sourceUrl, u);

  if (args.scrapedListingOk) {
    u = mergeUnderstandingBase(u, {
      extractionConfidence: Math.min(0.94, u.extractionConfidence + 0.12),
    });
  } else if (args.sourceUrl?.trim()) {
    u = mergeUnderstandingBase(u, {
      extractionConfidence: Math.min(0.88, u.extractionConfidence + 0.05),
    });
  }

  return u;
}

/** Candidate row understanding — lightweight vs reference. */
export function buildCandidateUnderstanding(
  norm: NormalizedProduct,
  listingTitle: string
): ProductUnderstanding {
  let u = extractUnderstandingFromText(listingTitle);
  u = overlayNormalizedSnapshot(norm, u);
  u = applyUrlIdentity(norm.structured.productUrl, u);
  u = mergeUnderstandingBase(u, {
    provenance: "title_description",
    extractionConfidence: Math.min(0.72, u.extractionConfidence),
  });
  return u;
}

function flagsConflict(
  a: ProductUnderstandingFlags,
  b: ProductUnderstandingFlags
): boolean {
  if (
    a.cordlessOrBattery === true &&
    b.cordlessOrBattery === false
  )
    return true;
  if (
    a.cordlessOrBattery === false &&
    b.cordlessOrBattery === true
  )
    return true;
  return false;
}

function needleInBlob(needle: string, blob: string): boolean {
  const n = normTokenAlnum(needle);
  if (n.length < 5) return blob.includes(needle.toLowerCase());
  return blob.includes(n);
}

/**
 * Structured overlap 0–100 for blending into attributeMatch (not substring title scoring).
 */
export function scoreUnderstandingOverlap(
  ref: ProductUnderstanding,
  cand: ProductUnderstanding,
  candidateTitle: string
): UnderstandingOverlapResult {
  const blob = normalizeUnderstandingBlob(
    `${candidateTitle} ${cand.categoryHintNorm ?? ""}`
  );
  const reasons: string[] = [];
  let pts = 0;
  let exactIdentityMatch = false;

  if (
    ref.retailerSkuNorm &&
    ref.retailerSkuNorm.length >= 6 &&
    needleInBlob(ref.retailerSkuNorm, blob)
  ) {
    pts += 44;
    exactIdentityMatch = true;
    reasons.push("structured_identity_sku_or_model_hit");
  }

  if (
    ref.gtinNorm &&
    ref.gtinNorm.length >= 12 &&
    blob.includes(ref.gtinNorm)
  ) {
    pts += 48;
    exactIdentityMatch = true;
    reasons.push("structured_identity_gtin_hit");
  }

  if (ref.brandNorm && cand.brandNorm) {
    if (ref.brandNorm === cand.brandNorm) {
      pts += 16;
      reasons.push("structured_brand_exact");
    }
  } else if (ref.brandNorm && blob.includes(ref.brandNorm)) {
    pts += 13;
    reasons.push("structured_brand_in_candidate_copy");
  }

  if (ref.modelFamilyNorm && cand.modelFamilyNorm) {
    const a = ref.modelFamilyNorm;
    const b = cand.modelFamilyNorm;
    if (a === b || a.includes(b) || b.includes(a)) {
      pts += 22;
      reasons.push("structured_model_family_alignment");
    }
  } else if (ref.modelFamilyNorm && needleInBlob(ref.modelFamilyNorm, blob)) {
    pts += 17;
    reasons.push("structured_model_family_in_candidate_title");
  }

  if (ref.dimensionsNorm && cand.dimensionsNorm) {
    if (ref.dimensionsNorm === cand.dimensionsNorm) {
      pts += 14;
      reasons.push("structured_dimensions_exact");
    }
  } else if (ref.dimensionsNorm && blob.includes(ref.dimensionsNorm)) {
    pts += 11;
    reasons.push("structured_dimensions_in_candidate");
  }

  if (
    ref.capacityStorageNorm &&
    cand.capacityStorageNorm &&
    ref.capacityStorageNorm === cand.capacityStorageNorm
  ) {
    pts += 12;
    reasons.push("structured_capacity_match");
  } else if (
    ref.capacityStorageNorm &&
    blob.includes(ref.capacityStorageNorm)
  ) {
    pts += 9;
    reasons.push("structured_capacity_in_candidate");
  }

  if (
    ref.resolutionPerfNorm &&
    cand.resolutionPerfNorm &&
    ref.resolutionPerfNorm === cand.resolutionPerfNorm
  ) {
    pts += 12;
    reasons.push("structured_resolution_bucket_match");
  } else if (
    ref.resolutionPerfNorm &&
    blob.includes(ref.resolutionPerfNorm)
  ) {
    pts += 9;
    reasons.push("structured_resolution_signal_in_candidate");
  }

  if (ref.categoryHintNorm) {
    const tokens = ref.categoryHintNorm.split(/\s+/).filter((t) => t.length >= 3);
    let hits = 0;
    for (const t of tokens) {
      if (blob.includes(t)) hits++;
    }
    if (hits >= 2) {
      pts += 10;
      reasons.push("structured_category_hint_overlap");
    } else if (hits === 1 && tokens.length <= 2) {
      pts += 6;
      reasons.push("structured_category_hint_partial");
    }
  }

  let specHits = 0;
  for (const spec of ref.keySpecsNorm) {
    if (spec.length >= 3 && blob.includes(spec)) specHits++;
  }
  pts += Math.min(26, specHits * 7);
  if (specHits > 0) {
    reasons.push(`structured_spec_hits(${specHits})`);
  }

  if (
    ref.colorNorm &&
    cand.colorNorm &&
    ref.colorNorm === cand.colorNorm
  ) {
    pts += 6;
    reasons.push("structured_color_match");
  }

  if (
    ref.quantityCount != null &&
    cand.quantityCount != null &&
    ref.quantityCount === cand.quantityCount
  ) {
    pts += 8;
    reasons.push("structured_quantity_match");
  }

  if (flagsConflict(ref.flags, cand.flags)) {
    pts -= 18;
    reasons.push("structured_power_style_conflict_penalty");
  }

  const score = Math.max(0, Math.min(100, pts));
  reasons.push(`structured_understanding_score=${score}`);
  return { score, reasons, exactIdentityMatch };
}

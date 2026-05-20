/**
 * Compare orchestrator — see `LEGACY.md` for the full active flow.
 * Discovery: `fetchGoogleShoppingCandidatesWithDiagnostics` (not provider `searchCandidates`).
 * Category-specific query rules (TV, pool, etc.) are inline technical debt → future category plugins.
 */
import {
  scoreAttributeMatch,
  type AttributeMatchResult,
} from "./attributeMatch";
import {
  buildReferenceUnderstanding,
  mergeExtraKeySpecsIntoUnderstanding,
} from "./aiExtractor";
import { fetchAiCompareEnrichment } from "./aiCompareEnrichment";
import {
  aiProductMetadataSearchQueries,
  applyAiProductMetadataToUnderstanding,
  fetchAiProductMetadata,
} from "./aiProductMetadata";
import { toAffiliateUrl } from "./affiliateUrl";
import {
  buildCriticalShoppingCoreSegments,
  withCriticalAttributes,
} from "./criticalAttributes";
import { fetchGoogleShoppingCandidatesWithDiagnostics } from "./googleShoppingSearch";
import { parseProductInput } from "./inputParse";
import {
  buildManualNormalizationTitle,
  buildUniversalManualQueryPack,
  isValidReferencePriceInput,
  manualFormHasSearchableCore,
  parsePricePaidRaw,
  REFERENCE_PRICE_REQUIRED_MESSAGE,
  truncateFeatures,
} from "./manualProductInput";
import {
  areSameRetailerListings,
  buildNormalizedProduct,
  buildNormalizedSearchQuery,
  detectStoreFromProductUrl,
  extractSearchQuery,
} from "./normalize";
import { scrapeProduct, toSourceScrapedHints } from "./scrapeProduct";
import {
  isGenericRetailProductQuery,
  looksLikeAmazonAsinToken,
} from "./urlProductQuery";
import { isUsablePdpTitle } from "./usablePdpTitle";
import { findProductProviderForUrl } from "./registry";
import {
  identityMatchLabel,
  rankIdentityMatchTypes,
  scoreProductIdentity,
  type ProductIdentityResult,
} from "./matching/productIdentity";
import { getSimulatedStoreCoupons } from "../premium/couponOffers";
import {
  isBlockedUserFacingOutboundUrl,
  isProductDetailStoreKey,
  isStrictProductDetailUrl,
  isValidUserFacingCompareOutbound,
} from "./productDetailUrl";
import { resolveCompareCandidateOutbound } from "./productUrlResolver";
import { resolveDisplayedSearchPdps } from "./searchPdpResolve";
import type {
  CandidateProduct,
  CandidateStepTrace,
  CompareApiCandidate,
  CompareConfidence,
  CompareProductDeal,
  CompareProductOptions,
  CompareProductResponse,
  ComparisonTrace,
  NormalizedProduct,
  PremiumCouponOffer,
  ProductCategory,
  ProviderSearchDiagnostics,
  SelectionTrace,
  SourceProduct,
  StoreId,
  TvDisplayTechBucket,
  UniversalStoreId,
} from "./types";

/**
 * Engine-only demo flag: deterministic multi-store pipeline without live SERP.
 * Set `PRODUCT_COMPARE_DEMO_MODE=true` in the server environment.
 */
export const DEMO_MODE = process.env.PRODUCT_COMPARE_DEMO_MODE === "true";

/** Server-only verbose logs + `options.debug` traces. Default off (set DEBUG_COMPARE=true to enable). */
const COMPARE_VERBOSE = process.env.DEBUG_COMPARE === "true";

export function isCompareDemoMode(): boolean {
  return DEMO_MODE;
}

/** Three short retailer-search strings: model-led → brand+size+type → size+tech+type. */
export type RetailSearchQueryPack = {
  primaryQuery: string;
  simplifiedQuery: string;
  specsQuery: string;
};

function formatBrandTitleCase(brand: string | null): string {
  if (!brand) return "";
  return brand
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function compactTvSkuForSearch(sku: string): string {
  return sku
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/(FXZA|XZA|XZ)$/i, "");
}

const CATEGORY_TYPE_WORD: Record<ProductCategory, string> = {
  tv: "TV",
  monitor: "Monitor",
  footwear: "Shoes",
  audio: "Headphones",
  socks: "Socks",
  apparel: "Clothing",
  household: "Household",
  general: "Product",
};

function tvDisplayTechLabel(tech: TvDisplayTechBucket): string | null {
  switch (tech) {
    case "mini_led":
      return "Mini LED";
    case "neo_qled":
      return "Neo QLED";
    case "qled":
      return "QLED";
    case "oled":
      return "OLED";
    case "crystal_led":
      return "Crystal LED";
    case "led":
      return "LED";
    default:
      return null;
  }
}

function inferDisplayTechLabelFromText(title: string): string | null {
  const n = title.toLowerCase();
  if (/\bmini[\s-]*led\b/.test(n)) return "Mini LED";
  if (/\bneo[\s-]*qled\b/.test(n)) return "Neo QLED";
  if (/\bqled\b/.test(n)) return "QLED";
  if (/\boled\b/.test(n)) return "OLED";
  if (/\bcrystal[\s-]*led\b/.test(n)) return "Crystal LED";
  if (/\bled\b/.test(n)) return "LED";
  return null;
}

function pickShortModelForPrimary(norm: NormalizedProduct): string | null {
  const fm = norm.structured.fullModel;
  if (fm && fm.length >= 4) return compactTvSkuForSearch(fm);
  for (const t of norm.modelTokens) {
    const u = t.replace(/-/g, "");
    if (/\d/.test(u) && u.length >= 5) return u.toUpperCase();
  }
  if (norm.structured.modelFamily && norm.structured.modelFamily.length >= 3) {
    return norm.structured.modelFamily.toUpperCase().replace(/[^A-Z0-9]/g, "");
  }
  return null;
}

function buildPrimaryQuery(norm: NormalizedProduct, referenceTitle: string): string {
  const brand = formatBrandTitleCase(norm.brand);
  const model = pickShortModelForPrimary(norm);
  if (brand && model) return `${brand} ${model}`.replace(/\s+/g, " ").trim();
  if (model && !brand) return model;
  const compact = extractSearchQuery(referenceTitle).replace(/\s+/g, " ").trim();
  if (brand && compact) return `${brand} ${compact}`.replace(/\s+/g, " ").trim();
  return (
    compact ||
    referenceTitle
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120)
  );
}

function categoryTypeWord(cat: ProductCategory): string {
  return CATEGORY_TYPE_WORD[cat] ?? "Product";
}

function buildSimplifiedQuery(norm: NormalizedProduct, referenceTitle: string): string {
  const brand = formatBrandTitleCase(norm.brand);
  const typeWord = categoryTypeWord(norm.category);
  const size = norm.sizeInches;
  if (brand) {
    if (size != null) {
      return `${brand} ${size} inch ${typeWord}`.replace(/\s+/g, " ").trim();
    }
    return `${brand} ${typeWord}`.replace(/\s+/g, " ").trim();
  }
  if (size != null) return `${size} inch ${typeWord}`.replace(/\s+/g, " ").trim();
  return extractSearchQuery(referenceTitle).replace(/\s+/g, " ").trim();
}

function buildSpecsQuery(norm: NormalizedProduct, referenceTitle: string): string {
  const typeWord = categoryTypeWord(norm.category);
  const size = norm.sizeInches;
  const tvTech =
    norm.category === "tv" && norm.tv
      ? tvDisplayTechLabel(norm.tv.displayTech)
      : inferDisplayTechLabelFromText(referenceTitle);
  const parts: string[] = [];
  if (size != null) parts.push(`${size} inch`);
  if (tvTech) parts.push(tvTech);
  parts.push(typeWord);
  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  if (joined.length >= 4) return joined;
  return extractSearchQuery(referenceTitle).replace(/\s+/g, " ").trim();
}

/**
 * Short series/model token for PDP-led search (e.g. "U8000" from "U8000 Series"),
 * preferable to a long UN… SKU for Google Shopping recall.
 */
function extractPdpShortModelKey(pdpTitle: string, norm: NormalizedProduct): string | null {
  const ser = pdpTitle.match(/\b(U\d{4})\b/);
  if (ser) return ser[1]!.toUpperCase();
  const ser2 = pdpTitle.match(/\b([A-Z]{1,2}\d{3,5})\s+Series\b/i);
  if (ser2) return ser2[1]!.toUpperCase();
  const mf = norm.structured.modelFamily?.trim();
  if (mf && mf.length >= 3 && mf.length <= 12) return mf.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return null;
}

/** PDP query line: never use the vague word "Product" (hurts SERP recall). */
function inferPdpProductTypeWord(norm: NormalizedProduct, pdpTitle: string): string {
  const t = pdpTitle.toLowerCase();
  if (norm.category === "tv" || /\b(smart\s+)?tv\b/.test(t)) return "TV";
  if (norm.category === "monitor" || /\bmonitor\b/.test(t)) return "Monitor";
  if (
    /\b(headphone|earbud|ear\s*buds?)\b/.test(t) ||
    norm.category === "audio"
  ) {
    return "Headphones";
  }
  if (/\b(shoe|sneaker|boot)\b/.test(t) || norm.category === "footwear") {
    return "Shoes";
  }
  if (/\bsock\b/.test(t) || norm.category === "socks") return "Socks";
  if (/\b(hoodie|shirt|jacket)\b/.test(t) || norm.category === "apparel")
    return "Clothing";
  if (/\b(cleaner|detergent|laundry|soap|spray)\b/.test(t)) return "Household";
  if (norm.category !== "general") return categoryTypeWord(norm.category);
  return "item";
}

function pdpSpecsDisplayPhrase(
  norm: NormalizedProduct,
  pdpTitle: string
): string | null {
  if (/\bcrystal\s*uhd\b/i.test(pdpTitle)) return "Crystal UHD";
  if (/\bneo\s*qled\b/i.test(pdpTitle)) return "Neo QLED";
  if (/\bmini\s*led\b/i.test(pdpTitle)) return "Mini LED";
  const fromNorm =
    norm.category === "tv" && norm.tv
      ? tvDisplayTechLabel(norm.tv.displayTech)
      : null;
  if (fromNorm) return fromNorm;
  return inferDisplayTechLabelFromText(pdpTitle);
}

function pdpCompactExtractFallback(pdpTitle: string): string {
  const ex = extractSearchQuery(pdpTitle).replace(/\s+/g, " ").trim();
  if (ex.length > 0 && ex.length <= 90) return ex;
  const tok = pdpTitle
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 8)
    .join(" ");
  return tok.slice(0, 88).trim();
}

function isUsableRetailerQuery(q: string): boolean {
  const t = q.replace(/\s+/g, " ").trim();
  if (t.length < 4) return false;
  if (looksLikeAmazonAsinToken(t)) return false;
  if (isGenericRetailProductQuery(t)) return false;
  if (/^product$/i.test(t)) return false;
  return true;
}

/**
 * URL/PDP path: three short, retailer-style queries from the scraped PDP title only
 * (no URL slug, no single giant raw title as the primary search string).
 */
export function buildPdpRetailSearchQueryPack(
  norm: NormalizedProduct,
  pdpTitle: string
): RetailSearchQueryPack {
  const title = pdpTitle.replace(/\s+/g, " ").trim();
  const brand = formatBrandTitleCase(norm.brand);
  const typeWord = inferPdpProductTypeWord(norm, title);
  const size = norm.sizeInches;

  const shortSeries = extractPdpShortModelKey(title, norm);
  const skuCompact = pickShortModelForPrimary(norm);

  let modelPrimary: string;
  if (brand && shortSeries) {
    modelPrimary = `${brand} ${shortSeries}`.replace(/\s+/g, " ").trim();
  } else if (brand && skuCompact) {
    const sku = skuCompact.length > 14 ? shortSeries || skuCompact.slice(0, 12) : skuCompact;
    modelPrimary = `${brand} ${sku}`.replace(/\s+/g, " ").trim();
  } else if (shortSeries) {
    modelPrimary = shortSeries;
  } else if (skuCompact) {
    modelPrimary = skuCompact;
  } else if (brand) {
    const mini = extractSearchQuery(title).replace(/\s+/g, " ").trim().slice(0, 48);
    modelPrimary = mini ? `${brand} ${mini}`.replace(/\s+/g, " ").trim() : brand;
  } else {
    modelPrimary = pdpCompactExtractFallback(title);
  }

  let core: string;
  if (brand) {
    core =
      size != null
        ? `${brand} ${size} inch ${typeWord}`.replace(/\s+/g, " ").trim()
        : `${brand} ${typeWord}`.replace(/\s+/g, " ").trim();
  } else if (size != null) {
    core = `${size} inch ${typeWord}`.replace(/\s+/g, " ").trim();
  } else {
    core = `${extractSearchQuery(title).replace(/\s+/g, " ").trim()}`.slice(0, 80);
  }

  const specPhrase = pdpSpecsDisplayPhrase(norm, title);
  const specsParts: string[] = [];
  if (size != null) specsParts.push(`${size} inch`);
  if (specPhrase) specsParts.push(specPhrase);
  specsParts.push(typeWord);
  let specs = specsParts.join(" ").replace(/\s+/g, " ").trim();
  if (specs.length < 6) {
    const tw = inferPdpProductTypeWord(norm, title);
    const altParts: string[] = [];
    if (size != null) altParts.push(`${size} inch`);
    const ph = pdpSpecsDisplayPhrase(norm, title);
    if (ph) altParts.push(ph);
    altParts.push(tw);
    specs = altParts.join(" ").replace(/\s+/g, " ").trim();
  }

  const fallback = pdpCompactExtractFallback(title);

  const ensure = (s: string, alt: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    if (isUsableRetailerQuery(t)) return t;
    const u = alt.replace(/\s+/g, " ").trim();
    return isUsableRetailerQuery(u) ? u : fallback.slice(0, 90);
  };

  return {
    primaryQuery: ensure(modelPrimary, core),
    simplifiedQuery: ensure(core, specs),
    specsQuery: ensure(specs, core),
  };
}

export function buildRetailSearchQueryPack(
  norm: NormalizedProduct,
  referenceTitle: string
): RetailSearchQueryPack {
  const fallback =
    extractSearchQuery(referenceTitle).replace(/\s+/g, " ").trim() ||
    referenceTitle.replace(/\s+/g, " ").trim().slice(0, 120);

  const primary = buildPrimaryQuery(norm, referenceTitle);
  const simplified = buildSimplifiedQuery(norm, referenceTitle);
  const specs = buildSpecsQuery(norm, referenceTitle);

  const ensure = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    if (t.length < 2) return fallback;
    if (looksLikeAmazonAsinToken(t)) return fallback;
    return t;
  };

  return {
    primaryQuery: ensure(primary),
    simplifiedQuery: ensure(simplified),
    specsQuery: ensure(specs),
  };
}

/**
 * Progressive Google Shopping queries: immutable specs first (cross-brand), then brand-anchor,
 * then legacy retailer packs for recall.
 */
export function buildUniversalShoppingQueryPlan(args: {
  referenceNormalized: NormalizedProduct;
  referenceTitle: string;
  explicitQueryPack: RetailSearchQueryPack | null;
  /** When set (e.g. after PDP scrape), use this pack instead of rebuilding from `referenceTitle` */
  resolvedRetailPack?: RetailSearchQueryPack | null;
  /**
   * Scraped PDP title path: run Shopping with only the short 3-query pack (no long
   * critical-segment / URL-noise prefixes).
   */
  pdpTitleSearchPlanOnly?: boolean;
}): string[] {
  const {
    referenceNormalized,
    referenceTitle,
    explicitQueryPack,
    resolvedRetailPack,
    pdpTitleSearchPlanOnly,
  } = args;
  const brand = formatBrandTitleCase(referenceNormalized.brand);
  const brandStrippedNorm: NormalizedProduct = {
    ...referenceNormalized,
    brand: null,
    structured: { ...referenceNormalized.structured, brand: null },
  };
  let titleForCore = referenceTitle;
  if (referenceNormalized.brand) {
    const rawB = referenceNormalized.brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    titleForCore = referenceTitle.replace(new RegExp(`\\b${rawB}\\b`, "gi"), " ");
  }
  const core = buildNormalizedSearchQuery(brandStrippedNorm, titleForCore).replace(/\s+/g, " ");
  const segments = buildCriticalShoppingCoreSegments(
    referenceNormalized,
    referenceTitle
  ).join(" ");
  let hardStrict = `${segments} ${core}`.replace(/\s+/g, " ").trim();
  if (hardStrict.length < 8) {
    hardStrict = extractSearchQuery(referenceTitle).replace(/\s+/g, " ");
  }
  const withBrand =
    brand && hardStrict ? `${brand} ${hardStrict}`.replace(/\s+/g, " ").trim() : "";

  const pack =
    resolvedRetailPack ??
    explicitQueryPack ??
    buildRetailSearchQueryPack(referenceNormalized, referenceTitle);

  if (pdpTitleSearchPlanOnly) {
    const orderedPdp = [
      pack.primaryQuery,
      pack.simplifiedQuery,
      pack.specsQuery,
    ];
    const seenPdp = new Set<string>();
    const outPdp: string[] = [];
    for (const q of orderedPdp) {
      const t = q.replace(/\s+/g, " ").trim();
      if (t.length < 4) continue;
      if (seenPdp.has(t)) continue;
      seenPdp.add(t);
      outPdp.push(t);
    }
    return outPdp;
  }

  const ordered = [
    hardStrict,
    withBrand,
    pack.primaryQuery,
    pack.simplifiedQuery,
    pack.specsQuery,
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of ordered) {
    const t = q.replace(/\s+/g, " ").trim();
    if (t.length < 4) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Prefer AI-suggested queries first (cross-brand recall), then legacy progressive plan. */
function mergeShoppingQueryPlans(
  headQueries: string[],
  tailPlan: string[],
  maxQueries: number
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of [...headQueries, ...tailPlan]) {
    const t = q.replace(/\s+/g, " ").trim();
    if (t.length < 4) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= maxQueries) break;
  }
  return out;
}

function candidateViolatesLlmExclusions(
  title: string,
  exclusions: string[]
): boolean {
  if (exclusions.length === 0) return false;
  const lower = title.toLowerCase();
  for (const ex of exclusions) {
    const phrase = ex.replace(/\s+/g, " ").trim().toLowerCase();
    if (phrase.length >= 4 && lower.includes(phrase)) return true;
  }
  return false;
}

const DEMO_STORES: StoreId[] = [
  "amazon",
  "walmart",
  "target",
  "temu",
  "bestbuy",
  "homedepot",
  "lowes",
];

/** Target minimum cheaper-than-reference rows when a reference price exists */
const MIN_CHEAPER_RESULTS_TARGET = 10;

/** Max store rows returned in `candidates` / UI lists */
const DISPLAY_LIMIT = 14;

export { buildRetailerSearchUrlFromTitle } from "./productUrlResolver";

function isValidComparablePrice(price: number | null | undefined): boolean {
  return price != null && Number.isFinite(price) && price > 0;
}

function logReferencePriceOutcome(args: {
  url: string | null;
  price: number | null;
  source?: string | null;
  store?: string | null;
  reason?: string;
}): void {
  if (process.env.PRODUCT_SHOPPING_DEBUG !== "1") return;
  const { url, price, source, store, reason } = args;
  const storeId =
    store ??
    (url ? detectStoreFromProductUrl(url) : null) ??
    "unknown";
  if (price != null && isValidComparablePrice(price)) {
    console.log(
      "[REFERENCE_PRICE_EXTRACTED]",
      JSON.stringify({
        price,
        source: source ?? "unknown",
        store: storeId,
        url: url?.slice(0, 400) ?? null,
      })
    );
    return;
  }
  if (url) {
    console.log(
      "[REFERENCE_PRICE_MISSING]",
      JSON.stringify({
        reason: reason ?? "no_comparable_price",
        store: storeId,
        url: url.slice(0, 400),
      })
    );
  }
}

function pipelineLog(phase: string, data?: Record<string, unknown>) {
  if (!COMPARE_VERBOSE) return;
  console.log("[compare-product]", phase, data ?? {});
}

function normalizeUrlKey(url: string): string {
  try {
    return url.split("?")[0].toLowerCase().trim();
  } catch {
    return url.toLowerCase().trim();
  }
}

function pickBetterDuplicateListing(
  a: CandidateProduct,
  b: CandidateProduct
): CandidateProduct {
  const ca = a.sourceConfidence ?? 0;
  const cb = b.sourceConfidence ?? 0;
  if (Math.abs(ca - cb) >= 1e-4) return ca >= cb ? a : b;
  const pa = a.price ?? Number.POSITIVE_INFINITY;
  const pb = b.price ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa <= pb ? a : b;
  return a;
}

/** Search / generated listing URLs — identity is not the shared SERP path without query. */
function listingUsesSearchStyleIdentity(
  store: UniversalStoreId,
  productUrl: string
): boolean {
  if (store === "other") {
    const listing = productUrl.replace(/\s+/g, " ").trim();
    if (!listing) return true;
    try {
      const u = new URL(listing);
      const host = u.hostname.replace(/^www\./i, "").toLowerCase();
      if (
        (host === "google.com" || host.endsWith(".google.com")) &&
        u.pathname.toLowerCase().startsWith("/search")
      ) {
        return true;
      }
    } catch {
      return true;
    }
    return false;
  }
  const listing = productUrl.replace(/\s+/g, " ").trim();
  if (!listing) return true;
  return !isStrictProductDetailUrl(store, listing);
}

function normalizePriceDedupeKey(price: number | null): string {
  if (price == null || !Number.isFinite(price)) return "";
  return price.toFixed(2);
}

function normalizeImageDedupeKey(imageUrl: string | null): string {
  if (!imageUrl?.trim()) return "";
  try {
    const u = new URL(imageUrl.trim());
    const leaf = u.pathname.split("/").pop() ?? "";
    return leaf.toLowerCase().slice(0, 160);
  } catch {
    return imageUrl.trim().toLowerCase().slice(0, 160);
  }
}

function searchListingDedupeCompositeKey(item: CandidateProduct): string {
  const q = item.shoppingQueryUsed?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
  const src = item.sourceLabel?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
  return [
    item.store,
    item.normalized.titleNorm,
    normalizePriceDedupeKey(item.price),
    normalizeImageDedupeKey(item.imageUrl),
    q,
    src,
  ].join("|");
}

function dedupeByStoreAndUrl(items: CandidateProduct[]): CandidateProduct[] {
  const map = new Map<string, CandidateProduct>();
  for (const item of items) {
    const searchStyle = listingUsesSearchStyleIdentity(item.store, item.productUrl);
    const key = searchStyle
      ? `s:${searchListingDedupeCompositeKey(item)}`
      : `p:${item.store}|${normalizeUrlKey(item.productUrl)}`;

    const prev = map.get(key);
    if (!prev) {
      map.set(key, item);
      if (searchStyle && COMPARE_VERBOSE) {
        console.log("[SEARCH_URL_DEDUPE_KEEP]", {
          store: item.store,
          titlePreview: item.title.slice(0, 100),
          price: item.price,
          hasImage: Boolean(item.imageUrl?.trim()),
        });
      }
      continue;
    }

    const winner = pickBetterDuplicateListing(prev, item);
    const loser = winner === prev ? item : prev;

    if (searchStyle && COMPARE_VERBOSE) {
      console.log("[SEARCH_URL_DEDUPE_DROP]", {
        store: loser.store,
        droppedTitlePreview: loser.title.slice(0, 100),
        keptTitlePreview: winner.title.slice(0, 100),
        droppedPrice: loser.price,
        keptPrice: winner.price,
      });
    }

    map.set(key, winner);
  }
  return [...map.values()];
}

function queryDerivedSourceSummary(
  productQuery: string,
  detectedStore: StoreId | null,
  norm: import("./types").NormalizedProduct
): NonNullable<CompareProductResponse["sourceProduct"]> {
  return {
    title: productQuery,
    store: detectedStore ?? "unknown",
    originalPrice: null,
    currency: "USD",
    normalizedTitle: norm.titleNorm,
  };
}

function extractedSourceSummary(
  sp: SourceProduct,
  fallbackUrl?: string
): NonNullable<CompareProductResponse["sourceProduct"]> {
  return {
    sourceUrl: sp.sourceUrl ?? fallbackUrl,
    store: sp.store,
    title: sp.title,
    originalPrice: sp.originalPrice,
    currency: sp.currency,
    imageUrl: sp.imageUrl ?? null,
    normalizedTitle: sp.normalized.titleNorm,
  };
}

const DEMO_PRICE_BY_STORE: Record<StoreId, number> = {
  amazon: 129.99,
  walmart: 119.0,
  target: 124.49,
  temu: 109.0,
  bestbuy: 122.0,
  homedepot: 118.0,
  lowes: 121.0,
  costco: 117.5,
  samsclub: 116.0,
  ebay: 112.0,
  macys: 125.0,
  kohls: 118.5,
  wayfair: 114.0,
  overstock: 110.0,
  chewy: 115.0,
  academy: 119.0,
  tractorsupply: 120.0,
  nike: 128.0,
  adidas: 127.0,
};

function buildDemoCandidates(
  referenceNorm: import("./types").NormalizedProduct,
  searchQuery: string,
  stores: readonly StoreId[]
): CandidateProduct[] {
  const base =
    referenceNorm.titleNorm.slice(0, 80) ||
    searchQuery.slice(0, 80) ||
    "demo wireless headphones";
  const slug = base.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const sharedNorm: import("./types").NormalizedProduct = { ...referenceNorm };

  return stores.map((store) => ({
    store,
    title: `${base} (${store} demo)`,
    price: DEMO_PRICE_BY_STORE[store],
    currency: "USD",
    productUrl: `https://${store}.example.com/p/DEMO-${slug.slice(0, 8)}`,
    affiliateUrl: `https://${store}.example.com/p/DEMO-${slug.slice(0, 8)}`,
    imageUrl: null,
    normalized: { ...sharedNorm },
    sourceConfidence: 0.94,
  }));
}

function candidateKey(c: CandidateProduct, index: number): string {
  return `${c.store}:${index}:${c.productUrl.slice(-14)}`;
}

function emptyGoogleDiagnostics(query: string): ProviderSearchDiagnostics {
  return {
    store: "google_shopping",
    query,
    fetchOk: false,
    httpStatus: null,
    byteLength: 0,
    candidateCount: 0,
    hints: ["skipped_during_demo_mode"],
  };
}

function relevanceReasonLine(
  rel: AttributeMatchResult,
  identity: ProductIdentityResult
): string {
  const uiLabel = identityMatchLabel(identity.matchType);
  const missing =
    identity.missingCriticalAttributes.length > 0
      ? `; missing: ${identity.missingCriticalAttributes.join(", ")}`
      : "";
  return `${uiLabel} — identity ${identity.identityScore}/100 (attribute ${rel.matchType}, relevance ${rel.relevanceScore})${missing}`;
}

function logCompareCandidateOutbound(candidates: CompareApiCandidate[]): void {
  for (const c of candidates) {
    const outbound = (c.outboundUrl ?? "").replace(/\s+/g, " ").trim();
    const outboundPreview =
      outbound.length > 240 ? `${outbound.slice(0, 240)}…` : outbound;
    console.log("[COMPARE_CANDIDATE_OUTBOUND]", {
      store: c.store,
      title: c.title.replace(/\s+/g, " ").trim().slice(0, 160),
      urlType: c.urlType,
      urlConfidence: c.urlConfidence,
      urlResolutionReason: c.urlResolutionReason ?? null,
      outboundUrl: outboundPreview,
    });
  }
}

function toCompareApiCandidate(
  c: CandidateProduct,
  rel: AttributeMatchResult,
  identity: ProductIdentityResult,
  resolution: import("./productUrlResolver").ResolvedCompareCandidateOutbound,
  premiumCoupons?: PremiumCouponOffer[]
): CompareApiCandidate {
  const outboundRaw = resolution.outboundUrlRaw.trim();
  const affiliateUrl =
    outboundRaw.length > 0 ? toAffiliateUrl(outboundRaw, c.store) : "";
  const storeLabel = c.sourceLabel?.trim() || undefined;

  return {
    store: c.store,
    storeLabel,
    title: c.title,
    price: c.price,
    currency: c.currency,
    productUrl: c.productUrl,
    affiliateUrl,
    imageUrl: c.imageUrl,
    normalized: c.normalized,
    confidence: rel.confidence,
    matchConfidenceLabel: rel.matchConfidenceLabel,
    matchType: identity.matchType,
    attributeMatchType: rel.matchType,
    identityScore: identity.identityScore,
    identityReasons: identity.identityReasons,
    missingCriticalAttributes: identity.missingCriticalAttributes,
    relevanceScore: rel.relevanceScore,
    score: identity.identityScore,
    relevanceReason: relevanceReasonLine(rel, identity),
    premiumCoupons,
    outboundIsStoreSearch: resolution.urlType === "search",
    resolvedProductUrl: resolution.resolvedProductUrl,
    outboundUrl: affiliateUrl || outboundRaw,
    urlType: resolution.urlType,
    urlConfidence: resolution.urlConfidence,
    urlResolutionReason: resolution.urlResolutionReason,
  };
}

function toDeal(
  row: CompareApiCandidate,
  rel: AttributeMatchResult,
  identity: ProductIdentityResult
): CompareProductDeal {
  return {
    store: row.store,
    storeLabel: row.storeLabel,
    title: row.title,
    price: row.price,
    currency: row.currency,
    productUrl: row.productUrl,
    affiliateUrl: row.affiliateUrl,
    imageUrl: row.imageUrl,
    confidence: rel.confidence,
    matchConfidenceLabel: rel.matchConfidenceLabel,
    matchType: identity.matchType,
    attributeMatchType: rel.matchType,
    identityScore: identity.identityScore,
    identityReasons: identity.identityReasons,
    missingCriticalAttributes: identity.missingCriticalAttributes,
    relevanceScore: rel.relevanceScore,
    score: identity.identityScore,
    relevanceReason: relevanceReasonLine(rel, identity),
    premiumCoupons: row.premiumCoupons,
    savingsVsReference: row.savingsVsReference,
    priceCompareSegment: row.priceCompareSegment,
    outboundIsStoreSearch: row.outboundIsStoreSearch,
    resolvedProductUrl: row.resolvedProductUrl,
    outboundUrl: row.outboundUrl,
    urlType: row.urlType,
    urlConfidence: row.urlConfidence,
    urlResolutionReason: row.urlResolutionReason,
  };
}

function sortCandidatesForDisplay(rows: CompareApiCandidate[]): CompareApiCandidate[] {
  return [...rows].sort((a, b) => {
    const t = rankIdentityMatchTypes(a.matchType, b.matchType);
    if (t !== 0) return t;
    if (b.identityScore !== a.identityScore) return b.identityScore - a.identityScore;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const pa = a.price ?? Number.POSITIVE_INFINITY;
    const pb = b.price ?? Number.POSITIVE_INFINITY;
    return pa - pb;
  });
}

function annotateAndOrderCandidates(
  apis: CompareApiCandidate[],
  referencePrice: number | null
): CompareApiCandidate[] {
  const refOk = referencePrice != null && isValidComparablePrice(referencePrice);
  const annotated = apis.map((api) => {
    if (!refOk) {
      return {
        ...api,
        priceCompareSegment: "unknown" as const,
        savingsVsReference: null,
      };
    }
    const p = api.price;
    if (!isValidComparablePrice(p)) {
      return {
        ...api,
        priceCompareSegment: "unknown" as const,
        savingsVsReference: null,
      };
    }
    const price = p as number;
    const cheaper = price < referencePrice!;
    return {
      ...api,
      priceCompareSegment: cheaper ? ("cheaper" as const) : ("not_cheaper" as const),
      savingsVsReference: cheaper ? referencePrice! - price : null,
    };
  });

  if (!refOk) {
    return sortCandidatesForDisplay(annotated);
  }

  const cheaper = annotated.filter((c) => c.priceCompareSegment === "cheaper");
  const notCheaper = annotated.filter((c) => c.priceCompareSegment === "not_cheaper");
  const unknown = annotated.filter((c) => c.priceCompareSegment === "unknown");

  cheaper.sort((a, b) => {
    const pa = a.price ?? Number.POSITIVE_INFINITY;
    const pb = b.price ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    return rankIdentityMatchTypes(a.matchType, b.matchType);
  });
  notCheaper.sort((a, b) => {
    const t = rankIdentityMatchTypes(a.matchType, b.matchType);
    if (t !== 0) return t;
    if (b.identityScore !== a.identityScore) return b.identityScore - a.identityScore;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const pa = a.price ?? Number.POSITIVE_INFINITY;
    const pb = b.price ?? Number.POSITIVE_INFINITY;
    return pa - pb;
  });
  unknown.sort((a, b) => {
    const t = rankIdentityMatchTypes(a.matchType, b.matchType);
    if (t !== 0) return t;
    if (b.identityScore !== a.identityScore) return b.identityScore - a.identityScore;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const pa = a.price ?? Number.POSITIVE_INFINITY;
    const pb = b.price ?? Number.POSITIVE_INFINITY;
    return pa - pb;
  });
  return [...cheaper, ...notCheaper, ...unknown];
}

function storeGroupKey(r: CompareApiCandidate): string {
  if (r.store !== "other") return r.store;
  const lab = r.storeLabel?.replace(/\s+/g, " ").trim().toLowerCase();
  return lab ? `other:${lab}` : "other:unknown";
}

function groupByStore(rows: CompareApiCandidate[]): {
  store: string;
  candidates: CompareApiCandidate[];
}[] {
  const map = new Map<string, CompareApiCandidate[]>();
  const order: string[] = [];
  for (const r of rows) {
    const key = storeGroupKey(r);
    if (!map.has(key)) {
      order.push(key);
      map.set(key, []);
    }
    map.get(key)!.push(r);
  }
  return order.map((store) => ({
    store,
    candidates: sortCandidatesForDisplay(map.get(store)!),
  }));
}

function overallConfidenceFromDeal(
  deal: CompareProductDeal | null
): CompareConfidence | null {
  if (!deal) return null;
  if (deal.matchType === "exact_match" && deal.identityScore >= 78) return "high";
  if (deal.matchType === "exact_match" || deal.matchType === "close_match") return "medium";
  return "low";
}

export async function compareProduct(
  rawInput: string,
  options: CompareProductOptions = {}
): Promise<CompareProductResponse> {
  const manual = options.manualProduct ?? null;
  const manualLink = manual?.link?.trim() ?? "";
  const useManualForm = Boolean(
    manual && !manualLink && manualFormHasSearchableCore(manual)
  );

  let input = rawInput.trim();
  if (useManualForm) {
    input = buildManualNormalizationTitle(manual!).trim();
  }

  if (!input) {
    throw new Error("Missing product input");
  }

  const rawPricePaid =
    options.pricePaid?.trim() ||
    (useManualForm && manual ? manual.pricePaid?.trim() : null) ||
    "";
  if (!isValidReferencePriceInput(rawPricePaid)) {
    throw new Error(REFERENCE_PRICE_REQUIRED_MESSAGE);
  }

  const debug = Boolean(options.debug) && COMPARE_VERBOSE;
  const demoMode = DEMO_MODE;

  const traceLog = (...args: unknown[]) => {
    if (!debug) return;
    const [first, ...rest] = args;
    console.log("[compare-product:debug]", first, ...rest);
  };

  pipelineLog("input_received", {
    inputPreview: input.slice(0, 200),
    demoMode,
    manualForm: useManualForm,
  });

  const parsed = await parseProductInput(input);

  let explicitQueryPack: RetailSearchQueryPack | null = null;
  let explicitReferenceQuery: string | null = null;

  if (useManualForm) {
    const safeLog = {
      brand: manual!.brand ?? "",
      productNameOrModel: manual!.productNameOrModel ?? "",
      category: manual!.category ?? "",
      sizeDimensionsCapacity: manual!.sizeDimensionsCapacity ?? "",
      colorVariant: manual!.colorVariant ?? "",
      keyFeaturesPreview: truncateFeatures(manual!.keyFeatures ?? "", 100),
      hasPricePaid: Boolean(parsePricePaidRaw(manual!.pricePaid)),
    };
    if (COMPARE_VERBOSE) {
      console.log("[MANUAL_PRODUCT_INPUT]", safeLog);
    }

    explicitQueryPack = buildUniversalManualQueryPack(manual!);
    explicitReferenceQuery = explicitQueryPack.primaryQuery;
    if (COMPARE_VERBOSE) {
      console.log("[QUERY_PACK_FROM_FORM]", {
        primaryQuery: explicitQueryPack.primaryQuery.slice(0, 120),
        simplifiedQuery: explicitQueryPack.simplifiedQuery.slice(0, 120),
        specsQuery: explicitQueryPack.specsQuery.slice(0, 120),
      });
    }
  }

  let scrapedSource: SourceProduct | null = null;
  let attemptedPdpExtract = false;
  let referencePriceExtractionSource: string | null = null;
  if (parsed.inputUrl && !demoMode) {
    const urlProvider = findProductProviderForUrl(parsed.inputUrl);
    if (urlProvider) {
      attemptedPdpExtract = true;
      try {
        scrapedSource = await urlProvider.extractSourceProduct(parsed.inputUrl);
        if (scrapedSource?.originalPrice != null) {
          referencePriceExtractionSource = "provider_pdp";
        }
      } catch (err) {
        pipelineLog("extract_source_failed", {
          inputUrl: parsed.inputUrl.slice(0, 200),
          error: err instanceof Error ? err.message : String(err),
        });
        scrapedSource = null;
      }
    } else {
      attemptedPdpExtract = true;
      try {
        const scraped = await scrapeProduct(parsed.inputUrl);
        const title =
          scraped?.productName?.replace(/\s+/g, " ").trim() ||
          parsed.productQuery.replace(/\s+/g, " ").trim();
        if (scraped && title) {
          const store = detectStoreFromProductUrl(parsed.inputUrl) ?? "unknown";
          scrapedSource = {
            sourceUrl: parsed.inputUrl,
            store,
            title,
            originalPrice: scraped.price,
            currency: scraped.currency ?? "USD",
            imageUrl: scraped.imageUrl ?? null,
            normalized: buildNormalizedProduct(title, {
              price: scraped.price,
              currency: scraped.currency ?? "USD",
              productUrl: parsed.inputUrl,
            }),
            scrapedHints: toSourceScrapedHints(scraped) ?? null,
          };
          referencePriceExtractionSource = scraped.priceSource ?? "generic_pdp_scrape";
        }
      } catch (err) {
        pipelineLog("generic_pdp_scrape_failed", {
          inputUrl: parsed.inputUrl.slice(0, 200),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const scrapedOk = Boolean(
    scrapedSource && isUsablePdpTitle(scrapedSource.title)
  );
  const scrapeBotWalled = attemptedPdpExtract && !scrapedOk;
  const referenceProductQuery = scrapedOk
    ? scrapedSource!.title.trim()
    : (
        explicitReferenceQuery?.replace(/\s+/g, " ").trim() ||
        parsed.productQuery.replace(/\s+/g, " ").trim()
      );

  if (!referenceProductQuery) {
    pipelineLog("derive_query_empty", { inputUrl: parsed.inputUrl ?? null });
    return {
      query: parsed.rawInput,
      normalizedQuery: "",
      candidates: [],
      resultsByStore: [],
      bestDeal: null,
      showBestDeal: false,
      confidence: null,
      message:
        "Could not derive a product description from that input. Paste a product name or a store link whose URL includes a readable product title.",
      sourceProduct: null,
      alternatives: [],
      savings: null,
      comparisonMessage:
        "Could not derive a product description from that input.",
      scrapeBotWalled,
      aiProductSummary: null,
    };
  }

  const normSourceText = scrapedOk
    ? scrapedSource!.title
    : parsed.productQuery.trim();

  const priceFromManual = parsePricePaidRaw(
    options.pricePaid ?? (useManualForm && manual ? manual.pricePaid : null)
  );

  let referenceNormalized = scrapedOk
    ? scrapedSource!.normalized
    : buildNormalizedProduct(
        normSourceText,
        priceFromManual != null ? { price: priceFromManual } : undefined
      );

  referenceNormalized = withCriticalAttributes(
    `${referenceProductQuery} ${normSourceText}`.trim(),
    referenceNormalized
  );

  let referenceUnderstanding = buildReferenceUnderstanding({
    primaryTitle: referenceProductQuery,
    supplementaryText: normSourceText,
    sourceUrl:
      scrapedSource?.sourceUrl?.trim() ||
      parsed.inputUrl?.trim() ||
      null,
    scrapedHints: scrapedSource?.scrapedHints ?? null,
    normalized: referenceNormalized,
    scrapedListingOk: scrapedOk,
  });

  const metadataSourceUrl =
    scrapedSource?.sourceUrl?.trim() ||
    parsed.inputUrl?.trim() ||
    "";

  const [aiProductMetadata, aiCompareEnrichment] = await Promise.all([
    fetchAiProductMetadata({
      rawTitle: referenceProductQuery,
      url: metadataSourceUrl || referenceProductQuery,
      pageText:
        normSourceText !== referenceProductQuery ? normSourceText : null,
      skipAi: demoMode,
    }),
    fetchAiCompareEnrichment({
      primaryTitle: referenceProductQuery,
      supplementaryText: normSourceText,
      sourceUrl: metadataSourceUrl || null,
      skipAi: demoMode,
    }),
  ]);

  referenceUnderstanding = applyAiProductMetadataToUnderstanding(
    referenceUnderstanding,
    aiProductMetadata
  );

  if (aiCompareEnrichment.specTokens.length > 0) {
    referenceUnderstanding = mergeExtraKeySpecsIntoUnderstanding(
      referenceUnderstanding,
      aiCompareEnrichment.specTokens
    );
  }

  if (aiProductMetadata.usedAi) {
    pipelineLog("ai_product_metadata_applied", {
      hasBrand: Boolean(aiProductMetadata.brand),
      hasModel: Boolean(aiProductMetadata.model),
      searchQueries: aiProductMetadata.searchQueries?.length ?? 0,
      keySpecs: aiProductMetadata.keySpecs?.length ?? 0,
    });
  }

  if (aiCompareEnrichment.usedAi) {
    pipelineLog("ai_compare_enrichment_applied", {
      shoppingQueriesFromAi: aiCompareEnrichment.shoppingQueries.length,
      specTokens: aiCompareEnrichment.specTokens.length,
      exclusions: aiCompareEnrichment.excludePhrases.length,
    });
  }

  const aiMetadataSearchQueries =
    aiProductMetadataSearchQueries(aiProductMetadata);

  const normalizedQueryFallback =
    scrapedOk ? referenceProductQuery : normSourceText || referenceProductQuery;

  const normalizedQuery = buildNormalizedSearchQuery(
    referenceNormalized,
    normalizedQueryFallback
  );

  const searchQueryPack =
    explicitQueryPack ??
    (scrapedOk
      ? buildPdpRetailSearchQueryPack(
          referenceNormalized,
          scrapedSource!.title.trim()
        )
      : buildRetailSearchQueryPack(referenceNormalized, referenceProductQuery));

  const baseShoppingQueryPlan = buildUniversalShoppingQueryPlan({
    referenceNormalized,
    referenceTitle: referenceProductQuery,
    explicitQueryPack,
    resolvedRetailPack: searchQueryPack,
    pdpTitleSearchPlanOnly: Boolean(scrapedOk && !explicitQueryPack),
  });

  const shoppingQueryPlan = mergeShoppingQueryPlans(
    [...aiCompareEnrichment.shoppingQueries, ...aiMetadataSearchQueries],
    baseShoppingQueryPlan,
    10
  );

  if (COMPARE_VERBOSE) {
    console.log("[QUERY_PACK]", {
      primaryPreview: searchQueryPack.primaryQuery.slice(0, 100),
      simplifiedPreview: searchQueryPack.simplifiedQuery.slice(0, 80),
      specsPreview: searchQueryPack.specsQuery.slice(0, 80),
      shoppingPlanQueries: shoppingQueryPlan.length,
      aiPrependedCount:
        aiCompareEnrichment.shoppingQueries.length + aiMetadataSearchQueries.length,
    });
  }

  pipelineLog("derived_search_query", {
    productQuery: referenceProductQuery.slice(0, 200),
    normalizedQuery,
    detectedStore: parsed.detectedStore,
    sourceFromPdp: scrapedOk,
  });

  traceLog("normalized_reference_profile", {
    titleNorm: referenceNormalized.titleNorm,
    brand: referenceNormalized.brand,
    category: referenceNormalized.category,
  });

  let providerQueries = shoppingQueryPlan.map((q) => ({
    store: "google_shopping",
    query: q,
  }));
  traceLog("provider_query_used", {
    normalizedQueryPreview: normalizedQuery.slice(0, 160),
    shoppingPlanLen: shoppingQueryPlan.length,
    primaryQueryPreview: searchQueryPack.primaryQuery.slice(0, 100),
    providerQueriesLen: providerQueries.length,
  });

  let allCandidates: CandidateProduct[] = [];
  const candidatesPerProvider: { store: string; count: number }[] = [];
  let providerDiagnostics: ProviderSearchDiagnostics[] = [];

  const searchCtxBase = {
    rawInput: input,
    productQuery: referenceProductQuery,
    searchQuery: shoppingQueryPlan[0] ?? searchQueryPack.primaryQuery,
  };

  if (demoMode) {
    pipelineLog("demo_mode", { note: "synthetic_listings" });
    allCandidates = buildDemoCandidates(
      referenceNormalized,
      searchQueryPack.primaryQuery,
      DEMO_STORES
    );
    providerDiagnostics = [emptyGoogleDiagnostics(searchQueryPack.primaryQuery)];
    candidatesPerProvider.push({
      store: "google_shopping",
      count: allCandidates.length,
    });
  } else {
    const { candidates, diagnostics, queriesTried } =
      await fetchGoogleShoppingCandidatesWithDiagnostics(
        shoppingQueryPlan,
        searchCtxBase,
        { totalLimit: 88, perQueryLimit: 36 }
      );
    allCandidates = candidates;
    providerDiagnostics = diagnostics;
    providerQueries = queriesTried.map((q) => ({
      store: "google_shopping",
      query: q,
    }));
    for (const d of diagnostics) {
      pipelineLog("candidates_by_store", {
        store: "google_shopping",
        count: d.candidateCount,
        query: d.query,
        fetchOk: d.fetchOk,
      });
      traceLog("provider_search_diagnostics", {
        queryPreview: d.query.slice(0, 120),
        fetchOk: d.fetchOk,
        candidateCount: d.candidateCount,
        byteLength: d.byteLength,
        hints: d.hints.slice(0, 6),
      });
    }
    candidatesPerProvider.push({
      store: "google_shopping",
      count: allCandidates.length,
    });
  }

  pipelineLog("candidates_total", {
    total: allCandidates.length,
    byStore: candidatesPerProvider,
  });

  const inputUrl = parsed.inputUrl?.trim();
  const deduped = dedupeByStoreAndUrl(allCandidates);

  pipelineLog("dedupe_summary", {
    before: allCandidates.length,
    after: deduped.length,
    removed: allCandidates.length - deduped.length,
  });

  if (debug) {
    const missingPrice = allCandidates.filter((c) => !isValidComparablePrice(c.price));
    if (missingPrice.length > 0) {
      traceLog("candidates_missing_parseable_price", {
        count: missingPrice.length,
        sample: missingPrice.slice(0, 5).map((c) => ({
          store: c.store,
          title: c.title.slice(0, 80),
        })),
      });
    }
  }

  const candidateSteps: CandidateStepTrace[] = [];
  const queryForMatch = `${referenceProductQuery} ${normalizedQuery}`.trim();

  const referenceListPrice: number | null =
    priceFromManual != null && isValidComparablePrice(priceFromManual)
      ? priceFromManual
      : null;

  const referencePriceUrl =
    scrapedSource?.sourceUrl?.trim() || parsed.inputUrl?.trim() || null;
  if (referenceListPrice != null) {
    logReferencePriceOutcome({
      url: referencePriceUrl,
      price: referenceListPrice,
      source:
        priceFromManual != null && isValidComparablePrice(priceFromManual)
          ? useManualForm
            ? "manual_form"
            : "manual_reference_price"
          : referencePriceExtractionSource ?? "scraped_pdp",
    });
  } else if (referencePriceUrl || useManualForm) {
    logReferencePriceOutcome({
      url: referencePriceUrl,
      price: null,
      reason: scrapeBotWalled
        ? "bot_wall_or_unusable_pdp_title"
        : attemptedPdpExtract
          ? "pdp_price_not_found"
          : useManualForm
            ? "manual_price_missing_or_invalid"
            : "no_reference_price_source",
    });
  }

  type Row = {
    api: CompareApiCandidate;
    rel: AttributeMatchResult;
    identity: ProductIdentityResult;
  };

  const rows: Row[] = [];
  const rejectionSummary: {
    totalCandidates: number;
    afterDeduped: number;
    invalidStore: number;
    sameAsInput: number;
    noPrice: number;
    attributeRejected: Record<string, number>;
    urlRejected: number;
    acceptedRows: number;
    baseFilteredCount?: number;
    orderedForDisplayCount?: number;
  } = {
    totalCandidates: allCandidates.length,
    afterDeduped: deduped.length,
    invalidStore: 0,
    sameAsInput: 0,
    noPrice: 0,
    attributeRejected: {},
    urlRejected: 0,
    acceptedRows: 0,
  };

  const bumpAttributeReject = (reason: string) => {
    rejectionSummary.attributeRejected[reason] =
      (rejectionSummary.attributeRejected[reason] ?? 0) + 1;
  };

  for (const c of deduped) {
    const candidateListingKey = c.productUrl;

    traceLog("normalized_candidate", {
      store: c.store,
      titlePreview: c.title.slice(0, 120),
    });

    if (!isProductDetailStoreKey(c.store) && c.store !== "other") {
      candidateSteps.push({
        key: candidateKey(c, candidateSteps.length),
        store: c.store,
        title: c.title,
        price: c.price,
        productUrl: c.productUrl,
        outcome: "invalid_product_url",
        rejectionReason: "unsupported_store_for_compare",
        detail: "unsupported_store_for_compare",
      });
      pipelineLog("candidate_rejected", {
        store: c.store,
        title: c.title.slice(0, 80),
        reason: "unsupported_store_for_compare",
      });
      rejectionSummary.invalidStore += 1;
      continue;
    }

    if (inputUrl && areSameRetailerListings(inputUrl, c.productUrl)) {
      candidateSteps.push({
        key: candidateKey(c, candidateSteps.length),
        store: c.store,
        title: c.title,
        price: c.price,
        productUrl: c.productUrl,
        outcome: "skipped_same_source_item",
        detail: `same_listing_as_input_url(${candidateListingKey})`,
      });
      pipelineLog("candidate_skipped", {
        store: c.store,
        title: c.title.slice(0, 80),
        reason: "same_listing_as_pasted_url",
      });
      rejectionSummary.sameAsInput += 1;
      continue;
    }

    if (!isValidComparablePrice(c.price)) {
      candidateSteps.push({
        key: candidateKey(c, candidateSteps.length),
        store: c.store,
        title: c.title,
        price: c.price,
        productUrl: c.productUrl,
        outcome: "rejected_hard_gate",
        rejectionReason: "missing_price",
        detail: "missing_price",
      });
      pipelineLog("candidate_rejected", {
        store: c.store,
        title: c.title.slice(0, 80),
        reason: "missing_price",
      });
      rejectionSummary.noPrice += 1;
      continue;
    }

    if (
      aiCompareEnrichment.excludePhrases.length > 0 &&
      candidateViolatesLlmExclusions(c.title, aiCompareEnrichment.excludePhrases)
    ) {
      candidateSteps.push({
        key: candidateKey(c, candidateSteps.length),
        store: c.store,
        title: c.title,
        price: c.price,
        productUrl: c.productUrl,
        outcome: "rejected_hard_gate",
        rejectionReason: "llm_exclusion_phrase",
        detail: "llm_exclusion_phrase",
      });
      pipelineLog("candidate_rejected", {
        store: c.store,
        title: c.title.slice(0, 80),
        reason: "llm_exclusion_phrase",
      });
      bumpAttributeReject("llm_exclusion_phrase");
      continue;
    }

    // Structured gates favor similar cross-retailer substitutes (strict only on gross mismatches).
    const rel = scoreAttributeMatch(
      referenceNormalized,
      c.normalized,
      queryForMatch,
      c.title,
      { referenceUnderstanding }
    );

    if (rel.rejected) {
      candidateSteps.push({
        key: candidateKey(c, candidateSteps.length),
        store: c.store,
        title: c.title,
        price: c.price,
        productUrl: c.productUrl,
        outcome: "rejected_hard_gate",
        rejectionReason: rel.rejectionReason,
        matchScore: rel.relevanceScore,
        matchReasons: rel.reasons,
        detail: rel.rejectionReason ?? "hard_gate_or_min_relevance",
      });
      pipelineLog("candidate_rejected", {
        store: c.store,
        title: c.title.slice(0, 80),
        reason: rel.rejectionReason ?? "attribute_gate",
      });
      traceLog("candidate_attribute_rejected", {
        store: c.store,
        rejectionReason: rel.rejectionReason,
      });
      bumpAttributeReject(rel.rejectionReason ?? "attribute_rejected_unknown");
      continue;
    }

    const coupons = getSimulatedStoreCoupons(c.store, c.normalized.category);
    const resolution = resolveCompareCandidateOutbound({
      store: c.store,
      listingProductUrl: c.productUrl,
      title: c.title,
      sourceLabel: c.sourceLabel,
    });
    if (
      !resolution.outboundUrlRaw.trim() ||
      resolution.urlType === "unknown"
    ) {
      rejectionSummary.urlRejected += 1;
    }

    const identity = scoreProductIdentity(
      referenceNormalized,
      c.normalized,
      c.title,
      {
        sourceTitle: referenceProductQuery,
        sourceHints: scrapedSource?.scrapedHints ?? null,
      }
    );

    const api = toCompareApiCandidate(c, rel, identity, resolution, coupons);
    rows.push({ api, rel, identity });
    rejectionSummary.acceptedRows += 1;

    candidateSteps.push({
      key: candidateKey(c, candidateSteps.length),
      store: c.store,
      title: c.title,
      price: c.price,
      productUrl: c.productUrl,
      outcome: "evaluated",
      matchConfidence: undefined,
      matchScore: identity.identityScore,
      matchReasons: [...identity.identityReasons, ...rel.reasons],
      eligibleForComparable:
        identity.matchType === "exact_match" ||
        identity.matchType === "close_match",
      detail: `identity:${identity.matchType};attribute:${rel.matchType}`,
    });

    traceLog("candidate_attribute_match", {
      store: c.store,
      identityMatchType: identity.matchType,
      identityScore: identity.identityScore,
      attributeMatchType: rel.matchType,
      confidence: rel.confidence,
      score: rel.relevanceScore,
    });
  }

  const baseFiltered = rows
    .map((r) => r.api)
    .filter((api) => {
      if (api.urlType !== "product" && api.urlType !== "search") return false;
      if (!isProductDetailStoreKey(api.store) && api.store !== "other") return false;
      const outbound =
        api.outboundUrl?.trim() || api.affiliateUrl?.trim() || api.productUrl?.trim() || "";
      if (!outbound) return false;
      if (isBlockedUserFacingOutboundUrl(outbound)) return false;
      return isValidUserFacingCompareOutbound({
        store: api.store,
        url: outbound,
        urlType: api.urlType,
      });
    });

  const orderedAfterPriceAnnot = annotateAndOrderCandidates(
    baseFiltered,
    referenceListPrice
  );

  const referencePriceComparable =
    referenceListPrice != null && isValidComparablePrice(referenceListPrice);

  const cheaperPool = orderedAfterPriceAnnot.filter(
    (c) => c.priceCompareSegment === "cheaper"
  );
  const notCheaperPool = orderedAfterPriceAnnot.filter(
    (c) => c.priceCompareSegment === "not_cheaper"
  );

  let orderedForDisplay = cheaperPool.slice(0, DISPLAY_LIMIT);
  const similarButNotCheaper = notCheaperPool.slice(0, DISPLAY_LIMIT);

  if (!demoMode) {
    try {
      orderedForDisplay = await resolveDisplayedSearchPdps(
        orderedForDisplay,
        demoMode
      );
    } catch (err) {
      console.error("[PDP_RESOLVE_BATCH_FAIL]", {
        reason: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      });
    }
  }

  rejectionSummary.baseFilteredCount = baseFiltered.length;
  rejectionSummary.orderedForDisplayCount = orderedForDisplay.length;

  if (COMPARE_VERBOSE) {
    console.log("[REJECTION_SUMMARY]", {
      totalCandidates: rejectionSummary.totalCandidates,
      afterDeduped: rejectionSummary.afterDeduped,
      invalidStore: rejectionSummary.invalidStore,
      sameAsInput: rejectionSummary.sameAsInput,
      noPrice: rejectionSummary.noPrice,
      urlRejected: rejectionSummary.urlRejected,
      acceptedRows: rejectionSummary.acceptedRows,
      baseFilteredCount: rejectionSummary.baseFilteredCount,
      orderedForDisplayCount: rejectionSummary.orderedForDisplayCount,
      attributeRejectReasons: Object.keys(rejectionSummary.attributeRejected).length,
    });
  }

  const sourceProduct =
    scrapedOk && scrapedSource
      ? extractedSourceSummary(
          {
            ...scrapedSource,
            originalPrice: referenceListPrice ?? scrapedSource.originalPrice,
          },
          parsed.inputUrl
        )
      : useManualForm || !parsed.inputUrl
        ? queryDerivedSourceSummary(
            referenceProductQuery,
            parsed.detectedStore,
            referenceNormalized
          )
        : null;

  const selectionBase: SelectionTrace = {
    trustworthyCount: rows.filter(
      (r) =>
        (r.identity.matchType === "exact_match" ||
          r.identity.matchType === "close_match") &&
        !r.rel.rejected
    ).length,
    pickedStore: null,
    reasonNoDeal: null,
  };

  const tracePayload = (): ComparisonTrace | undefined =>
    debug
      ? {
          inputRaw: input,
          detectedStore: scrapedOk && scrapedSource ? scrapedSource.store : parsed.detectedStore,
          searchQueryUsed: normalizedQuery,
          demoMode,
          sourceSummary:
            scrapedOk && scrapedSource
              ? {
                  title: scrapedSource.title,
                  store: scrapedSource.store,
                  originalPrice: scrapedSource.originalPrice,
                  sourceUrl:
                    scrapedSource.sourceUrl ?? parsed.inputUrl ?? undefined,
                }
              : {
                  title: referenceProductQuery,
                  store: parsed.detectedStore ?? "unknown",
                  originalPrice: null,
                },
          providerQueries,
          candidatesPerProvider,
          providerDiagnostics,
          candidateSteps,
          selection: selectionBase,
        }
      : undefined;

  const shoppingApiMissing =
    !demoMode &&
    allCandidates.length === 0 &&
    providerDiagnostics.some((d) =>
      d.hints.includes("no_shopping_api_key_or_failed")
    );

  if (orderedForDisplay.length === 0) {
    const allFilteredByAttributes = deduped.length > 0 && rows.length === 0;
    const hadMatchesButNoneCheaper =
      baseFiltered.length > 0 && referencePriceComparable;
    pipelineLog("selection_final", {
      bestDeal: null,
      reason: allFilteredByAttributes
        ? "all_candidates_failed_attribute_gates"
        : hadMatchesButNoneCheaper
          ? "no_cheaper_than_reference"
          : deduped.length === 0
            ? "no_shopping_candidates"
            : "no_results_after_post_processing",
    });
    logCompareCandidateOutbound(similarButNotCheaper);
    return {
      query: referenceProductQuery,
      normalizedQuery,
      candidates: [],
      similarButNotCheaper,
      resultsByStore: [],
      bestDeal: null,
      showBestDeal: false,
      confidence: null,
      message: hadMatchesButNoneCheaper
        ? "No cheaper matching products found yet."
        : allFilteredByAttributes
          ? "No listings matched closely enough after attribute checks. Try adding more specific size, model, or accessory details."
          : shoppingApiMissing
            ? "Live shopping search is not configured. Add SERPER_API_KEY or SERPAPI_API_KEY on the server."
            : "No search results with prices yet. Try a different product description.",
      sourceProduct,
      alternatives: [],
      savings: null,
      comparisonMessage: hadMatchesButNoneCheaper
        ? "No cheaper matching products found yet."
        : allFilteredByAttributes
          ? "No close matches passed filters."
          : shoppingApiMissing
            ? "Shopping API credentials missing."
            : "No priced listings found for that search.",
      scrapeBotWalled,
      aiProductSummary: aiCompareEnrichment.summaryOneLine,
      ...(tracePayload() ? { comparisonTrace: tracePayload()! } : {}),
    };
  }

  const rowForApi = (api: CompareApiCandidate): Row | undefined =>
    rows.find(
      (r) => r.api.store === api.store && r.api.productUrl === api.productUrl
    );

  let bestDeal: CompareProductDeal | null = null;
  let alternatives: CompareProductDeal[] = [];
  let savings: number | null = null;
  let showBestDeal = false;
  let message: string | null = null;
  let comparisonMessage: string | null = null;

  if (orderedForDisplay.length > 0) {
    const refOk =
      referenceListPrice != null && isValidComparablePrice(referenceListPrice);
    let bestApi: CompareApiCandidate | undefined;
    if (refOk) {
      bestApi = orderedForDisplay.find(
        (c) =>
          c.priceCompareSegment === "cheaper" && c.matchType === "exact_match"
      );
    }
    if (!bestApi) {
      bestApi = orderedForDisplay.find((c) => c.matchType === "exact_match");
    }
    if (!bestApi) {
      bestApi = orderedForDisplay.find((c) => c.matchType === "close_match");
    }
    bestApi ??= orderedForDisplay[0];

    const bestRow = rowForApi(bestApi);
    if (bestRow) {
      bestDeal = toDeal(bestApi, bestRow.rel, bestRow.identity);
      showBestDeal = bestRow.identity.matchType === "exact_match";
      alternatives = orderedForDisplay
        .filter(
          (c) =>
            !(c.store === bestApi!.store && c.productUrl === bestApi!.productUrl)
        )
        .slice(0, Math.max(0, DISPLAY_LIMIT - 1))
        .map((c) => {
          const r = rowForApi(c);
          return r ? toDeal(c, r.rel, r.identity) : null;
        })
        .filter((d): d is CompareProductDeal => d != null);
    }

    const savingVals = orderedForDisplay
      .map((c) => c.savingsVsReference)
      .filter((x): x is number => x != null && x > 0);
    savings = savingVals.length > 0 ? Math.max(...savingVals) : null;

    if (
      bestDeal &&
      ((!isProductDetailStoreKey(bestDeal.store) && bestDeal.store !== "other") ||
        bestDeal.urlType === "unknown" ||
        !bestDeal.outboundUrl?.trim())
    ) {
      pipelineLog("selection_final", {
        bestDeal: null,
        reason: "invalid_outbound_url",
      });
      bestDeal = null;
      alternatives = [];
      showBestDeal = false;
      savings = null;
      comparisonMessage = "Closest matches found — verify retailer links before buying.";
      message = null;
      selectionBase.pickedStore = null;
      selectionBase.reasonNoDeal = "invalid_outbound_url";
    } else if (bestDeal) {
      selectionBase.pickedStore = bestDeal.store;
      pipelineLog("selection_final_best_deal", {
        store: bestDeal.store,
        price: bestDeal.price,
        displayedCount: orderedForDisplay.length,
      });
    } else {
      selectionBase.reasonNoDeal = "no_row_mapping";
      showBestDeal = false;
    }
  }

  if (!comparisonMessage) {
    if (cheaperPool.length > 0) {
      comparisonMessage =
        orderedForDisplay.length >= MIN_CHEAPER_RESULTS_TARGET
          ? `${orderedForDisplay.length} cheaper options than your reference price.`
          : `${orderedForDisplay.length} cheaper option(s) than your reference. Add size or model details if you expected more results.`;
    } else {
      comparisonMessage = "No cheaper matching products found yet.";
    }
  }

  const confidenceOut = overallConfidenceFromDeal(bestDeal);

  logCompareCandidateOutbound([
    ...orderedForDisplay,
    ...similarButNotCheaper,
  ]);

  return {
    query: referenceProductQuery,
    normalizedQuery,
    candidates: orderedForDisplay,
    similarButNotCheaper,
    resultsByStore: groupByStore(orderedForDisplay),
    bestDeal,
    showBestDeal,
    confidence: confidenceOut,
    message,
    sourceProduct,
    alternatives,
    savings,
    comparisonMessage,
    scrapeBotWalled,
    aiProductSummary: aiCompareEnrichment.summaryOneLine,
    ...(tracePayload() ? { comparisonTrace: tracePayload()! } : {}),
  };
}

export type { CompareProductOptions } from "./types";
export type {
  CompareProductResponse,
  ComparisonTrace,
  CandidateStepTrace,
  SelectionTrace,
  MatchConfidenceLabel,
  MatchTier,
} from "./types";

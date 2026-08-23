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
  buildDepartmentSearchQueryHints,
  getDepartmentConfig,
} from "./department";
import { validateDepartmentInputGate } from "./department/departmentInputGate";
import { validateDepartmentPreSearchGuard } from "./department/departmentInputGate";
import { resolveTvDisplayScoreCap } from "./department/tvMatchingPolicy";
import type { CompareFlowDepartment } from "./compareFlowDepartment";
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
import {
  buildMinimalTitleForCanonicalUrl,
  extractInitialProductFromCanonicalUrl,
} from "./productDescriptionFromUrl";
import {
  isGenericRetailProductQuery,
} from "./urlProductQuery";
import { isAsinPlaceholderTitle, isBlockedAsinSearchQuery, isUsablePdpTitle } from "./usablePdpTitle";
import {
  hasManualSearchableIdentity,
  isWeakSourceIdentityForCompare,
  WEAK_SOURCE_IDENTITY_MESSAGE,
} from "./sourceIdentityGuard";
import {
  attemptSourceProductRecovery,
  shouldAttemptSourceRecovery,
} from "./sourceProductRecovery";
import {
  BAND_HIGH_CONFIDENCE_MIN,
  BAND_POSSIBLE_MIN,
  applyIdentityMatchTypeToConfidenceBand,
  applyStrictSearchUrlCapToCandidate,
  applyStrictSearchUrlCapToDeal,
  applyStrictSearchUrlCapsToCandidates,
  buildUserMatchReasons,
  classifyConfidenceBand,
  confidenceBandBadgeLabel,
  dedupeCompareResponseMessages,
  isStrictSearchFallbackOutbound,
  partitionCandidatesIntoMatchGroups,
  searchUrlConfidenceBandLabel,
  displayMatchScore,
  FALLBACK_POSSIBLE_COUNT,
  isHardAttributeRejection,
  NO_EXACT_WITH_ALTERNATIVES_MESSAGE,
  POSSIBLE_ALTERNATIVES_EXPLANATION,
  refinePossibleBandBadge,
  type MatchResultGroups,
} from "./matching/confidenceBands";
import {
  identityMatchLabel,
  rankIdentityMatchTypes,
  scoreProductIdentity,
  type ProductIdentityResult,
} from "./matching/productIdentity";
import { cleanRetailerSearchQuery } from "./matching/searchQueryCleanup";
import { resolvePriceDifferenceClaim } from "./priceDifferenceClaim";
import {
  commercialListingDisplayLabel,
  hasCommercialNonPurchaseSignals,
  isDurableGoodsCategory,
  isIncompleteOrPartsListingTitle,
  isSuspiciousPurchasePriceRatio,
  shouldRejectCommercialListing,
} from "./commercialListingClassifier";
import { hostFromUrl } from "./source/storeDomains";
import { getSimulatedStoreCoupons } from "../premium/couponOffers";
import {
  isBlockedUserFacingOutboundUrl,
  isProductDetailStoreKey,
  isStrictProductDetailUrl,
  isValidUserFacingCompareOutbound,
} from "./productDetailUrl";
import { candidateHasMerchantPdpHint } from "./productUrlResolver";
import {
  logProductSourceCandidate,
  resolveOutboundUrl,
  type ResolvedOutboundUrl,
} from "./source";
import { isServerRetailScrapeBlocked } from "./source/serverScrapePolicy";
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
  pool: "Pool",
  outdoor_pool: "Pool",
  swimming_pool: "Pool",
  tools: "Tools",
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
  if (isBlockedAsinSearchQuery(t)) return false;
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
    if (isBlockedAsinSearchQuery(t)) return fallback;
    return t;
  };

  return {
    primaryQuery: ensure(primary),
    simplifiedQuery: ensure(simplified),
    specsQuery: ensure(specs),
  };
}

function formatGenderForQuery(gender: string | null): string | null {
  if (!gender) return null;
  const g = gender.toLowerCase();
  if (g === "men" || g === "mens" || g === "men's") return "men's";
  if (g === "women" || g === "womens" || g === "women's") return "women's";
  if (g === "kids" || g === "kid") return "kids'";
  if (g === "unisex") return "unisex";
  return gender;
}

function pickStructuredModelToken(norm: NormalizedProduct): string | null {
  const family = norm.structured.modelFamily?.trim();
  if (family && family.length >= 3 && family.length <= 24) {
    return family.replace(/\s+/g, " ");
  }
  const short = pickShortModelForPrimary(norm);
  if (short && short.length <= 16) return short;
  for (const t of norm.modelTokens) {
    if (t.length >= 4 && t.length <= 20) return t;
  }
  return null;
}

function pickDisplayTechPhrase(norm: NormalizedProduct): string | null {
  const tech = norm.tv?.displayTech ?? norm.structured.displayType;
  return tech ? tvDisplayTechLabel(tech) : null;
}

function pickResolutionPhrase(norm: NormalizedProduct): string | null {
  const res = norm.tv?.resolution ?? norm.structured.resolution;
  if (!res) return null;
  if (res === "4k") return "4K";
  if (res === "8k") return "8K";
  return "HD";
}

function pickKindPhrase(norm: NormalizedProduct): string | null {
  const phrases = norm.critical?.kindPhrases ?? [];
  if (phrases.length === 0) return null;
  return [...phrases].sort((a, b) => b.length - a.length)[0] ?? null;
}

function pickDimensionPhrases(norm: NormalizedProduct): string[] {
  const dims = norm.critical?.dimensionSignatures ?? [];
  const out: string[] = [];
  const sizeInches = norm.sizeInches ?? norm.structured.sizeInches;

  for (const d of dims) {
    const trimmed = d.replace(/\s+/g, " ").trim();
    if (trimmed.length < 2) continue;
    if (sizeInches != null && /^\d{2,3}$/.test(trimmed) && parseInt(trimmed, 10) === sizeInches) {
      continue;
    }
    if (
      sizeInches != null &&
      new RegExp(`^${sizeInches}\\s*inch`, "i").test(trimmed)
    ) {
      continue;
    }
    const normalized =
      trimmed.includes("x") || /\bx\b/i.test(trimmed)
        ? trimmed
        : /^\d{2,3}$/.test(trimmed)
          ? `${trimmed} inch`
          : trimmed;
    if (!out.some((x) => x.toLowerCase() === normalized.toLowerCase())) {
      out.push(normalized);
    }
    if (out.length >= 2) break;
  }
  return out;
}

function pickProductTypePhrase(norm: NormalizedProduct): string | null {
  const kind = pickKindPhrase(norm);
  if (kind && kind.length >= 3) return kind;
  const typeWord = categoryTypeWord(norm.category);
  if (typeWord !== "Product") return typeWord;
  return null;
}

const SMART_QUERY_NOISE_WORDS = new Set([
  "deep",
  "hard",
  "premium",
  "best",
  "newest",
  "ultimate",
  "luxury",
  "deluxe",
  "professional",
  "commercial",
  "advanced",
  "top",
  "rated",
]);

const SMART_QUERY_NOISE_PHRASES = [
  /\bheavy[\s-]+duty\b/gi,
  /\bhigh[\s-]+performance\b/gi,
  /\bpro[\s-]+grade\b/gi,
  /\bcommercial[\s-]+grade\b/gi,
];

function shouldLogSmartQueryDebug(): boolean {
  return COMPARE_VERBOSE || process.env.PRODUCT_SHOPPING_DEBUG === "1";
}

function cleanQueryToken(raw: string): string {
  let token = raw;
  for (const phraseRe of SMART_QUERY_NOISE_PHRASES) {
    token = token.replace(phraseRe, " ");
  }
  const words = token
    .replace(/[^\w\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const kept: string[] = [];
  for (const word of words) {
    const lower = word.toLowerCase();
    if (SMART_QUERY_NOISE_WORDS.has(lower)) continue;
    kept.push(word);
  }
  return kept.join(" ").replace(/\s+/g, " ").trim();
}

function addUniqueToken(parts: string[], seen: Set<string>, token: string | null | undefined): void {
  if (!token) return;
  const cleaned = cleanQueryToken(token).replace(/\s+/g, " ").trim();
  if (cleaned.length < 2) return;
  const key = cleaned.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  parts.push(cleaned);
}

function finalizeSearchQuery(parts: string[]): string {
  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  return cleanRetailerSearchQuery(joined);
}

function buildLegacyStructuredSearchQuery(norm: NormalizedProduct): string {
  const parts: string[] = [];
  const seen = new Set<string>();

  addUniqueToken(parts, seen, formatBrandTitleCase(norm.brand));
  addUniqueToken(parts, seen, pickStructuredModelToken(norm));
  for (const dim of pickDimensionPhrases(norm)) addUniqueToken(parts, seen, dim);

  const sizeInches = norm.sizeInches ?? norm.structured.sizeInches;
  if (sizeInches != null) addUniqueToken(parts, seen, `${sizeInches} inch`);
  else addUniqueToken(parts, seen, norm.structured.sizeLabel);

  addUniqueToken(parts, seen, pickDisplayTechPhrase(norm));
  addUniqueToken(parts, seen, pickResolutionPhrase(norm));
  addUniqueToken(parts, seen, norm.structured.color);
  addUniqueToken(parts, seen, formatGenderForQuery(norm.gender));

  if (norm.packCount != null && norm.packCount > 1) {
    addUniqueToken(parts, seen, `${norm.packCount} pack`);
  }

  addUniqueToken(parts, seen, pickProductTypePhrase(norm));

  return finalizeSearchQuery(parts);
}

function buildDepartmentStructuredSearchQuery(norm: NormalizedProduct): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  const category = norm.category;

  if (category === "pool" || category === "outdoor_pool" || category === "swimming_pool") {
    for (const dim of pickDimensionPhrases(norm)) addUniqueToken(parts, seen, dim);
    addUniqueToken(parts, seen, pickKindPhrase(norm));
    addUniqueToken(parts, seen, "pool");
    return finalizeSearchQuery(parts);
  }

  if (category === "tv") {
    const sizeInches = norm.sizeInches ?? norm.structured.sizeInches;
    if (sizeInches != null) addUniqueToken(parts, seen, `${sizeInches} inch`);
    addUniqueToken(parts, seen, pickDisplayTechPhrase(norm));
    addUniqueToken(parts, seen, "smart tv");
    return finalizeSearchQuery(parts);
  }

  if (category === "apparel" || category === "footwear" || category === "socks") {
    addUniqueToken(parts, seen, norm.structured.productType ?? pickProductTypePhrase(norm));
    addUniqueToken(parts, seen, norm.structured.sizeLabel);
    addUniqueToken(parts, seen, formatGenderForQuery(norm.gender ?? norm.structured.gender));
    return finalizeSearchQuery(parts);
  }

  if (category === "tools") {
    addUniqueToken(parts, seen, pickStructuredModelToken(norm));
    addUniqueToken(parts, seen, norm.structured.toolVoltage);
    addUniqueToken(parts, seen, norm.structured.productType ?? pickProductTypePhrase(norm));
    return finalizeSearchQuery(parts);
  }

  return "";
}

/**
 * Universal structured shopping query from normalized attributes — no category branches.
 */
export function buildStructuredSearchQuery(norm: NormalizedProduct): string {
  const legacyQuery = buildLegacyStructuredSearchQuery(norm);
  const departmentQuery = buildDepartmentStructuredSearchQuery(norm);
  const smartQuery = departmentQuery.length >= 4 ? departmentQuery : legacyQuery;
  const finalQuery = cleanRetailerSearchQuery(smartQuery);

  if (shouldLogSmartQueryDebug()) {
    const legacyTokens = legacyQuery
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const smartTokens = new Set(
      finalQuery
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean)
    );
    const removedTokens = [...new Set(legacyTokens.filter((t) => !smartTokens.has(t)))];
    if (removedTokens.length > 0) {
      console.log(
        "[QUERY_TOKENS_REMOVED]",
        JSON.stringify({
          category: norm.category,
          before: legacyQuery,
          after: finalQuery,
          removedTokens,
        })
      );
    }
    console.log(
      "[SMART_QUERY_BUILT]",
      JSON.stringify({
        category: norm.category,
        before: legacyQuery,
        after: finalQuery,
      })
    );
  }

  return finalQuery;
}

function prependStructuredQuery(queries: string[], norm: NormalizedProduct): string[] {
  const structured = buildStructuredSearchQuery(norm).replace(/\s+/g, " ").trim();
  if (structured.length < 8 || !isUsableRetailerQuery(structured)) {
    return queries;
  }
  return [structured, ...queries];
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
  /** User-selected department — prepends department-specific search hints. */
  selectedDepartment?: CompareFlowDepartment | null;
}): string[] {
  const {
    referenceNormalized,
    referenceTitle,
    explicitQueryPack,
    resolvedRetailPack,
    pdpTitleSearchPlanOnly,
    selectedDepartment,
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
  let hardStrict = cleanRetailerSearchQuery(`${segments} ${core}`);
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
    const orderedPdp = prependStructuredQuery(
      [pack.primaryQuery, pack.simplifiedQuery, pack.specsQuery],
      referenceNormalized
    );
    const seenPdp = new Set<string>();
    const outPdp: string[] = [];
    for (const q of orderedPdp) {
      const t = q.replace(/\s+/g, " ").trim();
      if (t.length < 4) continue;
      if (isBlockedAsinSearchQuery(t)) continue;
      if (seenPdp.has(t)) continue;
      seenPdp.add(t);
      outPdp.push(t);
    }
    return prependDepartmentSearchQueries(
      outPdp,
      selectedDepartment,
      referenceNormalized
    );
  }

  const ordered = prependStructuredQuery(
    [
      hardStrict,
      withBrand,
      pack.primaryQuery,
      pack.simplifiedQuery,
      pack.specsQuery,
    ],
    referenceNormalized
  );

  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of ordered) {
    const t = q.replace(/\s+/g, " ").trim();
    if (t.length < 4) continue;
    if (isBlockedAsinSearchQuery(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return prependDepartmentSearchQueries(out, selectedDepartment, referenceNormalized);
}

function prependDepartmentSearchQueries(
  queries: string[],
  selectedDepartment: CompareFlowDepartment | null | undefined,
  norm: NormalizedProduct
): string[] {
  if (!selectedDepartment) return queries;
  const hints = buildDepartmentSearchQueryHints(selectedDepartment, norm);
  if (hints.length === 0) return queries;
  const deptQuery = hints.join(" ").replace(/\s+/g, " ").trim();
  if (deptQuery.length < 4) return queries;
  const config = getDepartmentConfig(selectedDepartment);
  console.log(
    "[DEPARTMENT_SEARCH_STRATEGY]",
    JSON.stringify({
      department: selectedDepartment,
      searchStrategy: config.searchStrategy,
      departmentQuery: deptQuery.slice(0, 120),
    })
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of [deptQuery, ...queries]) {
    const t = q.replace(/\s+/g, " ").trim();
    const key = t.toLowerCase();
    if (t.length < 4 || seen.has(key)) continue;
    seen.add(key);
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

/** Best-deal highlight requires high-confidence band (75+ display score). */
const MIN_SCORE_PRODUCT_LISTING_OR_BEST_DEAL = BAND_HIGH_CONFIDENCE_MIN;
const MIN_SCORE_SIMILAR_PRODUCT = BAND_POSSIBLE_MIN;
const MIN_SCORE_ALTERNATIVE_OPTION = BAND_POSSIBLE_MIN;

export { buildRetailerSearchUrlFromTitle } from "./source/buildSearchUrl";

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

function sizeDistanceOkForComparable(
  reference: NormalizedProduct,
  candidate: NormalizedProduct
): boolean {
  const refSize = reference.sizeInches ?? reference.structured.sizeInches;
  const candSize = candidate.sizeInches ?? candidate.structured.sizeInches;
  if (refSize == null || candSize == null) return true;

  const strictScreen =
    reference.category === "tv" ||
    reference.category === "monitor" ||
    candidate.category === "tv" ||
    candidate.category === "monitor";
  if (strictScreen) return refSize === candSize;

  const maxSize = Math.max(refSize, candSize);
  const minSize = Math.min(refSize, candSize);
  if (maxSize === 0) return true;
  return maxSize / minSize <= 1.4;
}

function criticalDimensionsOverlap(
  reference: NormalizedProduct,
  candidate: NormalizedProduct
): boolean {
  const refDims = reference.critical?.dimensionSignatures ?? [];
  if (refDims.length === 0) return true;
  const candDims = new Set(candidate.critical?.dimensionSignatures ?? []);
  if (candDims.size === 0) return true;
  return refDims.some((d) => candDims.has(d));
}

function attributesComparableForCheaperOption(
  reference: NormalizedProduct,
  candidate: NormalizedProduct
): boolean {
  if (!sizeDistanceOkForComparable(reference, candidate)) return false;
  if (!criticalDimensionsOverlap(reference, candidate)) return false;
  return true;
}

function attributesComparableForDisplay(
  reference: NormalizedProduct,
  candidate: NormalizedProduct,
  displayScore: number
): boolean {
  if (displayScore >= BAND_HIGH_CONFIDENCE_MIN) {
    return attributesComparableForCheaperOption(reference, candidate);
  }
  if (!sizeDistanceOkForComparable(reference, candidate)) return false;
  return true;
}

function candidateDisplayScore(c: CompareApiCandidate): number {
  return (
    c.displayMatchScore ??
    displayMatchScore({
      relevanceScore: c.relevanceScore,
      identityScore: c.identityScore,
      departmentScore: c.departmentScore,
    })
  );
}

function isModerateBandScore(score: number): boolean {
  return score >= BAND_POSSIBLE_MIN && score < BAND_HIGH_CONFIDENCE_MIN;
}

function mergePriceAnnotations(
  apis: CompareApiCandidate[],
  annotated: CompareApiCandidate[]
): CompareApiCandidate[] {
  const key = (c: CompareApiCandidate) => `${c.store}\0${c.productUrl}`;
  const byKey = new Map(annotated.map((c) => [key(c), c]));
  return apis.map((api) => byKey.get(key(api)) ?? api);
}

/** Display-only pool for 55–74 scores; does not change scoring. */
function collectModerateBandForDisplay(
  pool: CompareApiCandidate[],
  reference: NormalizedProduct,
  options?: { relaxAttributeGate?: boolean; limit?: number }
): CompareApiCandidate[] {
  const limit = options?.limit ?? FALLBACK_POSSIBLE_COUNT;
  const relax = options?.relaxAttributeGate === true;
  return pool
    .filter((c) => {
      const score = candidateDisplayScore(c);
      if (!isModerateBandScore(score)) return false;
      if (
        !relax &&
        !attributesComparableForDisplay(reference, c.normalized, score)
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => candidateDisplayScore(b) - candidateDisplayScore(a))
    .slice(0, limit);
}

function queryDerivedSourceSummary(
  productQuery: string,
  detectedStore: StoreId | null,
  norm: import("./types").NormalizedProduct,
  sourceUrl?: string
): NonNullable<CompareProductResponse["sourceProduct"]> {
  const url = sourceUrl?.trim();
  return {
    ...(url ? { sourceUrl: url } : {}),
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
  if (rel.matchExplanation?.trim()) {
    return rel.matchExplanation.trim();
  }
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

function commercialListingHost(c: CandidateProduct | CompareApiCandidate): string {
  if ("shoppingHintUrl" in c && c.shoppingHintUrl?.trim()) {
    return hostFromUrl(c.shoppingHintUrl) ?? "";
  }
  const productUrl = c.productUrl?.trim();
  if (productUrl?.startsWith("http")) {
    return hostFromUrl(productUrl) ?? "";
  }
  if ("outboundUrl" in c && c.outboundUrl?.trim()) {
    return hostFromUrl(c.outboundUrl) ?? "";
  }
  return "";
}

function logCommercialListingRejected(c: CandidateProduct): void {
  console.log(
    "[COMMERCIAL_LISTING_REJECTED]",
    JSON.stringify({
      host: commercialListingHost(c),
      title: c.title.slice(0, 120),
      rawPrice: c.rawPriceText ?? c.price,
      listingType: c.commercialListing?.listingType ?? "unknown",
      priceIntent: c.commercialListing?.priceIntent ?? "unknown",
      signals: c.commercialListing?.signals ?? [],
    }),
  );
}

function isPurchasePriceListing(
  c: Pick<CandidateProduct | CompareApiCandidate, "commercialListing">,
): boolean {
  if (!c.commercialListing) return true;
  return !shouldRejectCommercialListing(c.commercialListing);
}

function isBlockedFromExactMatchOrBestDeal(
  c: CompareApiCandidate,
  referencePrice: number | null,
): boolean {
  if (!isPurchasePriceListing(c)) return true;
  if (isIncompleteOrPartsListingTitle(c.title)) return true;
  if (
    referencePrice != null &&
    isValidComparablePrice(referencePrice) &&
    isValidComparablePrice(c.price) &&
    isDurableGoodsCategory(c.normalized.category) &&
    isSuspiciousPurchasePriceRatio(c.price as number, referencePrice)
  ) {
    return true;
  }
  return false;
}

function applyCommercialPriceSafetyToCandidate(
  candidate: CompareApiCandidate,
  referencePrice: number | null,
): CompareApiCandidate {
  if (isIncompleteOrPartsListingTitle(candidate.title)) {
    let band = candidate.confidenceBand ?? "possible_alternative";
    if (band === "exact_match" || band === "high_confidence") {
      band = "possible_alternative";
    }
    return {
      ...candidate,
      confidenceBand: band,
      displayMatchScore: Math.min(
        candidate.displayMatchScore ?? 0,
        BAND_HIGH_CONFIDENCE_MIN - 1,
      ),
      confidenceBandLabel: confidenceBandBadgeLabel(band),
      savingsVsReference: null,
      priceDifferenceKind: null,
      priceDifferenceLabel: null,
      commercialListingLabel:
        candidate.commercialListingLabel ?? "Incomplete / parts listing",
      matchType:
        candidate.matchType === "exact_match" ? "close_match" : candidate.matchType,
    };
  }

  if (
    candidate.commercialListing &&
    shouldRejectCommercialListing(candidate.commercialListing)
  ) {
    return {
      ...candidate,
      confidenceBand: "below_threshold",
      displayMatchScore: Math.min(candidate.displayMatchScore ?? 0, BAND_POSSIBLE_MIN - 1),
      confidenceBandLabel: "Low Match",
      savingsVsReference: null,
      priceDifferenceKind: null,
      priceDifferenceLabel: null,
      commercialListingLabel:
        commercialListingDisplayLabel(candidate.commercialListing) ??
        candidate.commercialListingLabel ??
        null,
    };
  }

  if (
    referencePrice == null ||
    !isValidComparablePrice(referencePrice) ||
    !isValidComparablePrice(candidate.price) ||
    !isDurableGoodsCategory(candidate.normalized.category)
  ) {
    return candidate;
  }

  if (
    !isSuspiciousPurchasePriceRatio(candidate.price as number, referencePrice)
  ) {
    return candidate;
  }

  if (
    candidate.commercialListing &&
    hasCommercialNonPurchaseSignals(candidate.commercialListing)
  ) {
    return {
      ...candidate,
      confidenceBand: "below_threshold",
      displayMatchScore: Math.min(candidate.displayMatchScore ?? 0, BAND_POSSIBLE_MIN - 1),
      confidenceBandLabel: "Low Match",
      savingsVsReference: null,
      priceDifferenceKind: null,
      priceDifferenceLabel: null,
      commercialListingLabel:
        commercialListingDisplayLabel(candidate.commercialListing) ??
        candidate.commercialListingLabel ??
        null,
    };
  }

  console.log(
    "[PRICE_RATIO_SUSPICIOUS]",
    JSON.stringify({
      store: candidate.store,
      host: commercialListingHost(candidate),
      title: candidate.title.slice(0, 120),
      candidatePrice: candidate.price,
      referencePrice,
      ratio: (candidate.price as number) / referencePrice,
      listingType: candidate.commercialListing?.listingType ?? "unknown",
      priceIntent: candidate.commercialListing?.priceIntent ?? "unknown",
    }),
  );

  let band = candidate.confidenceBand ?? "possible_alternative";
  if (band === "exact_match" || band === "high_confidence") {
    band = "possible_alternative";
  }
  const cappedScore = Math.min(
    candidate.displayMatchScore ?? BAND_HIGH_CONFIDENCE_MIN - 1,
    BAND_HIGH_CONFIDENCE_MIN - 1,
  );

  return {
    ...candidate,
    displayMatchScore: cappedScore,
    confidenceBand: band,
    confidenceBandLabel: confidenceBandBadgeLabel(band),
    savingsVsReference: null,
    priceDifferenceKind: null,
    priceDifferenceLabel: null,
    commercialListingLabel:
      candidate.commercialListingLabel ?? "Verify purchase price",
  };
}

function annotateCandidateConfidence(
  c: CompareApiCandidate,
  rel: AttributeMatchResult,
  identity: ProductIdentityResult,
  departmentTier?: string | null,
  selectedDepartment?: CompareFlowDepartment | null,
  sourceNorm?: NormalizedProduct,
  sourceTitle?: string
): CompareApiCandidate {
  const tvScoreCap =
    sourceNorm != null
      ? resolveTvDisplayScoreCap({
          sourceNorm,
          candidateNorm: c.normalized,
          sourceTitle: sourceTitle ?? sourceNorm.structured.title,
          candidateTitle: c.title,
          identity,
          departmentScore: rel.departmentScore,
        })
      : null;

  const score = displayMatchScore({
    relevanceScore: c.relevanceScore,
    identityScore: c.identityScore,
    departmentScore: rel.departmentScore,
    tvScoreCap,
  });
  let confidenceBand = classifyConfidenceBand(score);
  confidenceBand = refinePossibleBandBadge(confidenceBand, {
    departmentTier,
    scoreReasons: rel.reasons,
    identityReasons: identity.identityReasons,
  });

  confidenceBand = applyIdentityMatchTypeToConfidenceBand(
    confidenceBand,
    identity
  );

  let annotated: CompareApiCandidate = {
    ...c,
    displayMatchScore: score,
    confidence: rel.confidence,
    confidenceBand,
    confidenceBandLabel: confidenceBandBadgeLabel(confidenceBand),
    score: c.identityScore,
  };

  const beforeCap = isStrictSearchFallbackOutbound(annotated)
    ? candidateDisplayScore(annotated)
    : null;
  annotated = applyStrictSearchUrlCapToCandidate(annotated);

  if (
    beforeCap != null &&
    isStrictSearchFallbackOutbound(annotated) &&
    (annotated.displayMatchScore ?? 0) < beforeCap
  ) {
    console.log("[SEARCH_URL_CONFIDENCE_CAP]", {
      store: annotated.store,
      title: annotated.title.slice(0, 120),
      scoreBefore: beforeCap,
      scoreAfter: annotated.displayMatchScore,
      relevanceScore: annotated.relevanceScore,
      identityScore: annotated.identityScore,
      confidenceBand: annotated.confidenceBand,
    });
  }

  const searchLabel = isStrictSearchFallbackOutbound(annotated)
    ? searchUrlConfidenceBandLabel()
    : null;
  const matchReasons = buildUserMatchReasons({
    rel,
    identity,
    displayScore: annotated.displayMatchScore ?? score,
    confidenceBand: annotated.confidenceBand ?? confidenceBand,
    selectedDepartment,
  });
  const primaryReason = matchReasons[0] ?? c.matchExplanation ?? c.relevanceReason;
  return {
    ...annotated,
    confidenceBandLabel:
      searchLabel ?? confidenceBandBadgeLabel(annotated.confidenceBand ?? confidenceBand),
    matchReasons,
    matchExplanation: primaryReason,
    relevanceReason: primaryReason,
  };
}

function toCompareApiCandidate(
  c: CandidateProduct,
  rel: AttributeMatchResult,
  identity: ProductIdentityResult,
  resolution: ResolvedOutboundUrl,
  premiumCoupons?: PremiumCouponOffer[],
  departmentTier?: string | null,
  selectedDepartment?: CompareFlowDepartment | null,
  sourceNorm?: NormalizedProduct,
  sourceTitle?: string,
  referencePrice?: number | null,
): CompareApiCandidate {
  const outboundRaw = resolution.outboundUrlRaw.trim();
  const affiliateUrl =
    outboundRaw.length > 0 ? toAffiliateUrl(outboundRaw, c.store) : "";
  const storeLabel = c.sourceLabel?.trim() || undefined;
  const navigableProductUrl =
    resolution.resolvedProductUrl?.trim() ||
    (resolution.urlType === "product" ? outboundRaw : "") ||
    c.shoppingHintUrl?.trim() ||
    c.productUrl;

  const base: CompareApiCandidate = {
    store: c.store,
    storeLabel,
    title: c.title,
    price: c.price,
    currency: c.currency,
    productUrl: navigableProductUrl,
    affiliateUrl,
    imageUrl: c.imageUrl,
    rating: c.rating ?? null,
    normalized: c.normalized,
    confidence: rel.confidence,
    matchConfidenceLabel: rel.matchConfidenceLabel,
    matchType: identity.matchType,
    attributeMatchType: rel.matchType,
    identityScore: identity.identityScore,
    identityReasons: identity.identityReasons,
    missingCriticalAttributes: identity.missingCriticalAttributes,
    relevanceScore: rel.relevanceScore,
    departmentScore: rel.departmentScore ?? null,
    score: identity.identityScore,
    relevanceReason: relevanceReasonLine(rel, identity),
    matchExplanation: rel.matchExplanation ?? relevanceReasonLine(rel, identity),
    displayMatchScore: 0,
    confidenceBand: "below_threshold",
    confidenceBandLabel: "Low Match",
    matchReasons: [],
    premiumCoupons,
    outboundIsStoreSearch: resolution.urlType === "search",
    resolvedProductUrl: resolution.resolvedProductUrl,
    outboundUrl: affiliateUrl || outboundRaw,
    urlType: resolution.urlType,
    urlConfidence: resolution.urlConfidence,
    urlResolutionReason: resolution.urlResolutionReason,
    rawPriceText: c.rawPriceText ?? null,
    commercialListing: c.commercialListing,
    commercialListingLabel: c.commercialListing
      ? commercialListingDisplayLabel(c.commercialListing)
      : null,
  };
  const annotated = annotateCandidateConfidence(
    base,
    rel,
    identity,
    departmentTier,
    selectedDepartment,
    sourceNorm,
    sourceTitle
  );
  return applyCommercialPriceSafetyToCandidate(annotated, referencePrice ?? null);
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
    departmentScore: row.departmentScore,
    displayMatchScore: row.displayMatchScore,
    confidenceBand: row.confidenceBand,
    confidenceBandLabel: row.confidenceBandLabel,
    matchReasons: row.matchReasons,
    score: row.displayMatchScore ?? identity.identityScore,
    relevanceReason: row.relevanceReason,
    matchExplanation: row.matchExplanation,
    premiumCoupons: row.premiumCoupons,
    savingsVsReference: row.savingsVsReference,
    priceDifferenceKind: row.priceDifferenceKind,
    priceDifferenceLabel: row.priceDifferenceLabel,
    priceCompareSegment: row.priceCompareSegment,
    outboundIsStoreSearch: row.outboundIsStoreSearch,
    resolvedProductUrl: row.resolvedProductUrl,
    outboundUrl: row.outboundUrl,
    urlType: row.urlType,
    urlConfidence: row.urlConfidence,
    urlResolutionReason: row.urlResolutionReason,
    rawPriceText: row.rawPriceText,
    commercialListing: row.commercialListing,
    commercialListingLabel: row.commercialListingLabel,
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
        priceDifferenceKind: null,
        priceDifferenceLabel: null,
      };
    }
    const p = api.price;
    if (!isValidComparablePrice(p)) {
      return {
        ...api,
        priceCompareSegment: "unknown" as const,
        savingsVsReference: null,
        priceDifferenceKind: null,
        priceDifferenceLabel: null,
      };
    }
    const price = p as number;
    const cheaper = price < referencePrice!;
    const eligiblePriceDelta =
      cheaper &&
      !isIncompleteOrPartsListingTitle(api.title) &&
      isPurchasePriceListing(api) &&
      !(
        isDurableGoodsCategory(api.normalized.category) &&
        isSuspiciousPurchasePriceRatio(price, referencePrice!)
      );
    const delta = eligiblePriceDelta ? referencePrice! - price : null;
    const claim = resolvePriceDifferenceClaim({
      amount: delta,
      confidenceBand: api.confidenceBand,
      matchType: api.matchType,
      title: api.title,
      commercialListingLabel: api.commercialListingLabel,
      store: api.store,
      outboundUrl: api.outboundUrl,
      affiliateUrl: api.affiliateUrl,
      productUrl: api.productUrl,
      urlType: api.urlType,
      outboundIsStoreSearch: api.outboundIsStoreSearch,
    });
    return {
      ...api,
      priceCompareSegment: cheaper ? ("cheaper" as const) : ("not_cheaper" as const),
      // Keep numeric delta for alternatives; label honesty is via priceDifferenceKind.
      savingsVsReference: claim?.amount ?? null,
      priceDifferenceKind: claim?.kind ?? null,
      priceDifferenceLabel: claim?.label ?? null,
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

  const shoppingAssistantMode = Boolean(options.shoppingAssistant);

  const rawPricePaid =
    options.pricePaid?.trim() ||
    (useManualForm && manual ? manual.pricePaid?.trim() : null) ||
    "";
  if (!shoppingAssistantMode && !isValidReferencePriceInput(rawPricePaid)) {
    throw new Error(REFERENCE_PRICE_REQUIRED_MESSAGE);
  }

  const debug = Boolean(options.debug) && COMPARE_VERBOSE;
  const demoMode = DEMO_MODE;

  const traceLog = (...args: unknown[]) => {
    if (!debug) return;
    const [first, ...rest] = args;
    console.log("[compare-product:debug]", first, ...rest);
  };

  const selectedDepartment = options.department ?? null;

  if (!shoppingAssistantMode && !selectedDepartment) {
    throw new Error("Choose a department before comparing products.");
  }

  pipelineLog("input_received", {
    inputPreview: input.slice(0, 200),
    demoMode,
    manualForm: useManualForm,
    department: selectedDepartment,
  });

  const parsed = await parseProductInput(input);
  const canonicalProductUrl = (
    parsed.canonicalProductUrl ?? parsed.inputUrl
  )?.trim();

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

  const priceFromInput = parsePricePaidRaw(
    options.pricePaid ?? (useManualForm && manual ? manual.pricePaid : null)
  );

  let scrapedSource: SourceProduct | null = null;
  let attemptedPdpExtract = false;
  let referencePriceExtractionSource: string | null = null;

  if (canonicalProductUrl && !demoMode) {
    if (isServerRetailScrapeBlocked(canonicalProductUrl)) {
      pipelineLog("server_generic_scrape_skipped_bot_protected_retailer", {
        inputUrl: canonicalProductUrl.slice(0, 200),
        fallbackQuery: parsed.productQuery.slice(0, 120),
      });
    }

    const extracted = await extractInitialProductFromCanonicalUrl({
      canonicalProductUrl,
      originalInputUrl: parsed.originalInputUrl ?? parsed.rawInput,
      slugFallbackQuery: parsed.productQuery,
      userPrice: priceFromInput,
      demoMode,
    });

    if (extracted) {
      scrapedSource = extracted.sourceProduct;
      attemptedPdpExtract = extracted.attemptedExtract;
      referencePriceExtractionSource = extracted.priceSource;
      if (extracted.fallbackReason) {
        pipelineLog("description_fallback", {
          reason: extracted.fallbackReason,
          titlePreview: scrapedSource.title.slice(0, 120),
        });
      }
    }
  }

  if (scrapedSource && canonicalProductUrl) {
    scrapedSource = {
      ...scrapedSource,
      sourceUrl: canonicalProductUrl,
    };
  }

  let scrapedOk = Boolean(
    scrapedSource && isUsablePdpTitle(scrapedSource.title)
  );
  const scrapeBotWalled = attemptedPdpExtract && !scrapedOk;

  let referenceProductQuery =
    scrapedSource?.title?.replace(/\s+/g, " ").trim() ||
    explicitReferenceQuery?.replace(/\s+/g, " ").trim() ||
    parsed.productQuery.replace(/\s+/g, " ").trim();

  if (!referenceProductQuery && canonicalProductUrl) {
    const minimalTitle = buildMinimalTitleForCanonicalUrl(canonicalProductUrl);
    if (
      minimalTitle &&
      !isAsinPlaceholderTitle(minimalTitle) &&
      isUsablePdpTitle(minimalTitle) &&
      !isGenericRetailProductQuery(minimalTitle) &&
      !/^product from [a-z0-9.-]+$/i.test(minimalTitle)
    ) {
      referenceProductQuery = minimalTitle;
      if (!scrapedSource) {
        const store =
          detectStoreFromProductUrl(canonicalProductUrl) ?? "unknown";
        scrapedSource = {
          sourceUrl: canonicalProductUrl,
          store,
          title: referenceProductQuery,
          originalPrice: priceFromInput,
          currency: "USD",
          imageUrl: null,
          normalized: buildNormalizedProduct(referenceProductQuery, {
            price: priceFromInput ?? undefined,
            productUrl: canonicalProductUrl,
          }),
          scrapedHints: null,
        };
      }
    }
  }

  if (!referenceProductQuery && !canonicalProductUrl) {
    pipelineLog("derive_query_empty", {
      inputUrl: null,
      hasTextInput: Boolean(parsed.rawInput && !/^https?:\/\//i.test(parsed.rawInput)),
    });
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

  let normSourceText = scrapedOk
    ? scrapedSource!.title
    : parsed.productQuery.trim();

  const priceFromManual = priceFromInput;

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

  const departmentInputGate = selectedDepartment
    ? validateDepartmentInputGate(
        selectedDepartment,
        referenceNormalized,
        referenceProductQuery
      )
    : { ok: true as const, detectedDepartment: null };
  if (!departmentInputGate.ok) {
    pipelineLog("department_input_mismatch", {
      selectedDepartment: departmentInputGate.selectedDepartment,
      detectedDepartment: departmentInputGate.detectedDepartment,
      action: "blocked_before_search",
    });
    const gateMessage = departmentInputGate.message;
    const blockedSourceProduct =
      scrapedOk && scrapedSource
        ? extractedSourceSummary(
            scrapedSource,
            canonicalProductUrl ?? undefined
          )
        : queryDerivedSourceSummary(
            referenceProductQuery,
            parsed.detectedStore,
            referenceNormalized,
            canonicalProductUrl ?? undefined
          );
    return {
      query: referenceProductQuery,
      normalizedQuery: "",
      candidates: [],
      resultsByStore: [],
      bestDeal: null,
      showBestDeal: false,
      confidence: null,
      message: gateMessage,
      sourceProduct: blockedSourceProduct,
      alternatives: [],
      savings: null,
      comparisonMessage: gateMessage,
      scrapeBotWalled,
      aiProductSummary: null,
      selectedDepartment,
    };
  }

  let referenceUnderstanding = buildReferenceUnderstanding({
    primaryTitle: referenceProductQuery,
    supplementaryText: normSourceText,
    sourceUrl:
      scrapedSource?.sourceUrl?.trim() ||
      canonicalProductUrl ||
      null,
    scrapedHints: scrapedSource?.scrapedHints ?? null,
    normalized: referenceNormalized,
    scrapedListingOk: scrapedOk,
  });

  const metadataSourceUrl =
    scrapedSource?.sourceUrl?.trim() ||
    canonicalProductUrl ||
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

  const departmentInputGateWithAiDescription = selectedDepartment
    ? validateDepartmentInputGate(
        selectedDepartment,
        referenceNormalized,
        referenceProductQuery,
        aiCompareEnrichment.summaryOneLine
      )
    : { ok: true as const, detectedDepartment: null };
  if (!departmentInputGateWithAiDescription.ok) {
    pipelineLog("department_input_mismatch", {
      selectedDepartment: departmentInputGateWithAiDescription.selectedDepartment,
      detectedDepartment: departmentInputGateWithAiDescription.detectedDepartment,
      action: "blocked_before_search",
    });
    const gateMessage = departmentInputGateWithAiDescription.message;
    const blockedSourceProduct =
      scrapedOk && scrapedSource
        ? extractedSourceSummary(
            scrapedSource,
            canonicalProductUrl ?? undefined
          )
        : queryDerivedSourceSummary(
            referenceProductQuery,
            parsed.detectedStore,
            referenceNormalized,
            canonicalProductUrl ?? undefined
          );
    return {
      query: referenceProductQuery,
      normalizedQuery: "",
      candidates: [],
      resultsByStore: [],
      bestDeal: null,
      showBestDeal: false,
      confidence: null,
      message: gateMessage,
      sourceProduct: blockedSourceProduct,
      alternatives: [],
      savings: null,
      comparisonMessage: gateMessage,
      scrapeBotWalled,
      aiProductSummary: aiCompareEnrichment.summaryOneLine,
      selectedDepartment,
    };
  }

  const departmentPreSearchGuard = selectedDepartment
    ? validateDepartmentPreSearchGuard(
        selectedDepartment,
        referenceNormalized,
        referenceProductQuery,
        aiCompareEnrichment.summaryOneLine
      )
    : { ok: true as const, detectedDepartment: null };
  if (!departmentPreSearchGuard.ok) {
    pipelineLog("department_pre_search_guard_blocked", {
      selectedDepartment: departmentPreSearchGuard.selectedDepartment,
      detectedDepartment: departmentPreSearchGuard.detectedDepartment,
      action: "blocked_before_search",
    });
    const gateMessage = departmentPreSearchGuard.message;
    const blockedSourceProduct =
      scrapedOk && scrapedSource
        ? extractedSourceSummary(
            scrapedSource,
            canonicalProductUrl ?? undefined
          )
        : queryDerivedSourceSummary(
            referenceProductQuery,
            parsed.detectedStore,
            referenceNormalized,
            canonicalProductUrl ?? undefined
          );
    return {
      query: referenceProductQuery,
      normalizedQuery: "",
      candidates: [],
      resultsByStore: [],
      bestDeal: null,
      showBestDeal: false,
      confidence: null,
      message: gateMessage,
      sourceProduct: blockedSourceProduct,
      alternatives: [],
      savings: null,
      comparisonMessage: gateMessage,
      scrapeBotWalled,
      aiProductSummary: aiCompareEnrichment.summaryOneLine,
      selectedDepartment,
    };
  }

  const manualSearchableIdentity = hasManualSearchableIdentity(
    useManualForm,
    manual
  );

  if (
    shouldAttemptSourceRecovery({
      manualSearchableIdentity,
      demoMode,
      canonicalProductUrl,
      scrapedOk,
      referenceProductQuery,
      referenceNormalized,
      supplementalDescription: aiCompareEnrichment.summaryOneLine,
    })
  ) {
    const recovered = await attemptSourceProductRecovery({
      canonicalProductUrl: canonicalProductUrl!,
      slugFallbackQuery: parsed.productQuery,
      userPrice: priceFromInput,
      partialSource: scrapedSource,
      supplementalDescription: aiCompareEnrichment.summaryOneLine,
    });
    if (recovered) {
      scrapedSource = recovered.sourceProduct;
      referenceProductQuery = recovered.title;
      referenceNormalized = withCriticalAttributes(
        recovered.title,
        recovered.sourceProduct.normalized
      );
      normSourceText = recovered.title;
      scrapedOk = isUsablePdpTitle(recovered.title);
      pipelineLog("source_identity_recovered", {
        winningPath: recovered.winningPath,
        pathsAgreed: recovered.pathsAgreed,
        titlePreview: recovered.title.slice(0, 120),
      });
    }
  }

  if (
    !manualSearchableIdentity &&
    isWeakSourceIdentityForCompare(
      referenceProductQuery,
      referenceNormalized,
      { supplementalDescription: aiCompareEnrichment.summaryOneLine }
    )
  ) {
    pipelineLog("source_identity_guard_blocked", {
      referenceTitlePreview: referenceProductQuery.slice(0, 120),
      category: referenceNormalized.category,
      brand: referenceNormalized.brand,
      scrapeBotWalled,
    });
    const blockedSourceProduct =
      canonicalProductUrl
        ? queryDerivedSourceSummary(
            referenceProductQuery,
            parsed.detectedStore ??
              detectStoreFromProductUrl(canonicalProductUrl),
            referenceNormalized,
            canonicalProductUrl
          )
        : scrapedOk && scrapedSource
          ? extractedSourceSummary(
              scrapedSource,
              canonicalProductUrl ?? undefined
            )
          : queryDerivedSourceSummary(
              referenceProductQuery,
              parsed.detectedStore,
              referenceNormalized,
              canonicalProductUrl ?? undefined
            );
    return {
      query: referenceProductQuery,
      normalizedQuery: "",
      candidates: [],
      resultsByStore: [],
      bestDeal: null,
      showBestDeal: false,
      confidence: null,
      message: WEAK_SOURCE_IDENTITY_MESSAGE,
      sourceProduct: blockedSourceProduct,
      alternatives: [],
      savings: null,
      comparisonMessage: WEAK_SOURCE_IDENTITY_MESSAGE,
      scrapeBotWalled,
      aiProductSummary: aiCompareEnrichment.summaryOneLine,
      selectedDepartment,
    };
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
    selectedDepartment,
  });

  const structuredSearchQuery = buildStructuredSearchQuery(referenceNormalized);

  console.log(
    "[CATEGORY_QUERY_PROFILE]",
    JSON.stringify({
      category: referenceNormalized.category,
      brand: referenceNormalized.brand,
      sizeInches: referenceNormalized.sizeInches ?? referenceNormalized.structured.sizeInches,
      sizeLabel: referenceNormalized.structured.sizeLabel,
      displayTech: referenceNormalized.tv?.displayTech ?? referenceNormalized.structured.displayType,
      resolution: referenceNormalized.tv?.resolution ?? referenceNormalized.structured.resolution,
      modelFamily: referenceNormalized.structured.modelFamily,
      color: referenceNormalized.structured.color,
      gender: referenceNormalized.gender,
      criticalDimensions: referenceNormalized.critical?.dimensionSignatures ?? [],
      kindPhrases: referenceNormalized.critical?.kindPhrases ?? [],
    })
  );

  const shoppingQueryPlan = mergeShoppingQueryPlans(
    [...aiCompareEnrichment.shoppingQueries, ...aiMetadataSearchQueries],
    baseShoppingQueryPlan,
    10
  );

  console.log(
    "[SEARCH_QUERY_BUILT]",
    JSON.stringify({
      category: referenceNormalized.category,
      structuredQuery: structuredSearchQuery,
      primaryQuery: searchQueryPack.primaryQuery,
      shoppingPlan: shoppingQueryPlan.slice(0, 6),
    })
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

  console.log(
    "[DEPARTMENT_INPUT_ACCEPTED]",
    JSON.stringify({
      selectedDepartment,
      detectedDepartment:
        departmentInputGateWithAiDescription.detectedDepartment ??
        departmentInputGate.detectedDepartment ??
        null,
    })
  );

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

  const inputUrl = canonicalProductUrl;
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
    scrapedSource?.sourceUrl?.trim() || canonicalProductUrl || null;
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

  type PendingCandidate = {
    c: CandidateProduct;
    rel: AttributeMatchResult;
    coupons: PremiumCouponOffer[] | undefined;
  };
  const pending: PendingCandidate[] = [];

  for (const c of deduped) {
    const candidateNormalized = withCriticalAttributes(c.title, c.normalized);
    const candidateWithCritical: CandidateProduct = {
      ...c,
      normalized: candidateNormalized,
    };
    const listingForSameCheck =
      candidateWithCritical.shoppingHintUrl?.trim() || candidateWithCritical.productUrl;

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

    if (inputUrl && areSameRetailerListings(inputUrl, listingForSameCheck)) {
      candidateSteps.push({
        key: candidateKey(c, candidateSteps.length),
        store: c.store,
        title: c.title,
        price: c.price,
        productUrl: c.productUrl,
        outcome: "skipped_same_source_item",
        detail: `same_listing_as_input_url(${listingForSameCheck})`,
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

    if (
      c.commercialListing &&
      shouldRejectCommercialListing(c.commercialListing)
    ) {
      logCommercialListingRejected(c);
      candidateSteps.push({
        key: candidateKey(c, candidateSteps.length),
        store: c.store,
        title: c.title,
        price: c.price,
        productUrl: c.productUrl,
        outcome: "rejected_hard_gate",
        rejectionReason: "commercial_listing_not_purchase",
        detail: `commercial:${c.commercialListing.listingType}:${c.commercialListing.priceIntent}`,
      });
      pipelineLog("candidate_rejected", {
        store: c.store,
        title: c.title.slice(0, 80),
        reason: "commercial_listing_not_purchase",
      });
      bumpAttributeReject("commercial_listing_not_purchase");
      continue;
    }

    const rel = scoreAttributeMatch(
      referenceNormalized,
      candidateWithCritical.normalized,
      queryForMatch,
      candidateWithCritical.title,
      {
        referenceUnderstanding,
        selectedDepartment,
        sourceTitle: referenceProductQuery,
        rejectLogContext: {
          store: c.store,
          sourceHints: scrapedSource?.scrapedHints ?? null,
        },
      }
    );

    if (rel.rejected && isHardAttributeRejection(rel.rejectionReason)) {
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
      bumpAttributeReject(rel.rejectionReason ?? "attribute_rejected_unknown");
      continue;
    }

    const coupons = getSimulatedStoreCoupons(
      candidateWithCritical.store,
      candidateWithCritical.normalized.category
    );
    pending.push({ c: candidateWithCritical, rel, coupons });
  }

  const resolvedPending = await Promise.all(
    pending.map(async ({ c, rel, coupons }) => {
      const resolution = await resolveOutboundUrl({
        store: c.store,
        title: c.title,
        storeLabel: c.sourceLabel,
        shoppingHintUrl: c.shoppingHintUrl,
        normalized: c.normalized,
        demoMode,
      });
      return { c, rel, coupons, resolution };
    }),
  );

  for (const { c, rel, coupons, resolution } of resolvedPending) {
    if (
      !resolution.outboundUrlRaw.trim() ||
      resolution.urlType === "unknown"
    ) {
      rejectionSummary.urlRejected += 1;
    }

    logProductSourceCandidate({
      phase: "compare_candidate",
      store: c.store,
      storeLabel: c.sourceLabel ?? null,
      title: c.title.replace(/\s+/g, " ").trim().slice(0, 120),
      price: c.price,
      sourceAdapter: c.sourceAdapter ?? null,
      rawLinkType: c.rawLinkType ?? null,
      hasPdpUrl:
        candidateHasMerchantPdpHint(c) || resolution.urlType === "product",
      urlType: resolution.urlType,
      urlConfidence: resolution.urlConfidence,
      urlResolutionReason: resolution.urlResolutionReason ?? null,
      matchConfidence: rel.matchConfidenceLabel,
    });

    const identity = scoreProductIdentity(
      referenceNormalized,
      c.normalized,
      c.title,
      {
        sourceTitle: referenceProductQuery,
        sourceHints: scrapedSource?.scrapedHints ?? null,
      }
    );

    const api = toCompareApiCandidate(
      c,
      rel,
      identity,
      resolution,
      coupons,
      rel.departmentTier,
      selectedDepartment,
      referenceNormalized,
      referenceProductQuery,
      referenceListPrice
    );
    rows.push({ api, rel, identity });
    rejectionSummary.acceptedRows += 1;

    candidateSteps.push({
      key: candidateKey(c, candidateSteps.length),
      store: c.store,
      title: c.title,
      price: c.price,
      productUrl: api.productUrl,
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

  const orderedAfterPriceAnnot = applyStrictSearchUrlCapsToCandidates(
    annotateAndOrderCandidates(baseFiltered, referenceListPrice)
  );

  const referencePriceComparable =
    referenceListPrice != null && isValidComparablePrice(referenceListPrice);

  const cheaperPool = referencePriceComparable
    ? orderedAfterPriceAnnot.filter((c) => c.priceCompareSegment === "cheaper")
    : orderedAfterPriceAnnot.filter((c) => isValidComparablePrice(c.price));
  const notCheaperPool = orderedAfterPriceAnnot.filter(
    (c) => c.priceCompareSegment === "not_cheaper"
  );

  const logDisplayReject = (
    role: string,
    c: CompareApiCandidate,
    reason: string
  ) => {
    if (process.env.DEBUG_COMPARE !== "true") return;
    console.log(
      "[FINAL_RESULT_REJECTED]",
      JSON.stringify({
        role,
        reason,
        category: c.normalized.category,
        store: c.store,
        title: c.title.slice(0, 120),
        displayMatchScore: c.displayMatchScore,
        identityScore: c.identityScore,
        relevanceScore: c.relevanceScore,
        priceCompareSegment: c.priceCompareSegment ?? "unknown",
      })
    );
  };

  const isDisplayEligible = (c: CompareApiCandidate): boolean => {
    const score = candidateDisplayScore(c);
    if (score < BAND_POSSIBLE_MIN) {
      logDisplayReject("below_band_floor", c, `score=${score}`);
      return false;
    }
    if (
      !attributesComparableForDisplay(referenceNormalized, c.normalized, score)
    ) {
      logDisplayReject("attributes_not_comparable", c, `score=${score}`);
      return false;
    }
    return true;
  };

  const cheaperEligible = cheaperPool.filter(isDisplayEligible);

  const similarButNotCheaper = notCheaperPool
    .filter(isDisplayEligible)
    .slice(0, DISPLAY_LIMIT);

  const sortByDisplayScore = (a: CompareApiCandidate, b: CompareApiCandidate) =>
    candidateDisplayScore(b) - candidateDisplayScore(a);

  const exactMatches = cheaperEligible
    .filter((c) => !isBlockedFromExactMatchOrBestDeal(c, referenceListPrice))
    .filter((c) => c.confidenceBand === "exact_match")
    .sort(sortByDisplayScore);
  const highConfidenceMatches = cheaperEligible
    .filter((c) => !isBlockedFromExactMatchOrBestDeal(c, referenceListPrice))
    .filter((c) => c.confidenceBand === "high_confidence")
    .sort(sortByDisplayScore);
  let possibleAlternatives = cheaperEligible
    .filter(
      (c) =>
        c.confidenceBand === "possible_alternative" ||
        c.confidenceBand === "similar_specs"
    )
    .sort(sortByDisplayScore);

  const hasHighBand =
    exactMatches.length > 0 || highConfidenceMatches.length > 0;

  const annotatedBaseFiltered = mergePriceAnnotations(
    baseFiltered,
    orderedAfterPriceAnnot
  );

  if (!hasHighBand && possibleAlternatives.length === 0) {
    const fallbackPool = collectModerateBandForDisplay(
      cheaperEligible,
      referenceNormalized,
      { relaxAttributeGate: true }
    );
    if (fallbackPool.length > 0) {
      possibleAlternatives = fallbackPool;
      pipelineLog("fallback_possible_alternatives", {
        count: fallbackPool.length,
        scores: fallbackPool.map((c) => c.displayMatchScore),
      });
    }
  }

  if (!hasHighBand && possibleAlternatives.length === 0) {
    const widerPool = collectModerateBandForDisplay(
      orderedAfterPriceAnnot.filter((c) => candidateDisplayScore(c) >= BAND_POSSIBLE_MIN),
      referenceNormalized,
      { relaxAttributeGate: true }
    );
    if (widerPool.length > 0) {
      possibleAlternatives = widerPool;
      pipelineLog("fallback_possible_alternatives_wider_pool", {
        count: widerPool.length,
        scores: widerPool.map((c) => c.displayMatchScore),
      });
    }
  }

  if (!hasHighBand && possibleAlternatives.length === 0) {
    const basePool = collectModerateBandForDisplay(
      annotatedBaseFiltered,
      referenceNormalized,
      { relaxAttributeGate: true }
    );
    if (basePool.length > 0) {
      possibleAlternatives = basePool;
      pipelineLog("fallback_possible_alternatives_base_filtered", {
        count: basePool.length,
        scores: basePool.map((c) => c.displayMatchScore),
      });
    }
  }

  let matchGroups: MatchResultGroups<CompareApiCandidate> = {
    exactMatches,
    highConfidenceMatches,
    possibleAlternatives,
  };

  let orderedForDisplay = [
    ...exactMatches,
    ...highConfidenceMatches,
    ...possibleAlternatives,
  ].slice(0, DISPLAY_LIMIT);

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

  const scrapedStoreId: StoreId | null =
    scrapedSource?.store && scrapedSource.store !== "unknown"
      ? scrapedSource.store
      : null;
  const sourceListingStore: StoreId | null =
    scrapedStoreId ??
    parsed.detectedStore ??
    (canonicalProductUrl
      ? detectStoreFromProductUrl(canonicalProductUrl)
      : null);

  const sourceProduct =
    scrapedOk && scrapedSource
      ? extractedSourceSummary(
          {
            ...scrapedSource,
            originalPrice: referenceListPrice ?? scrapedSource.originalPrice,
          },
          canonicalProductUrl
        )
      : useManualForm && !canonicalProductUrl
        ? queryDerivedSourceSummary(
            referenceProductQuery,
            parsed.detectedStore,
            referenceNormalized
          )
        : canonicalProductUrl
          ? queryDerivedSourceSummary(
              referenceProductQuery,
              sourceListingStore,
              referenceNormalized,
              canonicalProductUrl
            )
          : useManualForm
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
                    scrapedSource.sourceUrl ?? canonicalProductUrl ?? undefined,
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

  if (orderedForDisplay.length === 0 && baseFiltered.length > 0) {
    const lastChanceModerate = collectModerateBandForDisplay(
      annotatedBaseFiltered,
      referenceNormalized,
      { relaxAttributeGate: true }
    );
    if (lastChanceModerate.length > 0) {
      possibleAlternatives = lastChanceModerate;
      orderedForDisplay = lastChanceModerate;
      matchGroups.possibleAlternatives = lastChanceModerate;
      pipelineLog("fallback_possible_alternatives_from_base_filtered", {
        count: lastChanceModerate.length,
      });
    }
  }

  orderedForDisplay = applyStrictSearchUrlCapsToCandidates(orderedForDisplay);
  matchGroups = partitionCandidatesIntoMatchGroups(orderedForDisplay);

  const hasPossibleAlternativesOnly =
    orderedForDisplay.length > 0 &&
    matchGroups.exactMatches.length === 0 &&
    matchGroups.highConfidenceMatches.length === 0 &&
    matchGroups.possibleAlternatives.length > 0;
  const hasHighBandForDisplay =
    matchGroups.exactMatches.length > 0 || matchGroups.highConfidenceMatches.length > 0;

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
      matchGroups: {
        exactMatches: [],
        highConfidenceMatches: [],
        possibleAlternatives: [],
      },
      similarButNotCheaper: applyStrictSearchUrlCapsToCandidates(similarButNotCheaper),
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
          ? "No listings matched closely enough after attribute checks. Try adding more specific size, model, or accessory details."
          : shoppingApiMissing
            ? "Shopping API credentials missing."
            : "No priced listings found for that search.",
      scrapeBotWalled,
      aiProductSummary: aiCompareEnrichment.summaryOneLine,
      demoMode,
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
  const suppressedByLowScoreOrAttributes =
    cheaperPool.length > 0 && orderedForDisplay.length < 3;

  if (orderedForDisplay.length > 0) {
    const refOk =
      referenceListPrice != null && isValidComparablePrice(referenceListPrice);
    const bestDealPickPool = orderedForDisplay.filter(
      (c) => !isStrictSearchFallbackOutbound(c)
    );
    const pickFrom =
      bestDealPickPool.length > 0 ? bestDealPickPool : orderedForDisplay;
    const purchaseEligible = pickFrom.filter(
      (c) => !isBlockedFromExactMatchOrBestDeal(c, referenceListPrice),
    );
    const bestPickPool = purchaseEligible.length > 0 ? purchaseEligible : [];
    let bestApi: CompareApiCandidate | undefined;
    if (refOk) {
      bestApi = bestPickPool.find(
        (c) =>
          c.priceCompareSegment === "cheaper" && c.confidenceBand === "exact_match",
      );
    }
    if (!bestApi) {
      bestApi = bestPickPool.find((c) => c.confidenceBand === "exact_match");
    }
    // Verified Best Deal requires Exact Match — never promote alternatives.

    const bestRow = bestApi ? rowForApi(bestApi) : undefined;
    if (bestRow && bestApi) {
      const bestDisplayScore = candidateDisplayScore(bestApi);
      if (bestDisplayScore >= MIN_SCORE_PRODUCT_LISTING_OR_BEST_DEAL) {
        const verified =
          bestApi.confidenceBand === "exact_match" &&
          !isStrictSearchFallbackOutbound(bestApi) &&
          !isBlockedFromExactMatchOrBestDeal(bestApi, referenceListPrice);
        if (verified) {
          bestDeal = applyStrictSearchUrlCapToDeal(
            toDeal(bestApi, bestRow.rel, bestRow.identity)
          );
          showBestDeal = true;
        }
      } else if (process.env.DEBUG_COMPARE === "true") {
        console.log(
          "[FINAL_RESULT_REJECTED]",
          JSON.stringify({
            role: "best_deal",
            category: bestApi.normalized.category,
            store: bestApi.store,
            title: bestApi.title.slice(0, 120),
            displayMatchScore: bestDisplayScore,
            minScore: MIN_SCORE_PRODUCT_LISTING_OR_BEST_DEAL,
          })
        );
      }

      alternatives = orderedForDisplay
        .filter(
          (c) =>
            !(
              bestApi &&
              c.store === bestApi.store &&
              c.productUrl === bestApi.productUrl
            )
        )
        .slice(0, Math.max(0, DISPLAY_LIMIT - 1))
        .map((c) => {
          const r = rowForApi(c);
          return r
            ? applyStrictSearchUrlCapToDeal(toDeal(c, r.rel, r.identity))
            : null;
        })
        .filter((d): d is CompareProductDeal => d != null);
    } else {
      // No verified Exact Match — still surface alternatives for the list API.
      alternatives = orderedForDisplay
        .slice(0, Math.max(0, DISPLAY_LIMIT - 1))
        .map((c) => {
          const r = rowForApi(c);
          return r
            ? applyStrictSearchUrlCapToDeal(toDeal(c, r.rel, r.identity))
            : null;
        })
        .filter((d): d is CompareProductDeal => d != null);
    }

    const savingVals = orderedForDisplay
      .filter(
        (c) =>
          c.confidenceBand === "exact_match" &&
          !isBlockedFromExactMatchOrBestDeal(c, referenceListPrice),
      )
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
    if (
      suppressedByLowScoreOrAttributes &&
      matchGroups.possibleAlternatives.length === 0
    ) {
      comparisonMessage = POSSIBLE_ALTERNATIVES_EXPLANATION;
    } else if (hasPossibleAlternativesOnly) {
      comparisonMessage = NO_EXACT_WITH_ALTERNATIVES_MESSAGE;
      message = null;
    } else if (
      !hasHighBandForDisplay &&
      matchGroups.possibleAlternatives.length > 0 &&
      orderedForDisplay.length > 0
    ) {
      comparisonMessage = NO_EXACT_WITH_ALTERNATIVES_MESSAGE;
      message = null;
    } else if (cheaperPool.length > 0) {
      comparisonMessage =
        orderedForDisplay.length >= MIN_CHEAPER_RESULTS_TARGET
          ? `${orderedForDisplay.length} cheaper options than your reference price.`
          : `${orderedForDisplay.length} cheaper option(s) than your reference. Add size or model details if you expected more results.`;
    } else {
      comparisonMessage = "No cheaper matching products found yet.";
    }
  }

  const confidenceOut = overallConfidenceFromDeal(bestDeal);

  const similarButNotCheaperForResponse = applyStrictSearchUrlCapsToCandidates(
    similarButNotCheaper
  );

  const dedupedMessages = dedupeCompareResponseMessages({
    comparisonMessage,
    message,
    hasPossibleAlternativesOnly,
  });
  comparisonMessage = dedupedMessages.comparisonMessage;
  message = dedupedMessages.message;

  if (demoMode) {
    const demoBanner =
      "Demo mode — synthetic listings only; not live prices or inventory.";
    comparisonMessage = comparisonMessage
      ? `${demoBanner} ${comparisonMessage}`
      : demoBanner;
    if (!message) message = demoBanner;
  }

  logCompareCandidateOutbound([
    ...orderedForDisplay,
    ...similarButNotCheaperForResponse,
  ]);

  return {
    query: referenceProductQuery,
    normalizedQuery,
    candidates: orderedForDisplay,
    matchGroups,
    similarButNotCheaper: similarButNotCheaperForResponse,
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
    selectedDepartment,
    demoMode,
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

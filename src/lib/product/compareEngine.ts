import {
  scoreAttributeMatch,
  type AttributeMatchResult,
} from "./attributeMatch";
import { parseProductInput } from "./inputParse";
import {
  areSameRetailerListings,
  buildNormalizedProduct,
  buildNormalizedSearchQuery,
  extractSearchQuery,
} from "./normalize";
import {
  findProductProviderForUrl,
  productProviderRegistry,
} from "./registry";
import { rankMatchTypes } from "./searchRelevance";
import {
  isProductDetailStoreKey,
  isValidProductDetailUrl,
} from "./productDetailUrl";
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
  ProductCategory,
  ProductProvider,
  ProviderSearchDiagnostics,
  ProviderResult,
  SelectionTrace,
  SourceProduct,
  StoreId,
  TvDisplayTechBucket,
} from "./types";

/**
 * Engine-only demo flag: deterministic multi-store pipeline without live SERP.
 * Set `PRODUCT_COMPARE_DEMO_MODE=true` in the server environment.
 */
export const DEMO_MODE = process.env.PRODUCT_COMPARE_DEMO_MODE === "true";

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
    return t.length >= 2 ? t : fallback;
  };

  return {
    primaryQuery: ensure(primary),
    simplifiedQuery: ensure(simplified),
    specsQuery: ensure(specs),
  };
}

async function searchCandidatesWithOrderedQueries(
  provider: ProductProvider,
  queries: string[],
  baseCtx: { rawInput: string; productQuery: string }
): Promise<ProviderResult & { queryUsed: string }> {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const q of queries) {
    const t = q.replace(/\s+/g, " ").trim();
    if (t.length < 2) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    ordered.push(t);
  }

  const fallbackQ =
    baseCtx.productQuery.replace(/\s+/g, " ").trim().slice(0, 80) || "product";

  if (ordered.length === 0) {
    const res = await provider.searchCandidates({
      ...baseCtx,
      searchQuery: fallbackQ,
    });
    return { ...res, queryUsed: res.diagnostics.query };
  }

  let last: ProviderResult | null = null;
  for (const q of ordered) {
    last = await provider.searchCandidates({
      ...baseCtx,
      searchQuery: q,
    });
    if (last.candidates.length > 0) {
      return {
        candidates: last.candidates,
        diagnostics: { ...last.diagnostics, query: q },
        queryUsed: q,
      };
    }
  }

  const finalQ = ordered[ordered.length - 1]!;
  return {
    ...last!,
    diagnostics: { ...last!.diagnostics, query: finalQ },
    queryUsed: finalQ,
  };
}

const MIN_HIGH_CONFIDENCE_FOR_BEST_DEAL = 2;

function isValidComparablePrice(price: number | null | undefined): boolean {
  return price != null && Number.isFinite(price) && price > 0;
}

function pipelineLog(phase: string, data?: Record<string, unknown>) {
  console.log("[compare-product]", phase, data ?? {});
}

function normalizeUrlKey(url: string): string {
  try {
    return url.split("?")[0].toLowerCase().trim();
  } catch {
    return url.toLowerCase().trim();
  }
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
    normalizedTitle: sp.normalized.titleNorm,
  };
}

const DEMO_PRICE_BY_STORE: Record<StoreId, number> = {
  amazon: 129.99,
  walmart: 119.0,
  target: 124.49,
  temu: 109.0,
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

function dedupeByStoreAndUrl(items: CandidateProduct[]): CandidateProduct[] {
  const map = new Map<string, CandidateProduct>();
  for (const item of items) {
    const key = `${item.store}|${normalizeUrlKey(item.productUrl)}`;
    const prev = map.get(key);
    if (
      !prev ||
      (item.price ?? Number.POSITIVE_INFINITY) <
        (prev.price ?? Number.POSITIVE_INFINITY)
    ) {
      map.set(key, item);
    }
  }
  return [...map.values()];
}

function candidateKey(c: CandidateProduct, index: number): string {
  return `${c.store}:${index}:${c.productUrl.slice(-14)}`;
}

function emptyDiagnostics(
  store: StoreId,
  query: string
): ProviderSearchDiagnostics {
  return {
    store,
    query,
    fetchOk: false,
    httpStatus: null,
    byteLength: 0,
    candidateCount: 0,
    hints: ["skipped_during_demo_mode"],
  };
}

function relevanceReasonLine(rel: AttributeMatchResult): string {
  const label =
    rel.matchType === "high"
      ? "Strong attribute match"
      : rel.matchType === "medium"
        ? "Moderate attribute match"
        : "Related listing";
  return `${label}: ${rel.matchType} (${Math.round(rel.confidence * 100)}% confidence, score ${rel.relevanceScore})`;
}

function toCompareApiCandidate(
  c: CandidateProduct,
  rel: AttributeMatchResult,
  affiliateUrl: string
): CompareApiCandidate {
  return {
    store: c.store,
    title: c.title,
    price: c.price,
    currency: c.currency,
    productUrl: c.productUrl,
    affiliateUrl,
    imageUrl: c.imageUrl,
    normalized: c.normalized,
    confidence: rel.confidence,
    matchType: rel.matchType,
    relevanceScore: rel.relevanceScore,
    score: rel.relevanceScore,
    relevanceReason: relevanceReasonLine(rel),
  };
}

function toDeal(
  row: CompareApiCandidate,
  rel: AttributeMatchResult
): CompareProductDeal {
  return {
    store: row.store,
    title: row.title,
    price: row.price,
    currency: row.currency,
    productUrl: row.productUrl,
    affiliateUrl: row.affiliateUrl,
    imageUrl: row.imageUrl,
    confidence: rel.confidence,
    matchType: rel.matchType,
    relevanceScore: rel.relevanceScore,
    score: rel.relevanceScore,
    relevanceReason: relevanceReasonLine(rel),
  };
}

function sortCandidatesForDisplay(rows: CompareApiCandidate[]): CompareApiCandidate[] {
  return [...rows].sort((a, b) => {
    const t = rankMatchTypes(a.matchType, b.matchType);
    if (t !== 0) return t;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const pa = a.price ?? Number.POSITIVE_INFINITY;
    const pb = b.price ?? Number.POSITIVE_INFINITY;
    return pa - pb;
  });
}

function groupByStore(rows: CompareApiCandidate[]): {
  store: StoreId;
  candidates: CompareApiCandidate[];
}[] {
  const order = productProviderRegistry.map((p) => p.id);
  const map = new Map<StoreId, CompareApiCandidate[]>();
  for (const r of rows) {
    const list = map.get(r.store as StoreId) ?? [];
    list.push(r);
    map.set(r.store as StoreId, list);
  }
  return order
    .filter((s) => map.has(s))
    .map((store) => ({
      store,
      candidates: sortCandidatesForDisplay(map.get(store)!),
    }));
}

function overallConfidenceFromDeal(
  deal: CompareProductDeal | null
): CompareConfidence | null {
  if (!deal) return null;
  if (deal.matchType === "high" && deal.confidence >= 0.6) return "high";
  if (deal.matchType === "high" || deal.matchType === "medium") return "medium";
  return "low";
}

export async function compareProduct(
  rawInput: string,
  options: CompareProductOptions = {}
): Promise<CompareProductResponse> {
  const input = rawInput.trim();
  if (!input) {
    throw new Error("Missing product input");
  }

  const debug = Boolean(options.debug);
  const demoMode = DEMO_MODE;

  const traceLog = (...args: unknown[]) => {
    if (debug) console.log("[compare-product:debug]", ...args);
  };

  pipelineLog("input_received", {
    inputPreview: input.slice(0, 200),
    demoMode,
  });

  const parsed = await parseProductInput(input);

  let scrapedSource: SourceProduct | null = null;
  if (parsed.inputUrl && !demoMode) {
    const urlProvider = findProductProviderForUrl(parsed.inputUrl);
    if (urlProvider) {
      try {
        scrapedSource = await urlProvider.extractSourceProduct(parsed.inputUrl);
      } catch (err) {
        pipelineLog("extract_source_failed", {
          inputUrl: parsed.inputUrl.slice(0, 200),
          error: err instanceof Error ? err.message : String(err),
        });
        scrapedSource = null;
      }
    }
  }

  const scrapedOk = Boolean(scrapedSource?.title?.trim());
  const referenceProductQuery = scrapedOk
    ? scrapedSource!.title.trim()
    : parsed.productQuery.trim();

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
    };
  }

  const referenceNormalized = scrapedOk
    ? scrapedSource!.normalized
    : buildNormalizedProduct(parsed.productQuery);

  const normalizedQuery = buildNormalizedSearchQuery(
    referenceNormalized,
    referenceProductQuery
  );

  const searchQueryPack = buildRetailSearchQueryPack(
    referenceNormalized,
    referenceProductQuery
  );

  console.log(
    "[QUERY_PACK]",
    JSON.stringify({
      primaryQuery: searchQueryPack.primaryQuery,
      simplifiedQuery: searchQueryPack.simplifiedQuery,
      specsQuery: searchQueryPack.specsQuery,
    })
  );

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

  let providerQueries = productProviderRegistry.map((p) => ({
    store: p.id,
    query: searchQueryPack.primaryQuery,
  }));
  traceLog("provider_query_used", {
    normalizedQuery,
    searchQueryPack,
    providerQueries,
  });

  let allCandidates: CandidateProduct[] = [];
  const candidatesPerProvider: { store: string; count: number }[] = [];
  let providerDiagnostics: ProviderSearchDiagnostics[] = [];

  const registeredStores = productProviderRegistry.map((p) => p.id);
  const searchCtxBase = {
    rawInput: input,
    productQuery: referenceProductQuery,
  };

  if (demoMode) {
    pipelineLog("demo_mode", { note: "synthetic_listings" });
    allCandidates = buildDemoCandidates(
      referenceNormalized,
      searchQueryPack.primaryQuery,
      registeredStores
    );
    providerDiagnostics = registeredStores.map((store) =>
      emptyDiagnostics(store, searchQueryPack.primaryQuery)
    );
    for (const p of productProviderRegistry) {
      const n = allCandidates.filter((c) => c.store === p.id).length;
      candidatesPerProvider.push({ store: p.id, count: n });
    }
  } else {
    const packOrder = [
      searchQueryPack.primaryQuery,
      searchQueryPack.simplifiedQuery,
      searchQueryPack.specsQuery,
    ];
    const outcomes = await Promise.all(
      productProviderRegistry.map(async (p) => {
        const result = await searchCandidatesWithOrderedQueries(
          p,
          packOrder,
          searchCtxBase
        );
        return { store: p.id, result };
      })
    );

    providerQueries = outcomes.map((o) => ({
      store: o.store,
      query: o.result.queryUsed,
    }));

    for (const o of outcomes) {
      console.log(
        "[QUERY_USED_BY_STORE]",
        JSON.stringify({ store: o.store, query: o.result.queryUsed })
      );
      providerDiagnostics.push(o.result.diagnostics);
      candidatesPerProvider.push({
        store: o.store,
        count: o.result.candidates.length,
      });
      pipelineLog("candidates_by_store", {
        store: o.store,
        count: o.result.candidates.length,
        query: o.result.diagnostics.query,
        fetchOk: o.result.diagnostics.fetchOk,
      });
      traceLog("provider_search_diagnostics", o.result.diagnostics);
      allCandidates = allCandidates.concat(o.result.candidates);
    }
  }

  console.log("[CANDIDATES_TOTAL]", JSON.stringify({ total: allCandidates.length }));

  pipelineLog("candidates_total", {
    total: allCandidates.length,
    byStore: candidatesPerProvider,
  });

  const inputUrl = parsed.inputUrl?.trim();
  const priced = allCandidates.filter((c) => isValidComparablePrice(c.price));
  for (const c of allCandidates) {
    if (!isValidComparablePrice(c.price)) {
      pipelineLog("candidate_rejected", {
        store: c.store,
        title: c.title.slice(0, 80),
        reason: "missing_or_invalid_price",
      });
    }
  }

  const deduped = dedupeByStoreAndUrl(priced);

  const affiliateFor = (c: CandidateProduct) =>
    productProviderRegistry.find((p) => p.id === c.store)?.toAffiliateUrl(c.productUrl) ??
    c.affiliateUrl;

  const candidateSteps: CandidateStepTrace[] = [];
  const queryForMatch = `${referenceProductQuery} ${normalizedQuery}`.trim();

  type Row = {
    api: CompareApiCandidate;
    rel: AttributeMatchResult;
  };

  const rows: Row[] = [];

  for (const c of deduped) {
    const candidateListingKey = c.productUrl;

    traceLog("normalized_candidate", {
      store: c.store,
      titlePreview: c.title.slice(0, 120),
    });

    if (
      !isProductDetailStoreKey(c.store) ||
      !isValidProductDetailUrl(c.store, c.productUrl)
    ) {
      candidateSteps.push({
        key: candidateKey(c, candidateSteps.length),
        store: c.store,
        title: c.title,
        price: c.price,
        productUrl: c.productUrl,
        outcome: "invalid_product_url",
        rejectionReason: "invalid_product_url",
        detail: "invalid_product_url",
      });
      pipelineLog("candidate_rejected", {
        store: c.store,
        title: c.title.slice(0, 80),
        reason: "invalid_product_url",
      });
      traceLog("invalid_product_url", {
        store: c.store,
        urlPreview: c.productUrl.slice(0, 200),
      });
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
      continue;
    }

    const rel = scoreAttributeMatch(
      referenceNormalized,
      c.normalized,
      queryForMatch,
      c.title
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
      continue;
    }

    const api = toCompareApiCandidate(c, rel, affiliateFor(c));
    rows.push({ api, rel });

    candidateSteps.push({
      key: candidateKey(c, candidateSteps.length),
      store: c.store,
      title: c.title,
      price: c.price,
      productUrl: c.productUrl,
      outcome: "evaluated",
      matchConfidence: undefined,
      matchScore: rel.relevanceScore,
      matchReasons: rel.reasons,
      eligibleForComparable: rel.matchType === "high",
      detail: `attribute_match:${rel.matchType}`,
    });

    traceLog("candidate_attribute_match", {
      store: c.store,
      matchType: rel.matchType,
      confidence: rel.confidence,
      score: rel.relevanceScore,
    });
  }

  const flatSorted = sortCandidatesForDisplay(rows.map((r) => r.api)).filter(
    (api) =>
      isProductDetailStoreKey(api.store) &&
      isValidProductDetailUrl(api.store, api.productUrl)
  );

  const sourceProduct =
    scrapedOk && scrapedSource
      ? extractedSourceSummary(scrapedSource, parsed.inputUrl)
      : queryDerivedSourceSummary(
          parsed.productQuery,
          parsed.detectedStore,
          referenceNormalized
        );

  const selectionBase: SelectionTrace = {
    trustworthyCount: rows.filter((r) => r.rel.matchType === "high").length,
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
                  title: parsed.productQuery,
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

  if (flatSorted.length === 0) {
    const allFilteredByAttributes = deduped.length > 0 && rows.length === 0;
    pipelineLog("selection_final", {
      bestDeal: null,
      reason: allFilteredByAttributes ? "all_candidates_failed_attribute_gates" : "no_priced_candidates",
    });
    return {
      query: referenceProductQuery,
      normalizedQuery,
      candidates: [],
      resultsByStore: [],
      bestDeal: null,
      showBestDeal: false,
      confidence: null,
      message: allFilteredByAttributes
        ? "No listings matched closely enough after attribute checks. Try adding brand, size, or model number."
        : "No search results with prices yet. Try a different product name.",
      sourceProduct,
      alternatives: [],
      savings: null,
      comparisonMessage: allFilteredByAttributes
        ? "No close matches passed filters."
        : "No priced listings found for that search.",
      ...(tracePayload() ? { comparisonTrace: tracePayload()! } : {}),
    };
  }

  const highPriced = rows.filter(
    (r) =>
      r.rel.matchType === "high" &&
      isValidComparablePrice(r.api.price) &&
      isProductDetailStoreKey(r.api.store) &&
      isValidProductDetailUrl(r.api.store, r.api.productUrl)
  );

  let bestDeal: CompareProductDeal | null = null;
  let alternatives: CompareProductDeal[] = [];
  let savings: number | null = null;
  let showBestDeal = false;
  let message: string | null = null;
  let comparisonMessage: string | null = null;

  if (highPriced.length >= MIN_HIGH_CONFIDENCE_FOR_BEST_DEAL) {
    highPriced.sort(
      (a, b) =>
        (a.api.price ?? Number.POSITIVE_INFINITY) -
        (b.api.price ?? Number.POSITIVE_INFINITY)
    );
    const winner = highPriced[0]!;
    const rest = highPriced.slice(1);
    bestDeal = toDeal(winner.api, winner.rel);
    alternatives = rest
      .filter(
        (x) =>
          isProductDetailStoreKey(x.api.store) &&
          isValidProductDetailUrl(x.api.store, x.api.productUrl)
      )
      .map((x) => toDeal(x.api, x.rel));
    showBestDeal = true;
    const prices = highPriced
      .map((x) => x.api.price)
      .filter(isValidComparablePrice) as number[];
    if (prices.length >= 2) {
      savings = Math.max(...prices) - Math.min(...prices);
    }
    if (
      !isProductDetailStoreKey(bestDeal.store) ||
      !isValidProductDetailUrl(bestDeal.store, bestDeal.productUrl)
    ) {
      pipelineLog("selection_final", {
        bestDeal: null,
        reason: "invalid_product_url",
      });
      bestDeal = null;
      alternatives = [];
      showBestDeal = false;
      savings = null;
      comparisonMessage = "Closest matches found";
      message = null;
      selectionBase.pickedStore = null;
      selectionBase.reasonNoDeal = "invalid_product_url";
    } else {
      selectionBase.pickedStore = bestDeal.store;
      pipelineLog("selection_final_best_deal", {
        store: bestDeal.store,
        price: bestDeal.price,
        highTierCount: highPriced.length,
      });
    }
  } else {
    showBestDeal = false;
    bestDeal = null;
    alternatives = [];
    savings = null;
    comparisonMessage = "Closest matches found";
    message = null;
    selectionBase.reasonNoDeal = `need_at_least_${MIN_HIGH_CONFIDENCE_FOR_BEST_DEAL}_high_relevance_had_${highPriced.length}`;
    pipelineLog("selection_final", {
      bestDeal: null,
      reason: selectionBase.reasonNoDeal,
      highTierCount: highPriced.length,
    });
  }

  const confidenceOut = overallConfidenceFromDeal(bestDeal);

  return {
    query: referenceProductQuery,
    normalizedQuery,
    candidates: flatSorted,
    resultsByStore: groupByStore(flatSorted),
    bestDeal,
    showBestDeal,
    confidence: confidenceOut,
    message,
    sourceProduct,
    alternatives,
    savings,
    comparisonMessage,
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

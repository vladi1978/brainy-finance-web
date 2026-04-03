import {
  scoreAttributeMatch,
  type AttributeMatchResult,
} from "./attributeMatch";
import { parseProductInput } from "./inputParse";
import {
  areSameRetailerListings,
  buildNormalizedProduct,
  buildNormalizedSearchQuery,
} from "./normalize";
import { productProviderRegistry } from "./registry";
import { rankMatchTypes } from "./searchRelevance";
import type {
  CandidateProduct,
  CandidateStepTrace,
  CompareApiCandidate,
  CompareConfidence,
  CompareProductDeal,
  CompareProductOptions,
  CompareProductResponse,
  ComparisonTrace,
  ProviderSearchDiagnostics,
  SelectionTrace,
  StoreId,
} from "./types";

/**
 * Engine-only demo flag: deterministic multi-store pipeline without live SERP.
 * Set `PRODUCT_COMPARE_DEMO_MODE=true` in the server environment.
 */
export const DEMO_MODE = process.env.PRODUCT_COMPARE_DEMO_MODE === "true";

export function isCompareDemoMode(): boolean {
  return DEMO_MODE;
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
  urlStore: StoreId | null,
  norm: import("./types").NormalizedProduct
): NonNullable<CompareProductResponse["sourceProduct"]> {
  return {
    title: productQuery,
    store: urlStore ?? "unknown",
    originalPrice: null,
    currency: "USD",
    normalizedTitle: norm.titleNorm,
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

  const parsed = parseProductInput(input);
  if (!parsed.productQuery.trim()) {
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

  const referenceNormalized = buildNormalizedProduct(parsed.productQuery);
  const normalizedQuery = buildNormalizedSearchQuery(
    referenceNormalized,
    parsed.productQuery
  );

  pipelineLog("derived_search_query", {
    productQuery: parsed.productQuery.slice(0, 200),
    normalizedQuery,
    urlStore: parsed.urlStore,
  });

  traceLog("normalized_reference_profile", {
    titleNorm: referenceNormalized.titleNorm,
    brand: referenceNormalized.brand,
    category: referenceNormalized.category,
  });

  const providerQueries = productProviderRegistry.map((p) => ({
    store: p.id,
    query: normalizedQuery,
  }));
  traceLog("provider_query_used", { searchQuery: normalizedQuery, providerQueries });

  let allCandidates: CandidateProduct[] = [];
  const candidatesPerProvider: { store: string; count: number }[] = [];
  let providerDiagnostics: ProviderSearchDiagnostics[] = [];

  const registeredStores = productProviderRegistry.map((p) => p.id);
  const searchCtx = {
    rawInput: input,
    searchQuery: normalizedQuery,
    productQuery: parsed.productQuery,
  };

  if (demoMode) {
    pipelineLog("demo_mode", { note: "synthetic_listings" });
    allCandidates = buildDemoCandidates(
      referenceNormalized,
      normalizedQuery,
      registeredStores
    );
    providerDiagnostics = registeredStores.map((store) =>
      emptyDiagnostics(store, normalizedQuery)
    );
    for (const p of productProviderRegistry) {
      const n = allCandidates.filter((c) => c.store === p.id).length;
      candidatesPerProvider.push({ store: p.id, count: n });
    }
  } else {
    const outcomes = await Promise.all(
      productProviderRegistry.map(async (p) => {
        const result = await p.searchCandidates(searchCtx);
        return { store: p.id, result };
      })
    );

    for (const o of outcomes) {
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
  const queryForMatch = `${parsed.productQuery} ${normalizedQuery}`.trim();

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

  const flatSorted = sortCandidatesForDisplay(rows.map((r) => r.api));

  const sourceProduct = queryDerivedSourceSummary(
    parsed.productQuery,
    parsed.urlStore,
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
          detectedStore: parsed.urlStore,
          searchQueryUsed: normalizedQuery,
          demoMode,
          sourceSummary: {
            title: parsed.productQuery,
            store: parsed.urlStore ?? "unknown",
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
      query: parsed.productQuery,
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
      r.rel.matchType === "high" && isValidComparablePrice(r.api.price)
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
    alternatives = rest.map((x) => toDeal(x.api, x.rel));
    showBestDeal = true;
    const prices = highPriced
      .map((x) => x.api.price)
      .filter(isValidComparablePrice) as number[];
    if (prices.length >= 2) {
      savings = Math.max(...prices) - Math.min(...prices);
    }
    selectionBase.pickedStore = bestDeal.store;
    pipelineLog("selection_final_best_deal", {
      store: bestDeal.store,
      price: bestDeal.price,
      highTierCount: highPriced.length,
    });
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
    query: parsed.productQuery,
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

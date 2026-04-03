import {
  evaluateCandidate,
  isAlternativeTier,
  isPrimaryComparableTier,
} from "./match";
import {
  areSameRetailerListings,
  buildNormalizedProduct,
  detectStoreFromProductUrl,
  extractSearchQuery,
  retailerListingIdentityKey,
} from "./normalize";
import { productProviderRegistry } from "./registry";
import type {
  CandidateProduct,
  CandidateStepTrace,
  CompareProductOptions,
  CompareProductResponse,
  ComparisonTrace,
  MatchConfidenceLabel,
  NormalizedProduct,
  ProviderSearchDiagnostics,
  SelectionTrace,
  SourceProduct,
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

/** Need at least one comparable (cross-store rules still apply). */
const MIN_TRUSTWORTHY_COMPARABLES = 1;

/**
 * When strict tiers find nothing, pick among candidates that still passed hard gates
 * and reached this raw score — keeps MVP usable when SERP titles diverge.
 */
const FALLBACK_MIN_SCORE = 22;

function isValidComparablePrice(price: number | null | undefined): boolean {
  return price != null && Number.isFinite(price) && price > 0;
}

function computeSavings(
  sourcePrice: number | null | undefined,
  bestPrice: number | null | undefined
): number | null {
  if (!isValidComparablePrice(sourcePrice) || !isValidComparablePrice(bestPrice)) {
    return null;
  }
  const s = sourcePrice!;
  const b = bestPrice!;
  return Math.max(0, s - b);
}

function normalizeUrlKey(url: string): string {
  try {
    return url.split("?")[0].toLowerCase().trim();
  } catch {
    return url.toLowerCase().trim();
  }
}

function sourceSummaryForApi(
  source: SourceProduct | null,
  fallbackTitle: string,
  meta: {
    effectiveStore: StoreId | "unknown";
    effectiveSourceUrl?: string;
  }
): CompareProductResponse["sourceProduct"] {
  if (source) {
    return {
      sourceUrl: source.sourceUrl,
      store: source.store,
      title: source.title,
      originalPrice: source.originalPrice,
      currency: source.currency,
      normalizedTitle: source.normalized.titleNorm,
    };
  }
  const n = buildNormalizedProduct(fallbackTitle);
  return {
    ...(meta.effectiveSourceUrl ? { sourceUrl: meta.effectiveSourceUrl } : {}),
    store: meta.effectiveStore,
    title: fallbackTitle,
    originalPrice: null,
    currency: "USD",
    normalizedTitle: n.titleNorm,
  };
}

const DEMO_PRICE_BY_STORE: Record<StoreId, number> = {
  amazon: 129.99,
  walmart: 119.0,
  target: 124.49,
  temu: 109.0,
};

function buildDemoCandidates(
  normalizedSource: NormalizedProduct,
  searchQuery: string,
  stores: readonly StoreId[]
): CandidateProduct[] {
  const base =
    normalizedSource.titleNorm.slice(0, 80) ||
    searchQuery.slice(0, 80) ||
    "demo wireless headphones";
  const slug = base.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const sharedNorm: NormalizedProduct = { ...normalizedSource };

  return stores.map((store) => ({
    store,
    title: `${base} (${store} demo)`,
    price: DEMO_PRICE_BY_STORE[store],
    currency: "USD",
    productUrl: `https://${store}.example.com/p/DEMO-${slug.slice(0, 8)}`,
    affiliateUrl: `https://${store}.example.com/p/DEMO-${slug.slice(0, 8)}`,
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
    if (debug) console.log("[compare-product]", ...args);
  };

  traceLog("pipeline_start", {
    inputPreview: input.slice(0, 120),
    demoMode,
    debug,
  });

  let sourceProduct: SourceProduct | null = null;
  let detectedStore: string | null = null;

  const providerForUrl =
    productProviderRegistry.find((p) => p.canHandleProductUrl(input)) ?? null;

  if (providerForUrl) {
    detectedStore = providerForUrl.id;
    sourceProduct = await providerForUrl.extractSourceProduct(input);
    traceLog("source_product_extracted", {
      ok: Boolean(sourceProduct),
      store: detectedStore,
      title: sourceProduct?.title ?? null,
      originalPrice: sourceProduct?.originalPrice ?? null,
      currency: sourceProduct?.currency ?? null,
      sourceUrl: sourceProduct?.sourceUrl ?? null,
    });
  } else {
    traceLog("source_product_extracted", {
      ok: false,
      note: "plain_text_or_unsupported_url",
    });
  }

  const searchBase = sourceProduct?.title?.trim() || input;
  const searchQuery = extractSearchQuery(searchBase);

  const normalizedSource = sourceProduct?.normalized ?? buildNormalizedProduct(searchBase);
  traceLog("normalized_source_product", {
    titleNorm: normalizedSource.titleNorm,
    brand: normalizedSource.brand,
    modelTokens: normalizedSource.modelTokens,
    sizeInches: normalizedSource.sizeInches,
    category: normalizedSource.category,
    packCount: normalizedSource.packCount,
    gender: normalizedSource.gender,
  });

  const providerQueries = productProviderRegistry.map((p) => ({
    store: p.id,
    query: searchQuery,
  }));
  traceLog("provider_query_used", { searchQuery, providerQueries });

  let allCandidates: CandidateProduct[] = [];
  const candidatesPerProvider: { store: string; count: number }[] = [];
  let providerDiagnostics: ProviderSearchDiagnostics[] = [];

  const registeredStores = productProviderRegistry.map((p) => p.id);

  if (demoMode) {
    traceLog("demo_mode_active", {
      note: "skipping_live_serp_fetch_using_synthetic_listings",
    });
    allCandidates = buildDemoCandidates(
      normalizedSource,
      searchQuery,
      registeredStores
    );
    providerDiagnostics = registeredStores.map((store) =>
      emptyDiagnostics(store, searchQuery)
    );
    for (const p of productProviderRegistry) {
      const n = allCandidates.filter((c) => c.store === p.id).length;
      candidatesPerProvider.push({ store: p.id, count: n });
      traceLog("candidates_returned_per_provider", { store: p.id, count: n });
    }
  } else {
    const outcomes = await Promise.all(
      productProviderRegistry.map(async (p) => {
        const result = await p.searchCandidates({
          rawInput: input,
          searchQuery,
          sourceProduct,
        });
        return { store: p.id, result };
      })
    );

    for (const o of outcomes) {
      providerDiagnostics.push(o.result.diagnostics);
      candidatesPerProvider.push({
        store: o.store,
        count: o.result.candidates.length,
      });
      traceLog("provider_search_diagnostics", {
        store: o.store,
        query: o.result.diagnostics.query,
        fetchOk: o.result.diagnostics.fetchOk,
        httpStatus: o.result.diagnostics.httpStatus,
        byteLength: o.result.diagnostics.byteLength,
        candidateCount: o.result.diagnostics.candidateCount,
        hints: o.result.diagnostics.hints,
      });
      traceLog("candidates_returned_per_provider", {
        store: o.store,
        count: o.result.candidates.length,
      });
      allCandidates = allCandidates.concat(o.result.candidates);
    }
  }

  traceLog("candidates_found_total", {
    total: allCandidates.length,
    byStore: candidatesPerProvider,
  });

  const urlDetectedStore = detectStoreFromProductUrl(input);
  const effectiveSourceStore: StoreId | "unknown" =
    sourceProduct && sourceProduct.store !== "unknown"
      ? sourceProduct.store
      : (providerForUrl?.id ?? urlDetectedStore ?? "unknown");
  const effectiveSourceUrl =
    sourceProduct?.sourceUrl ??
    (/^https?:\/\//i.test(input.trim()) ? input.trim() : undefined);

  const sourceListingKey = effectiveSourceUrl
    ? retailerListingIdentityKey(effectiveSourceUrl)
    : null;

  traceLog("source_identity", {
    sourceStore: effectiveSourceStore,
    sourceUrl: effectiveSourceUrl ?? null,
    sourceNormalizedId: sourceListingKey,
    urlDetectedStore,
    providerDetectedStore: providerForUrl?.id ?? null,
  });

  const priced = allCandidates.filter((c) => isValidComparablePrice(c.price));
  for (const c of allCandidates) {
    if (!isValidComparablePrice(c.price)) {
      traceLog("candidate_rejected", {
        store: c.store,
        title: c.title.slice(0, 80),
        reason: "missing_or_invalid_price",
      });
    }
  }

  const deduped = dedupeByStoreAndUrl(priced);

  const candidateSteps: CandidateStepTrace[] = [];
  type Scored = {
    candidate: CandidateProduct;
    score: number;
    matchConfidence: MatchConfidenceLabel | "none";
    reasons: string[];
    primaryComparable: boolean;
    alternativeComparable: boolean;
    rejected: boolean;
    rejectionDetail: string | null;
    comparisonReason: string;
  };

  const affiliateFor = (c: CandidateProduct) =>
    productProviderRegistry.find((p) => p.id === c.store)?.toAffiliateUrl(c.productUrl) ??
    c.affiliateUrl;

  const scored: Scored[] = [];

  for (const c of deduped) {
    const candidateListingKey = retailerListingIdentityKey(c.productUrl);

    traceLog("normalized_candidate", {
      store: c.store,
      candidateUrl: c.productUrl,
      candidateNormalizedId: candidateListingKey,
      titlePreview: c.title.slice(0, 120),
      normalized: {
        titleNorm: c.normalized.titleNorm,
        brand: c.normalized.brand,
        category: c.normalized.category,
        packCount: c.normalized.packCount,
        sizeInches: c.normalized.sizeInches,
        gender: c.normalized.gender,
        modelTokens: c.normalized.modelTokens,
      },
    });

    if (
      effectiveSourceUrl &&
      areSameRetailerListings(effectiveSourceUrl, c.productUrl)
    ) {
      candidateSteps.push({
        key: candidateKey(c, candidateSteps.length),
        store: c.store,
        title: c.title,
        price: c.price,
        productUrl: c.productUrl,
        outcome: "skipped_same_source_item",
        detail: `same_listing_as_source(sourceId=${sourceListingKey},candidateId=${candidateListingKey})`,
      });
      traceLog("candidate_rejected_same_as_source", {
        sourceStore: effectiveSourceStore,
        sourceUrl: effectiveSourceUrl,
        sourceNormalizedId: sourceListingKey,
        candidateStore: c.store,
        candidateUrl: c.productUrl,
        candidateNormalizedId: candidateListingKey,
        reason: "same_listing_identity_as_source",
      });
      continue;
    }

    const ev = evaluateCandidate(normalizedSource, c);
    const primaryComparable =
      !ev.rejected &&
      ev.rejectionDetail == null &&
      isPrimaryComparableTier(ev.matchConfidence);
    const alternativeComparable =
      !ev.rejected &&
      ev.rejectionDetail == null &&
      isAlternativeTier(ev.matchConfidence);

    traceLog("candidate_match_score", {
      store: c.store,
      candidateUrl: c.productUrl,
      candidateNormalizedId: candidateListingKey,
      title: c.title.slice(0, 100),
      price: c.price,
      matchConfidence: ev.matchConfidence,
      score: ev.score,
      primaryComparable,
      alternativeComparable,
      hardRejected: ev.rejected,
      rejectionDetail: ev.rejectionDetail,
      score_breakdown: ev.reasons,
    });

    if (ev.rejected) {
      traceLog("candidate_rejection_reason", {
        store: c.store,
        title: c.title.slice(0, 80),
        reason: ev.rejectionDetail ?? "hard_gate",
      });
    } else if (ev.rejectionDetail) {
      traceLog("candidate_rejection_reason", {
        store: c.store,
        title: c.title.slice(0, 80),
        reason: ev.rejectionDetail,
      });
    }

    scored.push({
      candidate: c,
      score: ev.score,
      matchConfidence: ev.matchConfidence,
      reasons: ev.reasons,
      primaryComparable,
      alternativeComparable,
      rejected: ev.rejected,
      rejectionDetail: ev.rejectionDetail,
      comparisonReason: ev.comparisonReason,
    });

    const eligible = primaryComparable || alternativeComparable;
    candidateSteps.push({
      key: candidateKey(c, candidateSteps.length),
      store: c.store,
      title: c.title,
      price: c.price,
      productUrl: c.productUrl,
      outcome: ev.rejected ? "rejected_hard_gate" : "evaluated",
      matchConfidence: ev.matchConfidence,
      matchScore: ev.score,
      matchReasons: ev.reasons,
      eligibleForComparable: eligible,
      detail: ev.rejected
        ? (ev.rejectionDetail ?? "hard_gate")
        : (ev.rejectionDetail ?? "passed_match_eval"),
    });
  }

  const primaryPool = scored.filter((s) => s.primaryComparable);
  const alternativePool = scored.filter((s) => s.alternativeComparable);

  /** Prefer another retailer; if none qualify, allow same-store listings that are not the source item. */
  const pickCrossStorePool = (pool: Scored[]): Scored[] => {
    if (pool.length === 0) return [];
    if (!effectiveSourceStore || effectiveSourceStore === "unknown") return pool;
    const other = pool.filter((s) => s.candidate.store !== effectiveSourceStore);
    return other.length > 0 ? other : pool;
  };

  const stripSelfListings = (pool: Scored[]): Scored[] => {
    if (!effectiveSourceUrl) return pool;
    return pool.filter(
      (s) => !areSameRetailerListings(effectiveSourceUrl, s.candidate.productUrl)
    );
  };

  let chosenPool = stripSelfListings(pickCrossStorePool(primaryPool));
  let pickedAsClosestSimilar = false;
  let pickKind: "primary" | "alternative" | "rescue" = "primary";

  if (chosenPool.length === 0) {
    chosenPool = stripSelfListings(pickCrossStorePool(alternativePool));
    pickedAsClosestSimilar = chosenPool.length > 0;
    pickKind = "alternative";
  }

  if (chosenPool.length === 0) {
    const rescuePool = scored.filter(
      (s) => !s.rejected && s.score >= FALLBACK_MIN_SCORE
    );
    chosenPool = stripSelfListings(pickCrossStorePool(rescuePool));
    pickedAsClosestSimilar = chosenPool.length > 0;
    pickKind = "rescue";
    traceLog("rescue_pool_applied", {
      rescueCandidates: rescuePool.length,
      afterCrossStore: chosenPool.length,
      minScore: FALLBACK_MIN_SCORE,
    });
  }

  let selection: SelectionTrace = {
    trustworthyCount: chosenPool.length,
    pickedStore: null,
    reasonNoDeal: null,
    pickedAsClosestSimilar,
  };

  let reasonNoDeal: string | null = null;
  if (chosenPool.length < MIN_TRUSTWORTHY_COMPARABLES) {
    reasonNoDeal = `no_comparable_listing(primary=${primaryPool.length},alt=${alternativePool.length},rescue_attempted=1,after_cross_store=${chosenPool.length})`;
  }

  const buildRejectionReasons = (): string[] => {
    const summary = `selection: primary=${primaryPool.length} alternative=${alternativePool.length} rescue_min=${FALLBACK_MIN_SCORE} chosen_after_cross_store=${chosenPool.length}`;
    const detail = scored
      .filter((s) => !s.primaryComparable && !s.alternativeComparable)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((s) =>
        s.rejected
          ? `${s.candidate.store}: ${s.rejectionDetail ?? "hard_gate"}`
          : `${s.candidate.store} (score=${s.score}): ${s.rejectionDetail ?? "below_threshold"}`
      );
    return [summary, ...detail];
  };

  if (reasonNoDeal) {
    selection = { ...selection, reasonNoDeal };
    traceLog("selection_final", {
      bestDeal: null,
      reason: reasonNoDeal,
      primaryPool: primaryPool.length,
      alternativePool: alternativePool.length,
      chosenAfterCrossStore: chosenPool.length,
      minRequired: MIN_TRUSTWORTHY_COMPARABLES,
    });

    const trace: ComparisonTrace | undefined = debug
      ? {
          inputRaw: input,
          detectedStore,
          searchQueryUsed: searchQuery,
          demoMode,
          sourceSummary: sourceProduct
            ? {
                title: sourceProduct.title,
                store: sourceProduct.store,
                originalPrice: sourceProduct.originalPrice,
                sourceUrl: sourceProduct.sourceUrl,
              }
            : null,
          providerQueries,
          candidatesPerProvider,
          providerDiagnostics,
          candidateSteps,
          selection,
        }
      : undefined;

    return {
      sourceProduct: sourceSummaryForApi(sourceProduct, searchBase, {
        effectiveStore: effectiveSourceStore,
        effectiveSourceUrl,
      }),
      bestDeal: null,
      alternatives: [],
      savings: null,
      comparisonMessage: "No comparable match found yet",
      rejectionReasons: buildRejectionReasons(),
      ...(trace ? { comparisonTrace: trace } : {}),
    };
  }

  chosenPool.sort(
    (a, b) =>
      (a.candidate.price ?? Number.POSITIVE_INFINITY) -
      (b.candidate.price ?? Number.POSITIVE_INFINITY)
  );

  const winner = chosenPool[0]!;
  const rest = chosenPool.slice(1);

  traceLog("selection_final_best_deal", {
    bestDeal: {
      store: winner.candidate.store,
      price: winner.candidate.price,
      productUrl: winner.candidate.productUrl,
      candidateNormalizedId: retailerListingIdentityKey(winner.candidate.productUrl),
      matchConfidence: winner.matchConfidence,
      score: winner.score,
      pickKind,
    },
    sourceReference: {
      sourceStore: effectiveSourceStore,
      sourceUrl: effectiveSourceUrl ?? null,
      sourceNormalizedId: sourceListingKey,
    },
    alternativeCount: rest.length,
    closestSimilarOnly: pickedAsClosestSimilar,
    note: "lowest_price_among_chosen_pool",
  });

  selection = {
    trustworthyCount: chosenPool.length,
    pickedStore: winner.candidate.store,
    reasonNoDeal: null,
    pickedAsClosestSimilar,
  };

  const toDeal = (s: Scored) => {
    const rescuePick = pickKind === "rescue";
    const label: MatchConfidenceLabel =
      rescuePick && s.matchConfidence === "none"
        ? "alternative"
        : (s.matchConfidence as MatchConfidenceLabel);
    return {
      store: s.candidate.store,
      title: s.candidate.title,
      price: s.candidate.price,
      currency: s.candidate.currency,
      productUrl: s.candidate.productUrl,
      affiliateUrl: affiliateFor(s.candidate),
      matchScore: s.score,
      matchConfidence: label,
      comparisonReason: rescuePick
        ? "Closest comparable listing using relaxed MVP scoring (retailer titles often differ from the source)."
        : s.comparisonReason,
    };
  };

  const bestDeal = toDeal(winner);
  const alternatives = rest.map(toDeal);

  const trace: ComparisonTrace | undefined = debug
    ? {
        inputRaw: input,
        detectedStore,
        searchQueryUsed: searchQuery,
        demoMode,
        sourceSummary: sourceProduct
          ? {
              title: sourceProduct.title,
              store: sourceProduct.store,
              originalPrice: sourceProduct.originalPrice,
              sourceUrl: sourceProduct.sourceUrl,
            }
          : null,
        providerQueries,
        candidatesPerProvider,
        providerDiagnostics,
        candidateSteps,
        selection,
      }
    : undefined;

  return {
    sourceProduct: sourceSummaryForApi(sourceProduct, searchBase, {
      effectiveStore: effectiveSourceStore,
      effectiveSourceUrl,
    }),
    bestDeal,
    alternatives,
    savings: computeSavings(
      sourceProduct?.originalPrice,
      winner.candidate.price
    ),
    comparisonMessage: null,
    closestSimilarDealOnly: pickedAsClosestSimilar,
    rejectionReasons: [],
    ...(trace ? { comparisonTrace: trace } : {}),
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

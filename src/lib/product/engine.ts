import { evaluateCandidate, isTrustworthyTier } from "./match";
import { buildNormalizedProduct, extractSearchQuery } from "./normalize";
import { productProviderRegistry } from "./registry";
import type {
  CandidateStepTrace,
  CompareProductOptions,
  CompareProductResponse,
  ComparisonTrace,
  CandidateProduct,
  NormalizedProduct,
  SelectionTrace,
  SourceProduct,
} from "./types";

/** Server-only: set `PRODUCT_COMPARE_DEMO_MODE=true` to run deterministic pipeline without SERP. */
export function isCompareDemoMode(): boolean {
  return process.env.PRODUCT_COMPARE_DEMO_MODE === "true";
}

const MIN_TRUSTWORTHY_COMPARABLES = 2;

function isValidComparablePrice(price: number | null | undefined): boolean {
  return price != null && Number.isFinite(price) && price > 0;
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
  fallbackTitle: string
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
    store: "unknown",
    title: fallbackTitle,
    originalPrice: null,
    currency: "USD",
    normalizedTitle: n.titleNorm,
  };
}

/**
 * Deterministic demo data — only used when `PRODUCT_COMPARE_DEMO_MODE` is true.
 * Keeps listings obviously synthetic (no fake “real” URLs).
 */
function buildDemoCandidates(
  normalizedSource: NormalizedProduct,
  searchQuery: string
): CandidateProduct[] {
  const base =
    normalizedSource.titleNorm.slice(0, 80) ||
    searchQuery.slice(0, 80) ||
    "demo wireless headphones";
  const slug = base.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const sharedNorm: NormalizedProduct = { ...normalizedSource };

  return [
    {
      store: "amazon",
      title: `${base} (Amazon demo)`,
      price: 129.99,
      currency: "USD",
      productUrl: `https://amazon.com/dp/DEMO${slug.slice(0, 6)}`,
      affiliateUrl: `https://amazon.com/dp/DEMO${slug.slice(0, 6)}`,
      normalized: { ...sharedNorm },
      sourceConfidence: 0.95,
    },
    {
      store: "walmart",
      title: `${base} (Walmart demo)`,
      price: 119.0,
      currency: "USD",
      productUrl: `https://walmart.com/ip/demo-${slug.slice(0, 8)}`,
      affiliateUrl: `https://walmart.com/ip/demo-${slug.slice(0, 8)}`,
      normalized: { ...sharedNorm },
      sourceConfidence: 0.93,
    },
  ];
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

export async function compareProduct(
  rawInput: string,
  options: CompareProductOptions = {}
): Promise<CompareProductResponse> {
  const input = rawInput.trim();
  if (!input) {
    throw new Error("Missing product input");
  }

  const debug = Boolean(options.debug);
  const demoMode = isCompareDemoMode();

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
    traceLog("source_extracted", {
      ok: Boolean(sourceProduct),
      store: detectedStore,
      title: sourceProduct?.title ?? null,
      originalPrice: sourceProduct?.originalPrice ?? null,
    });
  } else {
    traceLog("source_extracted", {
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
  });

  const providerQueries = productProviderRegistry.map((p) => ({
    store: p.id,
    query: searchQuery,
  }));
  traceLog("provider_query_used", { searchQuery, providerQueries });

  let allCandidates: CandidateProduct[] = [];
  const candidatesPerProvider: { store: string; count: number }[] = [];

  if (demoMode) {
    traceLog("demo_mode_active", {
      note: "skipping_live_serp_fetch",
    });
    allCandidates = buildDemoCandidates(normalizedSource, searchQuery);
    for (const p of productProviderRegistry) {
      const n = allCandidates.filter((c) => c.store === p.id).length;
      candidatesPerProvider.push({ store: p.id, count: n });
      traceLog("candidates_returned_per_provider", { store: p.id, count: n });
    }
  } else {
    const outcomes = await Promise.all(
      productProviderRegistry.map(async (p) => {
        const list = await p.searchCandidates({
          rawInput: input,
          searchQuery,
          sourceProduct,
        });
        return { store: p.id, list };
      })
    );

    for (const o of outcomes) {
      candidatesPerProvider.push({ store: o.store, count: o.list.length });
      traceLog("candidates_returned_per_provider", {
        store: o.store,
        count: o.list.length,
      });
      allCandidates = allCandidates.concat(o.list);
    }
  }

  const sourceUrlKey = sourceProduct?.sourceUrl
    ? normalizeUrlKey(sourceProduct.sourceUrl)
    : null;
  const sourceStore = sourceProduct?.store;
  const excludeSourceStore =
    Boolean(sourceStore && sourceStore !== "unknown");

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
    tier: import("./types").MatchTier;
    reasons: string[];
    trustworthy: boolean;
    rejected: boolean;
    rejectionDetail: string | null;
  };

  const affiliateFor = (c: CandidateProduct) =>
    productProviderRegistry.find((p) => p.id === c.store)?.toAffiliateUrl(c.productUrl) ??
    c.affiliateUrl;

  const scored: Scored[] = [];

  for (const c of deduped) {
    if (sourceUrlKey && normalizeUrlKey(c.productUrl) === sourceUrlKey) {
      candidateSteps.push({
        key: candidateKey(c, candidateSteps.length),
        store: c.store,
        title: c.title,
        price: c.price,
        productUrl: c.productUrl,
        outcome: "skipped_duplicate_source_url",
        detail: "same_canonical_url_as_source",
      });
      traceLog("candidate_rejected", {
        store: c.store,
        title: c.title.slice(0, 80),
        reason: "duplicate_source_listing",
      });
      continue;
    }

    if (excludeSourceStore && c.store === sourceStore) {
      candidateSteps.push({
        key: candidateKey(c, candidateSteps.length),
        store: c.store,
        title: c.title,
        price: c.price,
        productUrl: c.productUrl,
        outcome: "evaluated",
        detail: `skipped_cross_store_rules(same_as_source=${sourceStore})`,
      });
      traceLog("candidate_rejected", {
        store: c.store,
        title: c.title.slice(0, 80),
        reason: `cross_store_compare_excludes_source_store(${sourceStore})`,
      });
      continue;
    }

    const ev = evaluateCandidate(normalizedSource, c);
    const trustworthy =
      !ev.rejected &&
      ev.rejectionDetail == null &&
      isTrustworthyTier(ev.tier, ev.score);

    traceLog("candidate_score", {
      store: c.store,
      title: c.title.slice(0, 100),
      price: c.price,
      tier: ev.tier,
      score: ev.score,
      trustworthy,
      hardRejected: ev.rejected,
      rejectionDetail: ev.rejectionDetail,
    });

    if (ev.rejected) {
      traceLog("candidate_rejected_reason", {
        store: c.store,
        title: c.title.slice(0, 80),
        reason: ev.rejectionDetail ?? "hard_gate",
      });
    } else if (ev.rejectionDetail) {
      traceLog("candidate_rejected_reason", {
        store: c.store,
        title: c.title.slice(0, 80),
        reason: ev.rejectionDetail,
      });
    }

    scored.push({
      candidate: c,
      score: ev.score,
      tier: ev.tier,
      reasons: ev.reasons,
      trustworthy,
      rejected: ev.rejected,
      rejectionDetail: ev.rejectionDetail,
    });

    candidateSteps.push({
      key: candidateKey(c, candidateSteps.length),
      store: c.store,
      title: c.title,
      price: c.price,
      productUrl: c.productUrl,
      outcome: ev.rejected ? "rejected_hard_gate" : "evaluated",
      matchTier: ev.tier,
      matchScore: ev.score,
      matchReasons: ev.reasons,
      eligibleForComparable: trustworthy,
      detail: ev.rejected
        ? (ev.rejectionDetail ?? "hard_gate")
        : (ev.rejectionDetail ?? "passed_match_eval"),
    });
  }

  const trustworthyPool = scored.filter((s) => s.trustworthy);

  let selection: SelectionTrace = {
    trustworthyCount: trustworthyPool.length,
    pickedStore: null,
    reasonNoDeal: null,
  };

  const crossStoreOk =
    !excludeSourceStore ||
    trustworthyPool.some((s) => s.candidate.store !== sourceStore);

  let reasonNoDeal: string | null = null;
  if (trustworthyPool.length < MIN_TRUSTWORTHY_COMPARABLES) {
    reasonNoDeal = `need_at_least_${MIN_TRUSTWORTHY_COMPARABLES}_trustworthy_comparable(have=${trustworthyPool.length})`;
  } else if (!crossStoreOk) {
    reasonNoDeal =
      "cross_store_compare_requires_match_on_non_source_store";
  }

  if (reasonNoDeal) {
    selection = { ...selection, reasonNoDeal };
    traceLog("selection_final", {
      bestDeal: null,
      reason: reasonNoDeal,
      trustworthyCount: trustworthyPool.length,
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
          candidateSteps,
          selection,
        }
      : undefined;

    return {
      sourceProduct: sourceSummaryForApi(sourceProduct, searchBase),
      bestDeal: null,
      alternatives: [],
      comparisonMessage: "No comparable match found yet",
      ...(trace ? { comparisonTrace: trace } : {}),
    };
  }

  trustworthyPool.sort(
    (a, b) =>
      (a.candidate.price ?? Number.POSITIVE_INFINITY) -
      (b.candidate.price ?? Number.POSITIVE_INFINITY)
  );

  const winner = trustworthyPool[0]!;
  const rest = trustworthyPool.slice(1);

  traceLog("selection_final_best_deal", {
    bestDeal: {
      store: winner.candidate.store,
      price: winner.candidate.price,
      tier: winner.tier,
      score: winner.score,
    },
    alternatives: rest.length,
    note: "lowest_price_among_trustworthy_pool",
  });

  selection = {
    trustworthyCount: trustworthyPool.length,
    pickedStore: winner.candidate.store,
    reasonNoDeal: null,
  };

  const bestDeal = {
    store: winner.candidate.store,
    title: winner.candidate.title,
    price: winner.candidate.price,
    currency: winner.candidate.currency,
    productUrl: winner.candidate.productUrl,
    affiliateUrl: affiliateFor(winner.candidate),
    matchConfidence: Math.max(0, Math.min(1, winner.score / 100)),
    matchType: winner.tier,
  };

  const alternatives = rest.map((r) => ({
    store: r.candidate.store,
    title: r.candidate.title,
    price: r.candidate.price,
    currency: r.candidate.currency,
    productUrl: r.candidate.productUrl,
    affiliateUrl: affiliateFor(r.candidate),
    matchConfidence: Math.max(0, Math.min(1, r.score / 100)),
    matchType: r.tier,
  }));

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
        candidateSteps,
        selection,
      }
    : undefined;

  return {
    sourceProduct: sourceSummaryForApi(sourceProduct, searchBase),
    bestDeal,
    alternatives,
    comparisonMessage: null,
    ...(trace ? { comparisonTrace: trace } : {}),
  };
}

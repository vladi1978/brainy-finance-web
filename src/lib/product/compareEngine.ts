import { parseProductInput } from "./inputParse";
import { evaluateCandidate, isPrimaryComparableTier } from "./match";
import {
  areSameRetailerListings,
  buildNormalizedProduct,
  buildNormalizedSearchQuery,
  retailerListingIdentityKey,
} from "./normalize";
import { productProviderRegistry } from "./registry";
import type {
  CandidateProduct,
  CandidateStepTrace,
  CompareApiCandidate,
  CompareConfidence,
  CompareProductDeal,
  CompareProductOptions,
  CompareProductResponse,
  ComparisonTrace,
  MatchConfidenceLabel,
  NormalizedProduct,
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

const MIN_TRUSTWORTHY_COMPARABLES = 1;

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
  norm: NormalizedProduct
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
  referenceNorm: NormalizedProduct,
  searchQuery: string,
  stores: readonly StoreId[]
): CandidateProduct[] {
  const base =
    referenceNorm.titleNorm.slice(0, 80) ||
    searchQuery.slice(0, 80) ||
    "demo wireless headphones";
  const slug = base.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const sharedNorm: NormalizedProduct = { ...referenceNorm };

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

function isAmbiguousTopPrices(
  a: number | null | undefined,
  b: number | null | undefined
): boolean {
  if (!isValidComparablePrice(a) || !isValidComparablePrice(b)) return false;
  const hi = Math.max(a!, b!);
  const lo = Math.min(a!, b!);
  if (hi <= 0) return false;
  const rel = (hi - lo) / hi;
  return rel < 0.05 && hi - lo < 8;
}

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

function resolveConfidence(args: {
  pickKind: "primary" | "alternative";
  winnerLabel: MatchConfidenceLabel | "none";
  ambiguousPrice: boolean;
  chosenCount: number;
}): CompareConfidence {
  if (args.ambiguousPrice && args.chosenCount >= 2) return "low";
  if (args.winnerLabel === "exact" || args.winnerLabel === "equivalent") {
    return "high";
  }
  return "medium";
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
      bestDeal: null,
      confidence: null,
      message:
        "Could not derive a product description from that input. Paste a product name or a store link whose URL includes a readable product title.",
      sourceProduct: null,
      alternatives: [],
      savings: null,
      comparisonMessage: "Could not derive a product description from that input.",
      rejectionReasons: [],
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

  pipelineLog("source_structured", {
    structured: referenceNormalized.structured,
  });

  traceLog("normalized_reference_profile", {
    structured: referenceNormalized.structured,
    titleNorm: referenceNormalized.titleNorm,
    brand: referenceNormalized.brand,
    modelTokens: referenceNormalized.modelTokens,
    sizeInches: referenceNormalized.sizeInches,
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

  const candidateSteps: CandidateStepTrace[] = [];
  const affiliateFor = (c: CandidateProduct) =>
    productProviderRegistry.find((p) => p.id === c.store)?.toAffiliateUrl(c.productUrl) ??
    c.affiliateUrl;

  const scored: Scored[] = [];

  for (const c of deduped) {
    const candidateListingKey = retailerListingIdentityKey(c.productUrl);

    traceLog("normalized_candidate", {
      store: c.store,
      titlePreview: c.title.slice(0, 120),
      structured: c.normalized.structured,
      normalized: c.normalized,
    });

    pipelineLog("candidate_structured", {
      store: c.store,
      structured: c.normalized.structured,
    });

    if (inputUrl && areSameRetailerListings(inputUrl, c.productUrl)) {
      candidateSteps.push({
        key: candidateKey(c, candidateSteps.length),
        store: c.store,
        title: c.title,
        price: c.price,
        productUrl: c.productUrl,
        outcome: "skipped_same_source_item",
        detail: `same_listing_as_input_url(candidateId=${candidateListingKey})`,
      });
      pipelineLog("candidate_rejected", {
        store: c.store,
        title: c.title.slice(0, 80),
        reason: "same_listing_as_pasted_url",
        productUrl: c.productUrl,
      });
      continue;
    }

    const ev = evaluateCandidate(referenceNormalized, c);
    const primaryComparable =
      !ev.rejected &&
      ev.rejectionDetail == null &&
      isPrimaryComparableTier(ev.matchConfidence);
    const alternativeComparable = false;

    traceLog("candidate_match_score", {
      store: c.store,
      matchConfidence: ev.matchConfidence,
      score: ev.score,
      rejected: ev.rejected,
      rejectionDetail: ev.rejectionDetail,
    });

    pipelineLog("candidate_eval_result", {
      store: c.store,
      score: ev.score,
      rejected: ev.rejected,
      rejectionReason: ev.rejected
        ? ev.rejectionDetail
        : (ev.rejectionDetail ?? "accepted_comparable"),
      matchConfidence: ev.matchConfidence,
    });

    if (ev.rejected) {
      pipelineLog("candidate_rejected", {
        store: c.store,
        title: c.title.slice(0, 80),
        reason: ev.rejectionDetail ?? "hard_gate",
      });
    } else if (ev.rejectionDetail) {
      pipelineLog("candidate_rejected", {
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

  let chosenPool = [...primaryPool];
  let pickedAsClosestSimilar = false;
  let pickKind: "primary" | "alternative" = "primary";

  if (chosenPool.length === 0) {
    chosenPool = [...alternativePool];
    pickedAsClosestSimilar = chosenPool.length > 0;
    pickKind = "alternative";
  }

  chosenPool.sort(
    (a, b) =>
      (a.candidate.price ?? Number.POSITIVE_INFINITY) -
      (b.candidate.price ?? Number.POSITIVE_INFINITY)
  );

  const buildRejectionReasons = (): string[] => {
    const summary = `selection: primary=${primaryPool.length} alternative=${alternativePool.length} chosen=${chosenPool.length}`;
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

  const toDeal = (s: Scored): CompareProductDeal => {
    return {
      store: s.candidate.store,
      title: s.candidate.title,
      price: s.candidate.price,
      currency: s.candidate.currency,
      productUrl: s.candidate.productUrl,
      affiliateUrl: affiliateFor(s.candidate),
      imageUrl: s.candidate.imageUrl,
      matchScore: s.score,
      matchConfidence: s.matchConfidence as MatchConfidenceLabel,
      comparisonReason: s.comparisonReason,
    };
  };

  const scoredKey = (s: Scored) =>
    `${s.candidate.store}|${normalizeUrlKey(s.candidate.productUrl)}`;

  const buildApiCandidatesList = (chosenKeys: Set<string>): CompareApiCandidate[] => {
    return scored.map((s) => {
      const eligibleTier = s.primaryComparable || s.alternativeComparable;
      const k = scoredKey(s);
      return {
        store: s.candidate.store,
        title: s.candidate.title,
        price: s.candidate.price,
        currency: s.candidate.currency,
        productUrl: s.candidate.productUrl,
        affiliateUrl: affiliateFor(s.candidate),
        imageUrl: s.candidate.imageUrl,
        normalized: s.candidate.normalized,
        matchScore: s.score,
        matchConfidence: s.matchConfidence,
        includedInBestDealConsideration: eligibleTier && chosenKeys.has(k),
        rejectReason: s.rejected
          ? (s.rejectionDetail ?? "hard_gate")
          : !eligibleTier
            ? (s.rejectionDetail ?? "below_threshold")
            : null,
      };
    });
  };

  let selection: SelectionTrace = {
    trustworthyCount: chosenPool.length,
    pickedStore: null,
    reasonNoDeal: null,
    pickedAsClosestSimilar,
  };

  let reasonNoDeal: string | null = null;
  if (chosenPool.length < MIN_TRUSTWORTHY_COMPARABLES) {
    reasonNoDeal = `no_comparable_listing(primary=${primaryPool.length},alt=${alternativePool.length},chosen=${chosenPool.length})`;
  }

  const sourceProduct = queryDerivedSourceSummary(
    parsed.productQuery,
    parsed.urlStore,
    referenceNormalized
  );

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
          selection,
        }
      : undefined;

  if (reasonNoDeal) {
    selection = { ...selection, reasonNoDeal };
    pipelineLog("selection_final", {
      bestDeal: null,
      reason: reasonNoDeal,
    });
    const apiCandidates = buildApiCandidatesList(new Set());
    return {
      query: parsed.productQuery,
      normalizedQuery,
      candidates: apiCandidates,
      bestDeal: null,
      confidence: null,
      message: "No comparable match found yet",
      sourceProduct,
      alternatives: [],
      savings: null,
      comparisonMessage: "No comparable match found yet",
      rejectionReasons: buildRejectionReasons(),
      closestSimilarDealOnly: pickedAsClosestSimilar,
      ...(tracePayload() ? { comparisonTrace: tracePayload()! } : {}),
    };
  }

  const winner = chosenPool[0]!;
  const rest = chosenPool.slice(1);
  const ambiguous =
    chosenPool.length >= 2 &&
    isAmbiguousTopPrices(
      chosenPool[0]!.candidate.price,
      chosenPool[1]!.candidate.price
    );

  const confidence = resolveConfidence({
    pickKind,
    winnerLabel: winner.matchConfidence,
    ambiguousPrice: ambiguous,
    chosenCount: chosenPool.length,
  });

  const chosenKeySet = new Set(chosenPool.map(scoredKey));

  let bestDeal: CompareProductDeal | null = toDeal(winner);
  let alternatives = rest.map(toDeal);
  let message: string | null = null;
  let confidenceOut: CompareConfidence | null = confidence;

  selection = {
    trustworthyCount: chosenPool.length,
    pickedStore: bestDeal?.store ?? null,
    reasonNoDeal: null,
    pickedAsClosestSimilar,
  };

  if (ambiguous && pickKind === "primary") {
    pipelineLog("best_deal_ambiguous", {
      topPrices: chosenPool.slice(0, 3).map((s) => s.candidate.price),
    });
    bestDeal = null;
    alternatives = [];
    confidenceOut = "low";
    message =
      "Several trustworthy listings match at similar prices. Review candidates manually instead of a single best deal.";
    selection = {
      ...selection,
      pickedStore: null,
      reasonNoDeal: "ambiguous_top_prices",
    };
  } else {
    pipelineLog("selection_final_best_deal", {
      store: winner.candidate.store,
      price: winner.candidate.price,
      matchConfidence: winner.matchConfidence,
      pickKind,
      confidence: confidenceOut,
      ambiguous,
    });
  }

  const prices = chosenPool
    .map((s) => s.candidate.price)
    .filter(isValidComparablePrice) as number[];
  const savings =
    bestDeal != null && prices.length >= 2
      ? Math.max(0, Math.max(...prices) - (bestDeal.price ?? 0))
      : null;

  const apiCandidates = buildApiCandidatesList(chosenKeySet);
  const comparisonTrace = tracePayload();

  return {
    query: parsed.productQuery,
    normalizedQuery,
    candidates: apiCandidates,
    bestDeal,
    confidence: confidenceOut,
    message,
    sourceProduct,
    alternatives,
    savings,
    comparisonMessage: null,
    closestSimilarDealOnly: pickedAsClosestSimilar,
    rejectionReasons: [],
    ...(comparisonTrace ? { comparisonTrace } : {}),
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

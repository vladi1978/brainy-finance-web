import { providerRegistry } from "../registry";
import type { ExtractedSourceProduct } from "../providers/base";
import type { ProductSearchResult } from "../providers/search-result";
import type { StoreSerpDiagnostics } from "../searchParse";
import { WEAK_MATCH_MIN_SCORE } from "./constants";
import {
  compareLogInfo,
  compareLogVerbose,
  isVerboseCompareEnabled,
} from "./compareLogger";
import type {
  CandidateStepTrace,
  CompareProductResponse,
  ComparisonTrace,
  SelectionTrace,
} from "./compareTypes";
import { extractImportantQuery } from "./queryText";
import { scoreSerpRelevance } from "./rankSerp";
import { evaluateProductMatchDetailed } from "./matchClassifier";
import type { MatchType } from "./matchTypes";

export type CompareProductOptions = {
  /** When true, fills `comparisonTrace` and emits verbose `console` lines */
  debug?: boolean;
};

function isValidComparablePrice(price: number | null | undefined): boolean {
  return price != null && Number.isFinite(price) && price > 0;
}

function dedupeByStoreAndUrl(
  items: ProductSearchResult[]
): ProductSearchResult[] {
  const map = new Map<string, ProductSearchResult>();
  for (const item of items) {
    const key = `${item.store}|${item.productUrl.split("?")[0].toLowerCase()}`;
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

function normalizeUrlKey(url: string): string {
  try {
    return url.split("?")[0].toLowerCase().trim();
  } catch {
    return url.toLowerCase().trim();
  }
}

function withMatchMeta(
  r: ProductSearchResult,
  confidence: number,
  matchType: MatchType
): ProductSearchResult {
  const c = Math.max(0, Math.min(1, confidence));
  return { ...r, matchConfidence: c, matchType };
}

function candidateKey(r: ProductSearchResult, index: number): string {
  return `${r.store}:${index}:${r.productUrl.slice(-12)}`;
}

function isEligibleDeal(matchType: MatchType, score: number): boolean {
  if (matchType === "exact" || matchType === "strong") return true;
  if (matchType === "weak" && score >= WEAK_MATCH_MIN_SCORE) return true;
  return false;
}

function ineligibleExplanation(
  matchType: MatchType,
  score: number
): string {
  if (matchType === "none") {
    return `match_type_none(score=${score})`;
  }
  if (matchType === "weak" && score < WEAK_MATCH_MIN_SCORE) {
    return `weak_below_min_score(score=${score},min=${WEAK_MATCH_MIN_SCORE})`;
  }
  return `not_eligible(type=${matchType},score=${score})`;
}

export async function compareProduct(
  rawInput: string,
  options: CompareProductOptions = {}
): Promise<CompareProductResponse> {
  const verbose = isVerboseCompareEnabled(options.debug);
  const input = rawInput.trim();

  if (!input) {
    throw new Error("Missing product input");
  }

  const providerSerp: StoreSerpDiagnostics[] = [];
  const candidateSteps: CandidateStepTrace[] = [];

  const sourceProvider =
    providerRegistry.find((provider) => provider.canHandleUrl(input)) ?? null;

  let sourceProduct: ExtractedSourceProduct | null = null;
  let detectedStore: string | null = null;
  let searchBase = input;

  if (sourceProvider) {
    detectedStore = sourceProvider.store;

    if (sourceProvider.extractFromUrl) {
      sourceProduct = await sourceProvider.extractFromUrl(input);
    }

    if (sourceProduct?.title) {
      searchBase = sourceProduct.title;
    }
  }

  const searchQuery = extractImportantQuery(searchBase);

  compareLogVerbose(verbose, "search_query_resolved", {
    searchQuery,
    detectedStore,
    hadSourceProvider: Boolean(sourceProvider),
  });

  if (sourceProduct) {
    compareLogVerbose(verbose, "source_product_parsed", {
      store: sourceProduct.store,
      title: sourceProduct.title,
      originalPrice: sourceProduct.originalPrice,
      sourceUrl: sourceProduct.sourceUrl,
    });
  } else {
    compareLogVerbose(verbose, "source_product_parsed", {
      note: "no_url_extraction_used_plain_input",
      searchBase,
    });
  }

  const outcomes = await Promise.all(
    providerRegistry.map((provider) =>
      provider.searchByQuery({
        raw: input,
        normalizedQuery: searchQuery,
        sourceProduct,
      })
    )
  );

  for (const o of outcomes) {
    providerSerp.push(o.serp);
    compareLogVerbose(verbose, "provider_serp", {
      store: o.serp.store,
      url: o.serp.url,
      fetchOk: o.serp.fetchOk,
      httpStatus: o.serp.httpStatus,
      byteLength: o.serp.byteLength,
      candidateCount: o.serp.candidateCount,
      hints: o.serp.hints,
    });
  }

  const flattened = outcomes.flatMap((o) => o.results);

  const ranked = flattened
    .map((result) => ({
      result,
      score: scoreSerpRelevance(searchQuery, result),
    }))
    .filter(
      (item) =>
        item.score >= 1 ||
        item.result.store === detectedStore ||
        isValidComparablePrice(item.result.price)
    )
    .sort((a, b) => {
      const ap = a.result.price ?? Number.MAX_SAFE_INTEGER;
      const bp = b.result.price ?? Number.MAX_SAFE_INTEGER;
      if (ap !== bp) return ap - bp;
      return b.score - a.score;
    })
    .map((item) => item.result);

  for (const r of flattened) {
    const rel = scoreSerpRelevance(searchQuery, r);
    const passedRank =
      rel >= 1 ||
      r.store === detectedStore ||
      isValidComparablePrice(r.price);
    if (!passedRank) {
      candidateSteps.push({
        key: candidateKey(r, candidateSteps.length),
        store: r.store,
        title: r.title,
        price: r.price,
        productUrl: r.productUrl,
        outcome: "dropped_rank_filter",
        detail: `rank_relevance=${rel}_needs_word_overlap_or_price_or_source_store`,
      });
    }
  }

  const sourceTitle =
    sourceProduct?.title?.trim() || searchBase.trim() || input;

  const sourceUrlKey = sourceProduct?.sourceUrl
    ? normalizeUrlKey(sourceProduct.sourceUrl)
    : null;

  const sourceStore = sourceProduct?.store;
  const excludeSourceStore = Boolean(
    sourceStore && sourceStore !== "unknown"
  );

  const withPrice = ranked.filter((r) => isValidComparablePrice(r.price));
  for (const r of ranked) {
    if (!isValidComparablePrice(r.price)) {
      candidateSteps.push({
        key: candidateKey(r, candidateSteps.length),
        store: r.store,
        title: r.title,
        price: r.price,
        productUrl: r.productUrl,
        outcome: "dropped_no_price",
        detail: "parser_or_listing_missing_price",
      });
    }
  }

  const deduped = dedupeByStoreAndUrl(withPrice);

  type Scored = {
    result: ProductSearchResult;
    matchScore: number;
    matchType: MatchType;
    reasons: string[];
  };

  const scored: Scored[] = [];

  for (const r of deduped) {
    if (sourceUrlKey && normalizeUrlKey(r.productUrl) === sourceUrlKey) {
      candidateSteps.push({
        key: candidateKey(r, candidateSteps.length),
        store: r.store,
        title: r.title,
        price: r.price,
        productUrl: r.productUrl,
        outcome: "skipped_duplicate_source_url",
        detail: "same_canonical_url_as_source",
      });
      continue;
    }
    if (excludeSourceStore && r.store === sourceStore) {
      candidateSteps.push({
        key: candidateKey(r, candidateSteps.length),
        store: r.store,
        title: r.title,
        price: r.price,
        productUrl: r.productUrl,
        outcome: "skipped_same_store_as_source",
        detail: `cross_store_compare_excludes_store=${sourceStore}`,
      });
      continue;
    }

    const evald = evaluateProductMatchDetailed(
      sourceTitle,
      sourceProduct?.brand,
      r.title,
      r.brand ?? null
    );

    const eligible = isEligibleDeal(evald.matchType, evald.score);

    scored.push({
      result: r,
      matchScore: evald.score,
      matchType: evald.matchType,
      reasons: evald.reasons,
    });

    candidateSteps.push({
      key: candidateKey(r, candidateSteps.length),
      store: r.store,
      title: r.title,
      price: r.price,
      productUrl: r.productUrl,
      outcome: "evaluated",
      matchType: evald.matchType,
      matchScore: evald.score,
      matchReasons: evald.reasons,
      eligibleForBestDeal: eligible,
      detail: eligible
        ? "passed_match_gate"
        : ineligibleExplanation(evald.matchType, evald.score),
    });
  }

  const exactStrong = scored.filter(
    (x) => x.matchType === "exact" || x.matchType === "strong"
  );

  const weakPromoted = scored.filter(
    (x) =>
      x.matchType === "weak" &&
      x.matchScore >= WEAK_MATCH_MIN_SCORE
  );

  let tier: SelectionTrace["eligibleTier"] = "none";
  let pool: Scored[] = [];

  if (exactStrong.length > 0) {
    tier = "exact_or_strong";
    pool = exactStrong;
  } else if (weakPromoted.length > 0) {
    tier = "weak_promoted";
    pool = weakPromoted;
  }

  pool.sort(
    (a, b) =>
      (a.result.price ?? Number.POSITIVE_INFINITY) -
      (b.result.price ?? Number.POSITIVE_INFINITY)
  );

  let selection: SelectionTrace = {
    eligibleTier: tier,
    pickedStore: null,
    reasonNoDeal: null,
  };

  if (pool.length === 0) {
    let reasonNoDeal =
      "No comparable cross-store match: no rows passed match gates (exact/strong, or weak with sufficient score).";
    if (scored.length === 0) {
      reasonNoDeal =
        "No priced candidates to compare after deduplication and source filters.";
    } else if (exactStrong.length === 0 && weakPromoted.length === 0) {
      reasonNoDeal = `No eligible deals: weak matches require score>=${WEAK_MATCH_MIN_SCORE} or exact/strong tier.`;
    }
    selection = { ...selection, reasonNoDeal };

    compareLogVerbose(verbose, "selection_none", {
      ...selection,
      evaluatedCount: scored.length,
    });

    compareLogInfo("compare_complete", {
      ok: false,
      searchQuery,
      serpCounts: providerSerp.map((s) => ({
        store: s.store,
        n: s.candidateCount,
      })),
    });

    const trace: ComparisonTrace | undefined = options.debug
      ? buildTrace({
          input,
          detectedStore,
          searchQuery,
          sourceProduct,
          providerSerp,
          candidateSteps,
          selection,
        })
      : undefined;

    return {
      sourceProduct,
      bestDeal: null,
      alternatives: [],
      comparisonMessage: "No comparable match found yet",
      ...(trace ? { comparisonTrace: trace } : {}),
    };
  }

  const winner = pool[0]!;
  const rest = pool.slice(1);

  selection = {
    eligibleTier: tier,
    pickedStore: winner.result.store,
    reasonNoDeal: null,
  };

  compareLogVerbose(verbose, "selection_winner", {
    tier,
    store: winner.result.store,
    price: winner.result.price,
    matchType: winner.matchType,
    matchScore: winner.matchScore,
  });

  compareLogInfo("compare_complete", {
    ok: true,
    tier,
    store: winner.result.store,
    price: winner.result.price,
    alternatives: rest.length,
  });

  const bestDeal = withMatchMeta(
    winner.result,
    winner.matchScore / 100,
    winner.matchType
  );

  const alternatives = rest.map((x) =>
    withMatchMeta(x.result, x.matchScore / 100, x.matchType)
  );

  const trace: ComparisonTrace | undefined = options.debug
    ? buildTrace({
        input,
        detectedStore,
        searchQuery,
        sourceProduct,
        providerSerp,
        candidateSteps,
        selection,
      })
    : undefined;

  return {
    sourceProduct,
    bestDeal,
    alternatives,
    comparisonMessage: null,
    ...(trace ? { comparisonTrace: trace } : {}),
  };
}

function buildTrace(args: {
  input: string;
  detectedStore: string | null;
  searchQuery: string;
  sourceProduct: ExtractedSourceProduct | null;
  providerSerp: StoreSerpDiagnostics[];
  candidateSteps: CandidateStepTrace[];
  selection: SelectionTrace;
}): ComparisonTrace {
  const {
    input,
    detectedStore,
    searchQuery,
    sourceProduct,
    providerSerp,
    candidateSteps,
    selection,
  } = args;

  return {
    inputRaw: input,
    detectedStore,
    searchQueryUsed: searchQuery,
    sourceSummary: sourceProduct
      ? {
          title: sourceProduct.title,
          store: sourceProduct.store,
          originalPrice: sourceProduct.originalPrice,
          sourceUrl: sourceProduct.sourceUrl,
        }
      : null,
    providerSerp,
    candidateSteps,
    selection,
  };
}

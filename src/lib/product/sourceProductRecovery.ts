/**
 * Recover a real product title when PDP extraction fails (e.g. Amazon bot wall + bare /dp/ASIN).
 * Runs retailer SERP searches and accepts only non-ASIN-placeholder titles with cross-path consistency.
 */
import { fetchGoogleShoppingCandidatesWithDiagnostics } from "./googleShoppingSearch";
import {
  buildNormalizedProduct,
  detectStoreFromProductUrl,
  extractAmazonAsinFromUrl,
  tokenizeSignificant,
} from "./normalize";
import {
  fetchAmazonSerpWithDiagnostics,
  fetchParsedBestBuySearch,
  fetchParsedEbaySearch,
  fetchWalmartSerpWithDiagnostics,
  type ParsedSearchCandidate,
} from "./searchParse";
import {
  fetchProductPageTitleSignals,
  type ProductPageTitleSignals,
} from "./scrapeProduct";
import type { NormalizedProduct, SourceProduct, StoreId } from "./types";
import {
  extractProductQueryFromRetailUrl,
  isGenericRetailProductQuery,
  pathnameSlugShoppingFallback,
} from "./urlProductQuery";
import { isAsinPlaceholderTitle, isUsablePdpTitle } from "./usablePdpTitle";
import { isWeakSourceIdentityForCompare } from "./sourceIdentityGuard";

export type SourceRecoveryPath =
  | "asin_amazon"
  | "url_slug"
  | "retailer_search"
  | "ebay"
  | "walmart"
  | "bestbuy"
  | "page_metadata"
  | "google_shopping";

export type RecoveryTitleCandidate = {
  title: string;
  path: SourceRecoveryPath;
  weight: number;
};

export type SourceRecoveryResult = {
  title: string;
  winningPath: SourceRecoveryPath;
  pathsAgreed: SourceRecoveryPath[];
  sourceProduct: SourceProduct;
};

const RECOVERY_SERP_LIMIT = 8;
const TITLE_OVERLAP_MIN = 0.45;

const GOOGLEBOT_PDP_HEADERS: HeadersInit = {
  "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)",
  "Accept-Language": "en-US,en;q=0.9",
};

type RecoverySearchContext = {
  adapter: string;
  query: string;
  path: SourceRecoveryPath;
};

function logRecovery(event: string, payload: Record<string, unknown>): void {
  console.log(`[${event}]`, JSON.stringify(payload));
}

export function recoveryRejectionReason(title: string): string | null {
  const t = sanitizeRecoveryTitle(title);
  if (!t) return "empty_title";
  if (t.length < 8) return "title_too_short";
  if (isAsinPlaceholderTitle(t)) return "asin_placeholder";
  if (isGenericRetailProductQuery(t)) return "generic_retail_query";
  if (!isUsablePdpTitle(t)) return "not_usable_pdp_title";
  return null;
}

export function tokenOverlapRatio(a: string, b: string): number {
  const ta = new Set(tokenizeSignificant(a));
  const tb = new Set(tokenizeSignificant(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter += 1;
  }
  return inter / Math.min(ta.size, tb.size);
}

function sanitizeRecoveryTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

function isAcceptableRecoveredTitle(title: string): boolean {
  return recoveryRejectionReason(title) == null;
}

function slugFromCanonicalUrl(url: string, slugFallbackQuery?: string): string {
  const fromFallback = slugFallbackQuery?.replace(/\s+/g, " ").trim() ?? "";
  if (fromFallback && !isGenericRetailProductQuery(fromFallback)) {
    return fromFallback;
  }
  const fromExtract = extractProductQueryFromRetailUrl(url).productQuery
    .replace(/\s+/g, " ")
    .trim();
  if (fromExtract && !isGenericRetailProductQuery(fromExtract)) {
    return fromExtract;
  }
  return pathnameSlugShoppingFallback(url).replace(/\s+/g, " ").trim();
}

function recoverySearchQueries(opts: {
  asin: string | null;
  slug: string;
}): string[] {
  const out: string[] = [];
  const slug = opts.slug.trim();
  if (slug && !isGenericRetailProductQuery(slug)) out.push(slug);
  if (opts.asin) {
    out.push(`amazon ${opts.asin}`);
    out.push(opts.asin);
  }
  return [...new Set(out)];
}

function logRecoverySearchResults(
  ctx: RecoverySearchContext,
  rows: ParsedSearchCandidate[]
): void {
  logRecovery("RECOVERY_SEARCH_RESULTS", {
    adapter: ctx.adapter,
    query: ctx.query,
    path: ctx.path,
    rawCount: rows.length,
    titles: rows.slice(0, RECOVERY_SERP_LIMIT).map((row) => ({
      title: row.title.slice(0, 160),
      productUrl: row.productUrl?.slice(0, 160) ?? null,
    })),
  });
}

function auditRecoveryTitle(
  ctx: RecoverySearchContext,
  title: string,
  extra?: Record<string, unknown>
): string | null {
  const sanitized = sanitizeRecoveryTitle(title);
  const reason = recoveryRejectionReason(sanitized);
  if (reason) {
    logRecovery("RECOVERY_CANDIDATE_REJECTED", {
      adapter: ctx.adapter,
      query: ctx.query,
      path: ctx.path,
      title: sanitized.slice(0, 160),
      reason,
      ...extra,
    });
    return null;
  }
  logRecovery("RECOVERY_CANDIDATE_ACCEPTED", {
    adapter: ctx.adapter,
    query: ctx.query,
    path: ctx.path,
    title: sanitized.slice(0, 160),
    ...extra,
  });
  return sanitized;
}

function firstUsableSerpTitle(
  rows: ParsedSearchCandidate[],
  ctx: RecoverySearchContext,
  filter?: (row: ParsedSearchCandidate) => boolean
): string | null {
  logRecoverySearchResults(ctx, rows);

  for (const row of rows) {
    if (filter && !filter(row)) {
      logRecovery("RECOVERY_CANDIDATE_REJECTED", {
        adapter: ctx.adapter,
        query: ctx.query,
        path: ctx.path,
        title: sanitizeRecoveryTitle(row.title).slice(0, 160),
        reason: "url_filter_mismatch",
        productUrl: row.productUrl?.slice(0, 160) ?? null,
      });
      continue;
    }
    const accepted = auditRecoveryTitle(ctx, row.title);
    if (accepted) return accepted;
  }
  return null;
}

function titleSignalsToCandidates(
  signals: ProductPageTitleSignals
): string[] {
  return [
    signals.jsonLdProductName,
    signals.ogTitle,
    signals.twitterTitle,
    signals.documentTitle,
  ]
    .map((value) => value?.replace(/\s+/g, " ").trim() ?? "")
    .filter((value) => value.length >= 4);
}

/**
 * Pick a recovered title when paths agree or a high-confidence ASIN listing match exists.
 */
export function pickConsistentRecoveredTitle(
  candidates: RecoveryTitleCandidate[]
): {
  title: string;
  path: SourceRecoveryPath;
  pathsAgreed: SourceRecoveryPath[];
} | null {
  const valid = candidates
    .map((c) => ({ ...c, title: sanitizeRecoveryTitle(c.title) }))
    .filter((c) => isAcceptableRecoveredTitle(c.title));

  const rejected = candidates.filter(
    (c) => !isAcceptableRecoveredTitle(sanitizeRecoveryTitle(c.title))
  );
  for (const cand of rejected) {
    logRecovery("RECOVERY_CANDIDATE_REJECTED", {
      adapter: "consistency_picker",
      query: null,
      path: cand.path,
      title: sanitizeRecoveryTitle(cand.title).slice(0, 160),
      reason: recoveryRejectionReason(cand.title) ?? "not_acceptable",
    });
  }

  if (valid.length === 0) return null;

  const trustedSingletonPaths: SourceRecoveryPath[] = [
    "asin_amazon",
    "page_metadata",
    "google_shopping",
  ];
  const trustedMatches = valid
    .filter((c) => trustedSingletonPaths.includes(c.path))
    .sort((a, b) => b.weight - a.weight);
  if (trustedMatches.length > 0) {
    const best = trustedMatches[0]!;
    return { title: best.title, path: best.path, pathsAgreed: [best.path] };
  }

  type Cluster = {
    rep: RecoveryTitleCandidate;
    members: RecoveryTitleCandidate[];
    score: number;
  };
  const clusters: Cluster[] = [];

  for (const cand of valid) {
    let placed = false;
    for (const cluster of clusters) {
      if (tokenOverlapRatio(cand.title, cluster.rep.title) >= TITLE_OVERLAP_MIN) {
        cluster.members.push(cand);
        cluster.score += cand.weight;
        if (cand.weight > cluster.rep.weight) cluster.rep = cand;
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({ rep: cand, members: [cand], score: cand.weight });
    }
  }

  clusters.sort((a, b) => {
    if (b.members.length !== a.members.length) {
      return b.members.length - a.members.length;
    }
    return b.score - a.score;
  });

  const best = clusters[0];
  if (!best) return null;

  if (best.members.length >= 2) {
    const pathsAgreed = [...new Set(best.members.map((m) => m.path))];
    return {
      title: best.rep.title,
      path: best.rep.path,
      pathsAgreed,
    };
  }

  if (best.rep.path === "url_slug") {
    const norm = buildNormalizedProduct(best.rep.title);
    if (norm.category !== "general" || norm.brand || norm.modelTokens.length > 0) {
      return {
        title: best.rep.title,
        path: best.rep.path,
        pathsAgreed: [best.rep.path],
      };
    }
  }

  return null;
}

function buildRecoveredSourceProduct(opts: {
  canonicalProductUrl: string;
  title: string;
  userPrice: number | null;
  partial?: SourceProduct | null;
}): SourceProduct {
  const store = detectStoreFromProductUrl(opts.canonicalProductUrl) ?? "unknown";
  const price =
    opts.userPrice ??
    opts.partial?.originalPrice ??
    null;

  return {
    sourceUrl: opts.canonicalProductUrl,
    store,
    title: sanitizeRecoveryTitle(opts.title),
    originalPrice: price,
    currency: opts.partial?.currency ?? "USD",
    imageUrl: opts.partial?.imageUrl ?? null,
    normalized: buildNormalizedProduct(opts.title, {
      price: price ?? undefined,
      productUrl: opts.canonicalProductUrl,
    }),
    scrapedHints: opts.partial?.scrapedHints ?? null,
  };
}

async function runAmazonAsinRecovery(
  asin: string
): Promise<RecoveryTitleCandidate | null> {
  const ctx: RecoverySearchContext = {
    adapter: "amazon_serp",
    query: asin,
    path: "asin_amazon",
  };
  logRecovery("RECOVERY_SEARCH_START", { ...ctx });

  const { candidates } = await fetchAmazonSerpWithDiagnostics(
    asin,
    RECOVERY_SERP_LIMIT
  );
  const asinUpper = asin.toUpperCase();
  const title = firstUsableSerpTitle(candidates, ctx, (row) =>
    row.productUrl.toUpperCase().includes(`/DP/${asinUpper}`)
  );
  if (!title) return null;
  return { title, path: "asin_amazon", weight: 3 };
}

async function runRetailerSearchRecovery(
  store: StoreId,
  query: string
): Promise<RecoveryTitleCandidate | null> {
  const q = query.trim();
  if (!q) return null;

  const path: SourceRecoveryPath =
    store === "walmart"
      ? "walmart"
      : store === "bestbuy"
        ? "bestbuy"
        : store === "ebay"
          ? "ebay"
          : "retailer_search";

  const adapter =
    store === "amazon"
      ? "amazon_serp"
      : store === "walmart"
        ? "walmart_serp"
        : store === "bestbuy"
          ? "bestbuy_api"
          : store === "ebay"
            ? "ebay_api"
            : "retailer_search";

  const ctx: RecoverySearchContext = { adapter, query: q, path };
  logRecovery("RECOVERY_SEARCH_START", { ...ctx });

  let title: string | null = null;
  if (store === "amazon") {
    const { candidates } = await fetchAmazonSerpWithDiagnostics(
      q,
      RECOVERY_SERP_LIMIT
    );
    title = firstUsableSerpTitle(candidates, ctx);
  } else if (store === "walmart") {
    const { candidates } = await fetchWalmartSerpWithDiagnostics(
      q,
      RECOVERY_SERP_LIMIT
    );
    title = firstUsableSerpTitle(candidates, ctx);
  } else if (store === "bestbuy") {
    const candidates = await fetchParsedBestBuySearch(q, RECOVERY_SERP_LIMIT);
    title = firstUsableSerpTitle(candidates, ctx);
  } else if (store === "ebay") {
    const candidates = await fetchParsedEbaySearch(q, RECOVERY_SERP_LIMIT);
    title = firstUsableSerpTitle(candidates, ctx);
  }

  if (!title) return null;
  return { title, path, weight: 1.5 };
}

async function runCrossStoreRecovery(
  path: Extract<SourceRecoveryPath, "ebay" | "walmart" | "bestbuy">,
  query: string
): Promise<RecoveryTitleCandidate | null> {
  const q = query.trim();
  if (!q) return null;

  const adapter =
    path === "walmart"
      ? "walmart_serp"
      : path === "bestbuy"
        ? "bestbuy_api"
        : "ebay_api";
  const ctx: RecoverySearchContext = { adapter, query: q, path };
  logRecovery("RECOVERY_SEARCH_START", { ...ctx });

  let title: string | null = null;
  if (path === "walmart") {
    const { candidates } = await fetchWalmartSerpWithDiagnostics(
      q,
      RECOVERY_SERP_LIMIT
    );
    title = firstUsableSerpTitle(candidates, ctx);
  } else if (path === "bestbuy") {
    const candidates = await fetchParsedBestBuySearch(q, RECOVERY_SERP_LIMIT);
    title = firstUsableSerpTitle(candidates, ctx);
  } else {
    const candidates = await fetchParsedEbaySearch(q, RECOVERY_SERP_LIMIT);
    title = firstUsableSerpTitle(candidates, ctx);
  }

  if (!title) return null;
  return { title, path, weight: 1 };
}

async function runPageMetadataRecovery(
  canonicalProductUrl: string
): Promise<RecoveryTitleCandidate | null> {
  const ctx: RecoverySearchContext = {
    adapter: "page_metadata",
    query: canonicalProductUrl,
    path: "page_metadata",
  };
  logRecovery("RECOVERY_SEARCH_START", { ...ctx });

  const headerVariants: Array<HeadersInit | undefined> = [
    undefined,
    GOOGLEBOT_PDP_HEADERS,
  ];

  for (const headers of headerVariants) {
    const signals = await fetchProductPageTitleSignals(
      canonicalProductUrl,
      headers ? { headers } : undefined
    );
    if (!signals) continue;

    logRecovery("RECOVERY_SEARCH_RESULTS", {
      adapter: ctx.adapter,
      query: ctx.query,
      path: ctx.path,
      rawCount: titleSignalsToCandidates(signals).length,
      titles: titleSignalsToCandidates(signals).map((title) => ({
        title: title.slice(0, 160),
        productUrl: canonicalProductUrl.slice(0, 160),
      })),
      userAgentVariant: headers ? "googlebot" : "default",
    });

    for (const rawTitle of titleSignalsToCandidates(signals)) {
      const accepted = auditRecoveryTitle(ctx, rawTitle, {
        userAgentVariant: headers ? "googlebot" : "default",
      });
      if (accepted) {
        return { title: accepted, path: "page_metadata", weight: 2.5 };
      }
    }
  }

  return null;
}

async function runGoogleShoppingRecovery(
  query: string,
  asin: string | null
): Promise<RecoveryTitleCandidate | null> {
  const q = query.trim();
  if (!q) return null;

  const ctx: RecoverySearchContext = {
    adapter: "google_shopping",
    query: q,
    path: "google_shopping",
  };
  logRecovery("RECOVERY_SEARCH_START", { ...ctx });

  const { candidates, diagnostics } =
    await fetchGoogleShoppingCandidatesWithDiagnostics(
      [q],
      { rawInput: q, searchQuery: q, productQuery: q },
      { perQueryLimit: RECOVERY_SERP_LIMIT, totalLimit: RECOVERY_SERP_LIMIT }
    );

  const parsedRows: ParsedSearchCandidate[] = candidates.map((row) => ({
    title: row.title,
    price: row.price,
    currency: row.currency,
    productUrl: row.productUrl,
  }));

  logRecovery("RECOVERY_SEARCH_RESULTS", {
    adapter: ctx.adapter,
    query: ctx.query,
    path: ctx.path,
    rawCount: parsedRows.length,
    titles: parsedRows.slice(0, RECOVERY_SERP_LIMIT).map((row) => ({
      title: row.title.slice(0, 160),
      productUrl: row.productUrl?.slice(0, 160) ?? null,
      sourceAdapter: diagnostics[0]?.hints?.[0] ?? null,
    })),
  });

  const asinUpper = asin?.toUpperCase() ?? null;
  const preferAsinMatch = asinUpper
    ? (row: ParsedSearchCandidate) => {
        const url = row.productUrl.toUpperCase();
        if (!url.includes("AMAZON")) return true;
        return url.includes(`/DP/${asinUpper}`);
      }
    : undefined;

  let title = firstUsableSerpTitle(parsedRows, ctx, preferAsinMatch);
  if (!title && preferAsinMatch) {
    title = firstUsableSerpTitle(parsedRows, {
      ...ctx,
      adapter: "google_shopping_relaxed",
    });
  }
  if (!title) return null;
  return { title, path: "google_shopping", weight: 2 };
}

export function shouldAttemptSourceRecovery(opts: {
  manualSearchableIdentity: boolean;
  demoMode: boolean;
  canonicalProductUrl?: string | null;
  scrapedOk: boolean;
  referenceProductQuery: string;
  referenceNormalized: NormalizedProduct;
  supplementalDescription?: string | null;
}): boolean {
  if (opts.manualSearchableIdentity || opts.demoMode) return false;
  if (!opts.canonicalProductUrl?.trim()) return false;

  if (
    opts.scrapedOk &&
    !isWeakSourceIdentityForCompare(
      opts.referenceProductQuery,
      opts.referenceNormalized,
      { supplementalDescription: opts.supplementalDescription }
    )
  ) {
    return false;
  }

  return isWeakSourceIdentityForCompare(
    opts.referenceProductQuery,
    opts.referenceNormalized,
    { supplementalDescription: opts.supplementalDescription }
  );
}

export async function attemptSourceProductRecovery(opts: {
  canonicalProductUrl: string;
  slugFallbackQuery?: string;
  userPrice?: number | null;
  partialSource?: SourceProduct | null;
  supplementalDescription?: string | null;
}): Promise<SourceRecoveryResult | null> {
  const canonicalProductUrl = opts.canonicalProductUrl.trim();
  const asin = extractAmazonAsinFromUrl(canonicalProductUrl);
  const slug = slugFromCanonicalUrl(
    canonicalProductUrl,
    opts.slugFallbackQuery
  );
  const sourceStore = detectStoreFromProductUrl(canonicalProductUrl);
  const searchQueries = recoverySearchQueries({ asin, slug });
  const primaryQuery = searchQueries[0] ?? asin ?? slug;

  logRecovery("RECOVERY_QUERY_BUILT", {
    url: canonicalProductUrl.slice(0, 220),
    asin,
    slugPreview: slug.slice(0, 120),
    sourceStore: sourceStore ?? "unknown",
    searchQueries,
    primaryQuery,
  });

  console.log(
    "[SOURCE_RECOVERY_START]",
    JSON.stringify({
      url: canonicalProductUrl.slice(0, 220),
      asin,
      slugPreview: slug.slice(0, 120),
      sourceStore: sourceStore ?? "unknown",
      searchQueries: searchQueries.slice(0, 4),
    })
  );

  const candidates: RecoveryTitleCandidate[] = [];

  if (slug) {
    const slugCtx: RecoverySearchContext = {
      adapter: "url_slug",
      query: slug,
      path: "url_slug",
    };
    const acceptedSlug = auditRecoveryTitle(slugCtx, slug);
    if (acceptedSlug) {
      candidates.push({ title: acceptedSlug, path: "url_slug", weight: 2 });
    }
  }

  const pathJobs: Promise<RecoveryTitleCandidate | null>[] = [];

  pathJobs.push(runPageMetadataRecovery(canonicalProductUrl));

  if (primaryQuery) {
    pathJobs.push(runGoogleShoppingRecovery(primaryQuery, asin));
  }

  if (asin) {
    pathJobs.push(runAmazonAsinRecovery(asin));
  }

  if (primaryQuery && sourceStore === "amazon") {
    pathJobs.push(runRetailerSearchRecovery("amazon", primaryQuery));
  } else if (
    primaryQuery &&
    sourceStore &&
    (sourceStore === "walmart" ||
      sourceStore === "bestbuy" ||
      sourceStore === "ebay")
  ) {
    pathJobs.push(runRetailerSearchRecovery(sourceStore, primaryQuery));
  }

  for (const q of searchQueries) {
    pathJobs.push(runCrossStoreRecovery("walmart", q));
    pathJobs.push(runCrossStoreRecovery("bestbuy", q));
    pathJobs.push(runCrossStoreRecovery("ebay", q));
  }

  const settled = await Promise.allSettled(pathJobs);
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) {
      candidates.push(result.value);
    }
  }

  const picked = pickConsistentRecoveredTitle(candidates);
  if (!picked) {
    logRecovery("RECOVERY_FINAL_SELECTION", {
      url: canonicalProductUrl.slice(0, 220),
      asin,
      selected: false,
      candidateCount: candidates.length,
      candidatePaths: candidates.map((c) => c.path),
      candidateTitles: candidates.map((c) => c.title.slice(0, 120)),
    });
    console.log(
      "[SOURCE_RECOVERY_FAILED]",
      JSON.stringify({
        url: canonicalProductUrl.slice(0, 220),
        asin,
        candidatePaths: candidates.map((c) => c.path),
        candidateCount: candidates.length,
      })
    );
    return null;
  }

  logRecovery("RECOVERY_FINAL_SELECTION", {
    url: canonicalProductUrl.slice(0, 220),
    asin,
    selected: true,
    title: picked.title.slice(0, 200),
    winningPath: picked.path,
    pathsAgreed: picked.pathsAgreed,
    candidateCount: candidates.length,
  });

  const sourceProduct = buildRecoveredSourceProduct({
    canonicalProductUrl,
    title: picked.title,
    userPrice: opts.userPrice ?? null,
    partial: opts.partialSource,
  });

  const referenceNormalized = sourceProduct.normalized;

  if (
    isWeakSourceIdentityForCompare(picked.title, referenceNormalized, {
      supplementalDescription: opts.supplementalDescription,
    })
  ) {
    logRecovery("RECOVERY_FINAL_SELECTION", {
      url: canonicalProductUrl.slice(0, 220),
      asin,
      selected: false,
      reason: "recovered_title_still_weak",
      titlePreview: picked.title.slice(0, 120),
    });
    console.log(
      "[SOURCE_RECOVERY_FAILED]",
      JSON.stringify({
        url: canonicalProductUrl.slice(0, 220),
        reason: "recovered_title_still_weak",
        titlePreview: picked.title.slice(0, 120),
      })
    );
    return null;
  }

  console.log(
    "[SOURCE_RECOVERY_SUCCESS]",
    JSON.stringify({
      url: canonicalProductUrl.slice(0, 220),
      title: picked.title.slice(0, 200),
      winningPath: picked.path,
      pathsAgreed: picked.pathsAgreed,
      category: referenceNormalized.category,
      brand: referenceNormalized.brand,
    })
  );

  return {
    title: picked.title,
    winningPath: picked.path,
    pathsAgreed: picked.pathsAgreed,
    sourceProduct: {
      ...sourceProduct,
      normalized: referenceNormalized,
    },
  };
}

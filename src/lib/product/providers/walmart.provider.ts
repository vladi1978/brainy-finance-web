import {
  scrapeProduct,
  composeRetailShoppingTitleFromPdp,
  logRetailPdpShoppingIdentity,
  toSourceScrapedHints,
} from "../scrapeProduct";
import { finalizedSlugShoppingLine } from "../urlProductQuery";
import { fetchWalmartSerpWithDiagnostics } from "../searchParse";
import { buildNormalizedProduct, normalizeTitle } from "../normalize";
import { isValidProductDetailUrl } from "../productDetailUrl";
import type {
  CandidateProduct,
  ProductProvider,
  ProviderResult,
  ProviderSearchContext,
  ProviderSearchDiagnostics,
  SourceProduct,
  StoreId,
} from "../types";

const STORE: StoreId = "walmart";

/** TEMP: set `PRODUCT_SERP_DEBUG=1` to log provider second-pass PDP filter (remove when done). */
function providerSerpDebug(payload: Record<string, unknown>): void {
  if (process.env.PRODUCT_SERP_DEBUG !== "1") return;
  console.log("[product-serp-debug]", payload);
}

function toDiagnostics(
  query: string,
  d: import("../searchParse").StoreSerpDiagnostics
): ProviderSearchDiagnostics {
  return {
    store: d.store,
    query,
    fetchOk: d.fetchOk,
    httpStatus: d.httpStatus,
    byteLength: d.byteLength,
    candidateCount: d.candidateCount,
    hints: d.hints,
  };
}

function rankRowsByQueryRelevance<
  T extends { title: string },
>(rows: T[], searchQuery: string): T[] {
  const q = normalizeTitle(searchQuery)
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  if (q.length === 0) return rows;
  const scored = rows.map((row) => {
    const t = normalizeTitle(row.title);
    let hits = 0;
    for (const w of q) {
      if (t.includes(w)) hits += 1;
    }
    return { row, hits };
  });
  scored.sort((a, b) => b.hits - a.hits);
  return scored.map((s) => s.row);
}

/** SERP titles are normalized for matching; TVs get strict `normalized.tv` signals from `buildNormalizedProduct`. */
function rowToCandidate(
  row: { title: string; price: number | null; currency: string; productUrl: string },
  searchQuery: string
): CandidateProduct {
  const normalized = buildNormalizedProduct(row.title, {
    price: row.price,
    currency: row.currency,
    productUrl: row.productUrl,
  });
  const qWords = normalizeTitle(searchQuery).split(/\s+/).filter((w) => w.length >= 3);
  let matchWords = 0;
  for (const w of qWords) {
    if (normalized.titleNorm.includes(w)) matchWords += 1;
  }
  const sourceConfidence =
    qWords.length > 0
      ? Math.min(0.98, 0.45 + (matchWords / qWords.length) * 0.5)
      : 0.65;

  return {
    store: STORE,
    title: row.title,
    price: row.price,
    currency: row.currency,
    productUrl: row.productUrl,
    affiliateUrl: row.productUrl,
    imageUrl: null,
    normalized,
    sourceConfidence,
  };
}

export const walmartProvider: ProductProvider = {
  id: STORE,

  canHandleProductUrl(url: string): boolean {
    return /walmart\.com/i.test(url);
  },

  async extractSourceProduct(url: string): Promise<SourceProduct | null> {
    const scraped = await scrapeProduct(url);
    const slugLine = finalizedSlugShoppingLine(url);
    const { primaryTitle, primarySource } = composeRetailShoppingTitleFromPdp({
      scraped,
      slugDerivedQueryLine: slugLine,
    });

    const title = primaryTitle.trim();
    if (!title) return null;

    logRetailPdpShoppingIdentity({
      store: STORE,
      title,
      brand: scraped?.brand?.trim() || null,
      model: scraped?.model?.trim() || scraped?.sku?.trim() || null,
      fallbackUsed: primarySource === "slug_path",
    });

    return {
      sourceUrl: url,
      store: STORE,
      title,
      originalPrice: scraped?.price ?? null,
      currency: scraped?.currency ?? "USD",
      normalized: buildNormalizedProduct(title, {
        price: scraped?.price ?? null,
        currency: scraped?.currency ?? null,
        productUrl: url,
      }),
      scrapedHints: toSourceScrapedHints(scraped) ?? null,
    };
  },

  async searchCandidates(ctx: ProviderSearchContext): Promise<ProviderResult> {
    /** Prefer compact normalized query so SERP matches real product type, not URL slug noise. */
    const effectiveQuery =
      ctx.searchQuery?.trim() ||
      normalizeTitle(ctx.productQuery || "") ||
      ctx.rawInput;
    const { candidates, diagnostics } = await fetchWalmartSerpWithDiagnostics(
      effectiveQuery,
      24
    );
    const ranked = rankRowsByQueryRelevance(candidates, effectiveQuery);

    const secondPassInvalid = ranked.filter(
      (c) => !isValidProductDetailUrl("walmart", c.productUrl)
    );
    providerSerpDebug({
      store: STORE,
      phase: "provider_search_second_pdp",
      fromParseCount: ranked.length,
      secondPassRejectedCount: secondPassInvalid.length,
      first3BeforeSecondPdp: ranked.slice(0, 3).map((c) => ({
        title: c.title.slice(0, 120),
        productUrl: c.productUrl,
        pdpValid: isValidProductDetailUrl("walmart", c.productUrl),
      })),
      sampleSecondPassRejectedUrls: secondPassInvalid
        .slice(0, 3)
        .map((c) => c.productUrl),
    });

    return {
      candidates: ranked
        .filter((c) => isValidProductDetailUrl("walmart", c.productUrl))
        .map((c) => rowToCandidate(c, effectiveQuery)),
      diagnostics: toDiagnostics(effectiveQuery, diagnostics),
    };
  },

  toAffiliateUrl(productUrl: string): string {
    return productUrl;
  },
};

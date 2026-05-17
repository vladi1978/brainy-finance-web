import {
  scrapeProduct,
  composeRetailShoppingTitleFromPdp,
  logRetailPdpShoppingIdentity,
} from "../scrapeProduct";
import { finalizedSlugShoppingLine } from "../urlProductQuery";
import { fetchTemuSerpWithDiagnostics } from "../searchParse";
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

const STORE: StoreId = "temu";

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

export const temuProvider: ProductProvider = {
  id: STORE,

  canHandleProductUrl(url: string): boolean {
    return /temu\.com/i.test(url);
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
    };
  },

  async searchCandidates(ctx: ProviderSearchContext): Promise<ProviderResult> {
    const effectiveQuery =
      ctx.searchQuery?.trim() ||
      normalizeTitle(ctx.productQuery || "") ||
      ctx.rawInput;
    const { candidates, diagnostics } = await fetchTemuSerpWithDiagnostics(
      effectiveQuery,
      12
    );

    return {
      candidates: candidates
        .filter((c) => isValidProductDetailUrl("temu", c.productUrl))
        .map((c) => rowToCandidate(c, effectiveQuery)),
      diagnostics: toDiagnostics(effectiveQuery, diagnostics),
    };
  },

  toAffiliateUrl(productUrl: string): string {
    return productUrl;
  },
};

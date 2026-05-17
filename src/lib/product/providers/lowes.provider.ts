import {
  composeRetailShoppingTitleFromPdp,
  logRetailPdpShoppingIdentity,
  scrapeProduct,
} from "../scrapeProduct";
import { buildNormalizedProduct, normalizeTitle } from "../normalize";
import type {
  ProductProvider,
  ProviderResult,
  ProviderSearchContext,
  ProviderSearchDiagnostics,
  SourceProduct,
  StoreId,
} from "../types";
import { finalizedSlugShoppingLine } from "../urlProductQuery";

const STORE: StoreId = "lowes";

function emptyRetailSerpDiagnostics(
  query: string
): ProviderSearchDiagnostics {
  return {
    store: STORE,
    query,
    fetchOk: false,
    httpStatus: null,
    byteLength: 0,
    candidateCount: 0,
    hints: ["retailer_compare_uses_google_shopping_pipeline"],
  };
}

export const lowesProvider: ProductProvider = {
  id: STORE,

  canHandleProductUrl(url: string): boolean {
    return /lowes\.com/i.test(url);
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
    return {
      candidates: [],
      diagnostics: emptyRetailSerpDiagnostics(effectiveQuery),
    };
  },

  toAffiliateUrl(productUrl: string): string {
    return productUrl;
  },
};

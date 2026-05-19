import {
  composeRetailShoppingTitleFromPdp,
  logRetailPdpShoppingIdentity,
  scrapeProduct,
  toSourceScrapedHints,
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

function emptyRetailSerpDiagnostics(
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
    hints: ["retailer_compare_uses_google_shopping_pipeline"],
  };
}

export function createBasicRetailProvider(config: {
  id: StoreId;
  hostPattern: RegExp;
}): ProductProvider {
  const { id, hostPattern } = config;

  return {
    id,

    canHandleProductUrl(url: string): boolean {
      return hostPattern.test(url);
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
        store: id,
        title,
        brand: scraped?.brand?.trim() || null,
        model: scraped?.model?.trim() || scraped?.sku?.trim() || null,
        fallbackUsed: primarySource === "slug_path",
      });

      return {
        sourceUrl: url,
        store: id,
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

    /** @deprecated Unused by live compare — Google Shopping handles discovery. See `../LEGACY.md`. */
    async searchCandidates(ctx: ProviderSearchContext): Promise<ProviderResult> {
      const effectiveQuery =
        ctx.searchQuery?.trim() ||
        normalizeTitle(ctx.productQuery || "") ||
        ctx.rawInput;
      return {
        candidates: [],
        diagnostics: emptyRetailSerpDiagnostics(id, effectiveQuery),
      };
    },

    toAffiliateUrl(productUrl: string): string {
      return productUrl;
    },
  };
}

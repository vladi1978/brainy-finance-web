import { scrapeProduct } from "../scrapeProduct";
import { fetchWalmartSerpWithDiagnostics } from "../searchParse";
import { buildNormalizedProduct, normalizeTitle } from "../normalize";
import type { CandidateProduct, ProviderSearchContext, SourceProduct, StoreId } from "../types";

const STORE: StoreId = "walmart";

function cleanWalmartTitleFromUrl(input: string): string {
  return input
    .replace(/^https?:\/\/(www\.)?walmart\.com\/ip\//i, "")
    .replace(/\?.*$/, "")
    .replace(/-/g, " ")
    .replace(/\bip\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rowToCandidate(
  row: { title: string; price: number | null; currency: string; productUrl: string },
  searchQuery: string
): CandidateProduct {
  const normalized = buildNormalizedProduct(row.title);
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
    normalized,
    sourceConfidence,
  };
}

export const walmartProvider = {
  id: STORE,

  canHandleProductUrl(url: string): boolean {
    return /walmart\.com/i.test(url);
  },

  async extractSourceProduct(url: string): Promise<SourceProduct | null> {
    const scraped = await scrapeProduct(url);
    const title =
      scraped?.productName?.trim() || cleanWalmartTitleFromUrl(url);
    if (!title) return null;

    return {
      sourceUrl: url,
      store: STORE,
      title,
      originalPrice: scraped?.price ?? null,
      currency: scraped?.currency ?? "USD",
      normalized: buildNormalizedProduct(title),
    };
  },

  async searchCandidates(ctx: ProviderSearchContext): Promise<CandidateProduct[]> {
    const query =
      ctx.sourceProduct?.title || ctx.searchQuery || ctx.rawInput;
    const normalizedQuery = normalizeTitle(query);
    const { candidates } = await fetchWalmartSerpWithDiagnostics(query, 12);

    return candidates.map((c) => rowToCandidate(c, ctx.searchQuery || normalizedQuery));
  },

  toAffiliateUrl(productUrl: string): string {
    return productUrl;
  },
};

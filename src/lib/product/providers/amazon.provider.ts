import { scrapeProduct } from "../scrapeProduct";
import { fetchAmazonSerpWithDiagnostics } from "../searchParse";
import { buildNormalizedProduct, normalizeTitle } from "../normalize";
import type { CandidateProduct, ProviderSearchContext, SourceProduct, StoreId } from "../types";

const STORE: StoreId = "amazon";

function titleFromAmazonUrl(input: string): string {
  const m = input.match(/amazon\.[^/]+\/([^/]+)\/dp\/[A-Z0-9]{9,14}/i);
  if (m?.[1] && !/^dp$/i.test(m[1])) {
    try {
      return decodeURIComponent(m[1]).replace(/-/g, " ").trim();
    } catch {
      return m[1].replace(/-/g, " ").trim();
    }
  }
  return "";
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

export const amazonProvider = {
  id: STORE,

  canHandleProductUrl(url: string): boolean {
    return /amazon\.com|a\.co/i.test(url);
  },

  async extractSourceProduct(url: string): Promise<SourceProduct | null> {
    const scraped = await scrapeProduct(url);
    const urlTitle = titleFromAmazonUrl(url);
    const title = scraped?.productName?.trim() || urlTitle;
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
    const { candidates } = await fetchAmazonSerpWithDiagnostics(query, 12);

    return candidates.map((c) => rowToCandidate(c, ctx.searchQuery || normalizedQuery));
  },

  toAffiliateUrl(productUrl: string): string {
    return productUrl;
  },
};

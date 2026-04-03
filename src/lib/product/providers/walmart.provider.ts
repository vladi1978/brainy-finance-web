import {
  ProductProvider,
  ProviderSearchInput,
  ExtractedSourceProduct,
} from "./base";
import { ProductSearchResult } from "./search-result";
import { scrapeProduct } from "../scrapeProduct";
import { fetchWalmartSerpWithDiagnostics } from "../searchParse";

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanWalmartTitleFromUrl(input: string): string {
  return input
    .replace(/^https?:\/\/(www\.)?walmart\.com\/ip\//i, "")
    .replace(/\?.*$/, "")
    .replace(/-/g, " ")
    .replace(/\bip\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function candidateToSearchResult(
  c: {
    title: string;
    price: number | null;
    currency: string;
    productUrl: string;
  },
  normalizedQuery: string
): ProductSearchResult {
  const normalizedTitle = normalizeText(c.title);
  const qWords = normalizedQuery.split(/\s+/).filter((w) => w.length >= 3);
  let matchWords = 0;
  for (const w of qWords) {
    if (normalizedTitle.includes(w)) matchWords += 1;
  }
  const matchConfidence =
    qWords.length > 0
      ? Math.min(0.98, 0.45 + (matchWords / qWords.length) * 0.5)
      : 0.65;

  return {
    store: "walmart",
    title: c.title,
    normalizedTitle,
    price: c.price,
    currency: c.currency,
    productUrl: c.productUrl,
    affiliateUrl: c.productUrl,
    image: null,
    inStock: c.price != null,
    sku: null,
    brand: null,
    model: null,
    upc: null,
    sourceConfidence: c.price != null ? 0.88 : 0.45,
    matchConfidence,
  };
}

export const walmartProvider: ProductProvider = {
  store: "walmart",

  canHandleUrl(url: string): boolean {
    return /walmart\.com/i.test(url);
  },

  async extractFromUrl(url: string): Promise<ExtractedSourceProduct | null> {
    const scraped = await scrapeProduct(url);
    const title =
      scraped?.productName?.trim() || cleanWalmartTitleFromUrl(url);
    if (!title) {
      return null;
    }
    const originalPrice = scraped?.price ?? null;
    const currency = scraped?.currency ?? "USD";

    return {
      sourceUrl: url,
      store: "walmart",
      title,
      normalizedTitle: normalizeText(title),
      originalPrice,
      currency,
      image: null,
      sku: null,
      brand: null,
      model: null,
      upc: null,
    };
  },

  async searchByQuery(input: ProviderSearchInput) {
    const query =
      input.sourceProduct?.title ||
      input.normalizedQuery ||
      input.raw;

    const normalizedQuery = normalizeText(query);
    const { candidates, diagnostics } = await fetchWalmartSerpWithDiagnostics(
      query,
      12
    );

    const results: ProductSearchResult[] = candidates.map((c) =>
      candidateToSearchResult(c, input.normalizedQuery || normalizedQuery)
    );

    return { results, serp: diagnostics };
  },

  buildAffiliateUrl(productUrl: string): string {
    return productUrl;
  },
};

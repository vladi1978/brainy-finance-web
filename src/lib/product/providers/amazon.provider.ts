import {
  ProductProvider,
  ProviderSearchInput,
  ExtractedSourceProduct,
} from "./base";
import { ProductSearchResult } from "./search-result";
import { scrapeProduct } from "../scrapeProduct";
import { fetchParsedAmazonSearch } from "../searchParse";

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
    store: "amazon",
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
    sourceConfidence: c.price != null ? 0.9 : 0.5,
    matchConfidence,
  };
}

export const amazonProvider: ProductProvider = {
  store: "amazon",

  canHandleUrl(url: string): boolean {
    return /amazon\.com|a\.co/i.test(url);
  },

  async extractFromUrl(url: string): Promise<ExtractedSourceProduct | null> {
    const scraped = await scrapeProduct(url);
    const urlTitle = titleFromAmazonUrl(url);
    const title = scraped?.productName?.trim() || urlTitle;
    if (!title) {
      return null;
    }
    const originalPrice = scraped?.price ?? null;
    const currency = scraped?.currency ?? "USD";

    return {
      sourceUrl: url,
      store: "amazon",
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

  async searchByQuery(
    input: ProviderSearchInput
  ): Promise<ProductSearchResult[]> {
    const query =
      input.sourceProduct?.title ||
      input.normalizedQuery ||
      input.raw;

    const normalizedQuery = normalizeText(query);
    const candidates = await fetchParsedAmazonSearch(query, 12);

    if (candidates.length === 0) {
      return [];
    }

    return candidates.map((c) =>
      candidateToSearchResult(c, input.normalizedQuery || normalizedQuery)
    );
  },

  buildAffiliateUrl(productUrl: string): string {
    return productUrl;
  },
};

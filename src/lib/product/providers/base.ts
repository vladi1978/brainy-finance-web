import type { StoreSerpDiagnostics } from "../searchParse";
import { StoreName, ProductSearchResult } from "./search-result";

export type ExtractedSourceProduct = {
  sourceUrl: string;
  store: StoreName | "unknown";
  title: string;
  normalizedTitle: string;
  originalPrice: number | null;
  currency: string;
  image?: string | null;
  sku?: string | null;
  brand?: string | null;
  model?: string | null;
  upc?: string | null;
};

export type ProviderSearchInput = {
  raw: string;
  normalizedQuery: string;
  sourceProduct?: ExtractedSourceProduct | null;
};

/** One retailer search execution: parsed rows + fetch/parse diagnostics. */
export type ProviderSearchOutcome = {
  results: ProductSearchResult[];
  serp: StoreSerpDiagnostics;
};

export interface ProductProvider {
  store: StoreName;

  canHandleUrl(url: string): boolean;

  extractFromUrl?(url: string): Promise<ExtractedSourceProduct | null>;

  searchByQuery(input: ProviderSearchInput): Promise<ProviderSearchOutcome>;

  buildAffiliateUrl?(productUrl: string): string;
}
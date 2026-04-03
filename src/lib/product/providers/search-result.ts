export type StoreName = "amazon" | "walmart" | "target" | "temu";

export type ProductSearchResult = {
  store: StoreName;
  title: string;
  normalizedTitle: string;
  price: number | null;
  currency: string;
  /** Canonical product link; demo responses may use demo:// URLs */
  productUrl: string;
  affiliateUrl: string;
  /** Optional display/source URL (e.g. demo://) when distinct from productUrl */
  sourceUrl?: string | null;
  image?: string | null;
  inStock?: boolean;
  sku?: string | null;
  brand?: string | null;
  model?: string | null;
  upc?: string | null;
  sourceConfidence: number;
  matchConfidence: number;
};
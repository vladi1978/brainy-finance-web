export type SupportedStore =
  | "amazon"
  | "walmart"
  | "target"
  | "temu"
  | "generic"
  | "unknown";

export type InputKind = "url" | "name" | "description";

export type ProductInput = {
  raw: string;
  normalized: string;
  kind: InputKind;
  store: SupportedStore;
};

export type ExtractedProduct = {
  title: string;
  store: SupportedStore;
  sourceUrl?: string;
  originalPrice?: number | null;
  currency?: string;
  image?: string | null;
  confidence?: number;
};

export type StorePriceResult = {
  store: SupportedStore;
  title: string;
  price: number | null;
  productUrl?: string;
  affiliateUrl?: string;
  inStock?: boolean;
  image?: string | null;
  matchConfidence?: number;
};

export type ComparisonResult = {
  query: string;
  detectedStore: SupportedStore;
  extractedProduct: ExtractedProduct | null;
  prices: StorePriceResult[];
  bestDeal: StorePriceResult | null;
  savingsVsOriginal: number | null;
};
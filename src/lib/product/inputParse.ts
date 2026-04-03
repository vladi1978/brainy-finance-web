import { extractProductQueryFromRetailUrl } from "./urlProductQuery";
import type { StoreId } from "./types";

export type ParsedProductInput = {
  /** Raw user input */
  rawInput: string;
  /** Clean product description used for normalization and display */
  productQuery: string;
  /** Pasted product URL when applicable */
  inputUrl?: string;
  /** Retailer inferred from URL path */
  urlStore: StoreId | null;
};

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/**
 * Parse pasted text or URL into a product query string.
 * URLs never imply a scraped "source product" — only text for search.
 */
export function parseProductInput(raw: string): ParsedProductInput {
  const rawInput = raw.trim();
  if (!rawInput) {
    return { rawInput, productQuery: "", urlStore: null };
  }

  if (!isHttpUrl(rawInput)) {
    return {
      rawInput,
      productQuery: rawInput,
      urlStore: null,
    };
  }

  const inputUrl = rawInput.split("#")[0]?.trim() ?? rawInput;
  const { productQuery, store } = extractProductQueryFromRetailUrl(inputUrl);
  const cleaned = productQuery.replace(/\s+/g, " ").trim();
  const fallback =
    cleaned.length >= 3
      ? cleaned
      : inputUrl.replace(/^https?:\/\/[^/]+\//i, "").replace(/[/?#].*$/, "").replace(/-/g, " ").trim();

  return {
    rawInput,
    productQuery: fallback.length >= 3 ? fallback : cleaned,
    inputUrl,
    urlStore: store,
  };
}

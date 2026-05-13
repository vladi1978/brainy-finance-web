import { extractProductQueryFromRetailUrl } from "./urlProductQuery";
import type { StoreId } from "./types";

export type ParsedProductInput = {
  /** Raw user input */
  rawInput: string;
  /** Pasted product URL when the input was an HTTP(S) link */
  inputUrl?: string;
  /** Retailer inferred from URL host/path when recognized (slug heuristic) */
  detectedStore: StoreId | null;
  /**
   * Query text derived from URL slug/path or full pasted text.
   * Used when PDP extraction is unavailable or fails.
   */
  productQuery: string;
};

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/**
 * Parse pasted text or URL: exposes raw input, optional URL, detected retailer
 * (when recognizable), and a fallback query string for search/normalization.
 */
export function parseProductInput(raw: string): ParsedProductInput {
  const rawInput = raw.trim();
  if (!rawInput) {
    return { rawInput, productQuery: "", detectedStore: null };
  }

  if (!isHttpUrl(rawInput)) {
    return {
      rawInput,
      productQuery: rawInput,
      detectedStore: null,
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
    inputUrl,
    detectedStore: store,
    productQuery: fallback.length >= 3 ? fallback : cleaned,
  };
}

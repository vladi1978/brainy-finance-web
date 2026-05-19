import {
  expandKnownShortRetailUrl,
  extractProductQueryFromRetailUrl,
  isGenericRetailProductQuery,
  pathnameSlugShoppingFallback,
} from "./urlProductQuery";
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
 *
 * Known short URLs (allowlisted hosts) are expanded via HEAD/redirect follow
 * before URL-derived query extraction; on failure the original paste is kept.
 */
export async function parseProductInput(
  raw: string
): Promise<ParsedProductInput> {
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

  const hashIdx = rawInput.indexOf("#");
  const headPart = hashIdx >= 0 ? rawInput.slice(0, hashIdx) : rawInput;
  const fragment = hashIdx >= 0 ? rawInput.slice(hashIdx) : "";

  const expandedHref = await expandKnownShortRetailUrl(headPart.trim());
  const rebuiltBase =
    expandedHref != null
      ? (expandedHref.split("#")[0]?.trim() ?? expandedHref.trim())
      : headPart.trim();
  const reconstructed = `${rebuiltBase}${fragment}`;

  const inputUrl = reconstructed.split("#")[0]?.trim() ?? reconstructed;

  const extracted = extractProductQueryFromRetailUrl(inputUrl);
  let productQuery = extracted.productQuery;
  const store = extracted.store;
  productQuery = productQuery.replace(/\s+/g, " ").trim();

  if (!productQuery || isGenericRetailProductQuery(productQuery)) {
    productQuery = pathnameSlugShoppingFallback(inputUrl)
      .replace(/\s+/g, " ")
      .trim();
  }

  return {
    rawInput: reconstructed,
    inputUrl,
    detectedStore: store,
    productQuery: isGenericRetailProductQuery(productQuery) ? "" : productQuery,
  };
}

import { resolveCanonicalInputUrl } from "./canonicalInputUrl";
import {
  extractProductQueryFromRetailUrl,
  isGenericRetailProductQuery,
  pathnameSlugShoppingFallback,
} from "./urlProductQuery";
import type { StoreId } from "./types";

export type ParsedProductInput = {
  /** Raw user paste (unchanged text or URL string). */
  rawInput: string;
  /** HTTP(S) paste before redirect resolution. */
  originalInputUrl?: string;
  /** Final URL after redirect follow, when it changed from the paste. */
  resolvedFinalUrl?: string | null;
  /**
   * Canonical retailer URL for scrape, compare, and outbound listing.
   * Alias: {@link inputUrl}.
   */
  canonicalProductUrl?: string;
  /** @deprecated Prefer {@link canonicalProductUrl}. */
  inputUrl?: string;
  /** Retailer inferred from canonical URL host/path when recognized. */
  detectedStore: StoreId | null;
  /**
   * Query text derived from canonical URL slug/path or full pasted text.
   * Used when PDP extraction is unavailable or fails.
   */
  productQuery: string;
};

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/**
 * Parse pasted text or URL: canonicalizes HTTP(S) links (redirect resolve + unwrap),
 * then derives retailer hint and fallback query from the canonical URL.
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

  const canonical = await resolveCanonicalInputUrl(headPart.trim());
  const canonicalProductUrl = canonical.canonicalProductUrl;
  const reconstructed = `${canonicalProductUrl}${fragment}`;

  const extracted = extractProductQueryFromRetailUrl(canonicalProductUrl);
  let productQuery = extracted.productQuery;
  const store = extracted.store;
  productQuery = productQuery.replace(/\s+/g, " ").trim();

  if (!productQuery || isGenericRetailProductQuery(productQuery)) {
    productQuery = pathnameSlugShoppingFallback(canonicalProductUrl)
      .replace(/\s+/g, " ")
      .trim();
  }

  return {
    rawInput,
    originalInputUrl: canonical.originalInputUrl,
    resolvedFinalUrl: canonical.resolvedFinalUrl,
    canonicalProductUrl,
    inputUrl: canonicalProductUrl,
    detectedStore: store,
    productQuery: isGenericRetailProductQuery(productQuery) ? "" : productQuery,
  };
}

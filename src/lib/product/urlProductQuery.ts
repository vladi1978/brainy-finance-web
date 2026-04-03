import type { StoreId } from "./types";

/**
 * Derive a human-readable product query from retailer URLs without scraping.
 * Used for search-first comparison (URL is not a trusted "source product").
 */

export function productQueryFromAmazonUrl(input: string): string {
  const m = input.match(/amazon\.[^/]+\/([^/]+)\/dp\/[A-Z0-9]{9,14}/i);
  if (m?.[1] && !/^dp$/i.test(m[1])) {
    try {
      return decodeURIComponent(m[1]).replace(/-/g, " ").trim();
    } catch {
      return m[1].replace(/-/g, " ").trim();
    }
  }
  const short = input.match(/\/dp\/([A-Z0-9]{10})/i);
  if (short) {
    return "";
  }
  return "";
}

export function productQueryFromWalmartUrl(input: string): string {
  return input
    .replace(/^https?:\/\/(www\.)?walmart\.com\/ip\//i, "")
    .replace(/\?.*$/, "")
    .replace(/\/\d{6,}\s*$/i, "")
    .replace(/-/g, " ")
    .replace(/\bip\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function productQueryFromTargetUrl(input: string): string {
  if (!/target\.com\/p\//i.test(input)) return "";
  return input
    .replace(/^https?:\/\/[^/]+\/p\//i, "")
    .replace(/\/-\/A-\d+.*$/i, "")
    .replace(/-/g, " ")
    .trim();
}

export function productQueryFromTemuUrl(input: string): string {
  try {
    const u = new URL(input);
    const seg = u.pathname.split("/").filter(Boolean);
    const last = seg[seg.length - 1];
    if (last && /\.html$/i.test(last)) {
      return decodeURIComponent(last.replace(/\.html$/i, "")).replace(/-/g, " ").trim();
    }
  } catch {
    /* ignore */
  }
  return "";
}

function detectUrlStore(raw: string): StoreId | null {
  const t = raw.trim();
  if (!/^https?:\/\//i.test(t)) return null;
  if (/\bamazon\.[a-z.]{2,}\b|\/\/a\.co\/|\/\/amzn\.to\//i.test(t)) return "amazon";
  if (/walmart\.com/i.test(t)) return "walmart";
  if (/target\.com/i.test(t)) return "target";
  if (/temu\.com/i.test(t)) return "temu";
  return null;
}

export type UrlDerivedQuery = {
  productQuery: string;
  store: StoreId | null;
};

/**
 * Best-effort product description string from a product page URL (slug/title segment only).
 */
export function extractProductQueryFromRetailUrl(url: string): UrlDerivedQuery {
  const store = detectUrlStore(url);
  let productQuery = "";
  if (store === "amazon") productQuery = productQueryFromAmazonUrl(url);
  else if (store === "walmart") productQuery = productQueryFromWalmartUrl(url);
  else if (store === "target") productQuery = productQueryFromTargetUrl(url);
  else if (store === "temu") productQuery = productQueryFromTemuUrl(url);

  return { productQuery, store };
}

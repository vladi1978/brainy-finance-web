import type { StoreId } from "../types";
import { detectStoreFromProductUrl } from "../normalize";

/**
 * Retailers where server-side HTML PDP scrape is disabled (bot walls).
 * Compare uses URL slug / shopping discovery instead — never bypasses bot protection.
 */
const SERVER_SCRAPE_BLOCKED: ReadonlySet<StoreId> = new Set([
  "amazon",
  "walmart",
  "target",
  "wayfair",
  "bestbuy",
  "homedepot",
  "lowes",
  "costco",
  "samsclub",
  "macys",
  "kohls",
  "overstock",
  "chewy",
  "academy",
  "tractorsupply",
  "nike",
  "adidas",
  "temu",
  "ebay",
]);

export function isServerRetailScrapeBlocked(url: string): boolean {
  const store = detectStoreFromProductUrl(url);
  return store != null && SERVER_SCRAPE_BLOCKED.has(store);
}

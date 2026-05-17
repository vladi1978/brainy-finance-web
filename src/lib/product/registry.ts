import { amazonProvider } from "./providers/amazon.provider";
import { walmartProvider } from "./providers/walmart.provider";
import { targetProvider } from "./providers/target.provider";
import { temuProvider } from "./providers/temu.provider";
import { bestbuyProvider } from "./providers/bestbuy.provider";
import { homedepotProvider } from "./providers/homedepot.provider";
import { lowesProvider } from "./providers/lowes.provider";
import type { ProductProvider } from "./types";

/**
 * Central registry — add a provider module here to include it in compare runs.
 */
export const productProviderRegistry: readonly ProductProvider[] = [
  amazonProvider,
  walmartProvider,
  targetProvider,
  temuProvider,
  bestbuyProvider,
  homedepotProvider,
  lowesProvider,
];

/** First registered provider whose `canHandleProductUrl` accepts the link. */
export function findProductProviderForUrl(url: string): ProductProvider | null {
  for (const p of productProviderRegistry) {
    if (p.canHandleProductUrl(url)) return p;
  }
  return null;
}

export type RegisteredProductProvider = (typeof productProviderRegistry)[number];

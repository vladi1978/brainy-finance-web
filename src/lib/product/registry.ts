import { academyProvider } from "./providers/academy.provider";
import { adidasProvider } from "./providers/adidas.provider";
import { amazonProvider } from "./providers/amazon.provider";
import { bestbuyProvider } from "./providers/bestbuy.provider";
import { chewyProvider } from "./providers/chewy.provider";
import { costcoProvider } from "./providers/costco.provider";
import { ebayProvider } from "./providers/ebay.provider";
import { homedepotProvider } from "./providers/homedepot.provider";
import { kohlsProvider } from "./providers/kohls.provider";
import { lowesProvider } from "./providers/lowes.provider";
import { macysProvider } from "./providers/macys.provider";
import { nikeProvider } from "./providers/nike.provider";
import { overstockProvider } from "./providers/overstock.provider";
import { samsclubProvider } from "./providers/samsclub.provider";
import { targetProvider } from "./providers/target.provider";
import { temuProvider } from "./providers/temu.provider";
import { tractorsupplyProvider } from "./providers/tractorsupply.provider";
import { walmartProvider } from "./providers/walmart.provider";
import { wayfairProvider } from "./providers/wayfair.provider";
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
  costcoProvider,
  samsclubProvider,
  ebayProvider,
  macysProvider,
  kohlsProvider,
  wayfairProvider,
  overstockProvider,
  chewyProvider,
  academyProvider,
  tractorsupplyProvider,
  nikeProvider,
  adidasProvider,
];

/** First registered provider whose `canHandleProductUrl` accepts the link. */
export function findProductProviderForUrl(url: string): ProductProvider | null {
  for (const p of productProviderRegistry) {
    if (p.canHandleProductUrl(url)) return p;
  }
  return null;
}

export type RegisteredProductProvider = (typeof productProviderRegistry)[number];

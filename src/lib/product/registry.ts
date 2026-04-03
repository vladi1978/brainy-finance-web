import { ProductProvider } from "./providers/base";
import { amazonProvider } from "./providers/amazon.provider";
import { walmartProvider } from "./providers/walmart.provider";

/**
 * All stores participating in cross-store comparison.
 * To add a retailer:
 * 1. Add the store id to `StoreName` in `providers/search-result.ts` if new.
 * 2. Implement `ProductProvider` (URL detection, optional PDP extract, `searchByQuery`).
 * 3. Append the provider here — `compareProduct` will query every entry in parallel.
 */
export const providerRegistry: ProductProvider[] = [
  amazonProvider,
  walmartProvider,
];
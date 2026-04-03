import { amazonProvider } from "./providers/amazon.provider";
import { walmartProvider } from "./providers/walmart.provider";

/**
 * Central registry — add a provider module here to include it in compare runs.
 */
export const productProviderRegistry = [amazonProvider, walmartProvider] as const;

export type RegisteredProductProvider = (typeof productProviderRegistry)[number];

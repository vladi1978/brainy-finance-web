import { amazonProvider } from "./providers/amazon.provider";
import { walmartProvider } from "./providers/walmart.provider";
import { targetProvider } from "./providers/target.provider";
import { temuProvider } from "./providers/temu.provider";
import type { ProductProvider } from "./types";

/**
 * Central registry — add a provider module here to include it in compare runs.
 */
export const productProviderRegistry: readonly ProductProvider[] = [
  amazonProvider,
  walmartProvider,
  targetProvider,
  temuProvider,
];

export type RegisteredProductProvider = (typeof productProviderRegistry)[number];

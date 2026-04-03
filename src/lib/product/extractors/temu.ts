import { ExtractedProduct } from "../types";

export function canHandleTemu(input: string): boolean {
  return input.toLowerCase().includes("temu.");
}

export async function extractTemuProduct(input: string): Promise<ExtractedProduct> {
  return {
    title: "Temu Product",
    store: "temu",
    sourceUrl: input,
    originalPrice: null,
    currency: "USD",
    image: null,
    confidence: 0.4,
  };
}
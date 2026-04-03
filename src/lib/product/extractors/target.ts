import { ExtractedProduct } from "../types";

export function canHandleTarget(input: string): boolean {
  return input.toLowerCase().includes("target.");
}

export async function extractTargetProduct(input: string): Promise<ExtractedProduct> {
  return {
    title: "Target Product",
    store: "target",
    sourceUrl: input,
    originalPrice: null,
    currency: "USD",
    image: null,
    confidence: 0.4,
  };
}
import { ExtractedProduct } from "../types";

export function canHandleAmazon(input: string): boolean {
  return input.toLowerCase().includes("amazon.");
}

export async function extractAmazonProduct(input: string): Promise<ExtractedProduct> {
  return {
    title: "Amazon Product",
    store: "amazon",
    sourceUrl: input,
    originalPrice: null,
    currency: "USD",
    image: null,
    confidence: 0.4,
  };
}
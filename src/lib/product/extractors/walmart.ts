import { ExtractedProduct } from "../types";

export function canHandleWalmart(input: string): boolean {
  return input.toLowerCase().includes("walmart.");
}

export async function extractWalmartProduct(input: string): Promise<ExtractedProduct> {
  return {
    title: "Walmart Product",
    store: "walmart",
    sourceUrl: input,
    originalPrice: null,
    currency: "USD",
    image: null,
    confidence: 0.4,
  };
}
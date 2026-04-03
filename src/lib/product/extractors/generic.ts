import { detectInputType } from "../detectInputType";
import { normalizeQuery } from "../normalizeQuery";
import { ExtractedProduct } from "../types";

export async function extractGenericProduct(input: string): Promise<ExtractedProduct> {
  const kind = detectInputType(input);
  const normalized = normalizeQuery(input);

  return {
    title: normalized || "Unknown Product",
    store: "generic",
    sourceUrl: kind === "url" ? input : undefined,
    originalPrice: null,
    currency: "USD",
    image: null,
    confidence: 0.5,
  };
}
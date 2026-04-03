import { providerRegistry } from "./registry";
import type { ExtractedSourceProduct } from "./providers/base";
import type { ProductSearchResult } from "./providers/search-result";

const DEMO_MODE = true;

type CompareProductResponse = {
  sourceProduct: ExtractedSourceProduct | null;
  bestDeal: ProductSearchResult | null;
  alternatives: ProductSearchResult[];
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractImportantQuery(input: string): string {
  const cleaned = normalizeText(input);

  const brandMatch = cleaned.match(
    /\b(samsung|lg|sony|hisense|tcl|nike|adidas|apple|beats)\b/i
  );
  const modelMatch = cleaned.match(
    /\b(qn\d{2,4}[a-z0-9]*|oled|neo qled|air max|u8000f|u6|u7|u8)\b/i
  );
  const sizeMatch = cleaned.match(/\b\d{2,3}(-|\s)?inch\b/i);
  const typeMatch = cleaned.match(
    /\b(tv|smart tv|shoes|socks|speaker|headphones)\b/i
  );

  const parts = [
    brandMatch?.[0],
    modelMatch?.[0],
    sizeMatch?.[0]?.replace("-", " "),
    typeMatch?.[0],
  ].filter(Boolean);

  if (parts.length >= 2) {
    return parts.join(" ");
  }

  return cleaned;
}

function isSamsungTvWalmartDemo(input: string): boolean {
  const normalized = normalizeText(input);

  const hasWalmartUrl =
    normalized.includes("walmart.com") || normalized.includes("www.walmart.com");
  const mentionsSamsung = normalized.includes("samsung");
  const mentionsTv = normalized.includes("tv");

  return hasWalmartUrl && mentionsSamsung && mentionsTv;
}

function scoreResult(query: string, result: ProductSearchResult): number {
  const q = normalizeText(query);
  const r = normalizeText(result.title);

  let score = 0;

  for (const word of q.split(" ")) {
    if (word.length >= 3 && r.includes(word)) {
      score += 1;
    }
  }

  return score;
}

export async function compareProduct(
  rawInput: string
): Promise<CompareProductResponse> {
  const input = rawInput.trim();

  if (!input) {
    throw new Error("Missing product input");
  }

  if (DEMO_MODE && isSamsungTvWalmartDemo(input)) {
    const demoSourceProduct: ExtractedSourceProduct = {
      sourceUrl: input,
      store: "walmart",
      title: "Samsung 55-inch TV",
      normalizedTitle: normalizeText("Samsung 55-inch TV"),
      originalPrice: 599,
      currency: "USD",
      image: null,
      sku: null,
      brand: "Samsung",
      model: null,
      upc: null,
    };

    const demoBestDeal: ProductSearchResult = {
      store: "amazon",
      title: "Samsung 55-inch TV",
      normalizedTitle: normalizeText("Samsung 55-inch TV"),
      price: 549,
      currency: "USD",
      productUrl: "https://www.amazon.com/samsung-55-inch-tv-demo",
      affiliateUrl:
        "https://brainyfinance.app/deal?query=Samsung%2055-inch%20TV&ref=demo",
      image: null,
      inStock: true,
      sku: null,
      brand: "Samsung",
      model: null,
      upc: null,
      sourceConfidence: 0.99,
      matchConfidence: 0.99,
    };

    return {
      sourceProduct: demoSourceProduct,
      bestDeal: demoBestDeal,
      alternatives: [demoBestDeal],
    };
  }

  const sourceProvider =
    providerRegistry.find((provider) => provider.canHandleUrl(input)) ?? null;

  let sourceProduct: ExtractedSourceProduct | null = null;
  let detectedStore: string | null = null;
  let searchBase = input;

  if (sourceProvider) {
    detectedStore = sourceProvider.store;

    if (sourceProvider.extractFromUrl) {
      sourceProduct = await sourceProvider.extractFromUrl(input);
    }

    if (sourceProduct?.title) {
      searchBase = sourceProduct.title;
    }
  }

  const searchQuery = extractImportantQuery(searchBase);

  const nestedResults = await Promise.all(
    providerRegistry.map((provider) =>
      provider.searchByQuery({
        raw: input,
        normalizedQuery: searchQuery,
        sourceProduct,
      })
    )
  );

  const flattened = nestedResults.flat();

  const ranked = flattened
    .map((result) => ({
      result,
      score: scoreResult(searchQuery, result),
    }))
    .filter(
      (item) =>
        item.score >= 2 ||
        item.result.store === detectedStore
    )
    .sort((a, b) => {
      const aPrice = a.result.price ?? Number.MAX_SAFE_INTEGER;
      const bPrice = b.result.price ?? Number.MAX_SAFE_INTEGER;
      return aPrice - bPrice;
    })
    .map((item) => item.result);

  const bestDeal = ranked.length > 0 ? ranked[0] : null;

  return {
    sourceProduct,
    bestDeal,
    alternatives: ranked,
  };
}
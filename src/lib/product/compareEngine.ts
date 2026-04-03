import { providerRegistry } from "./registry";
import type { ExtractedSourceProduct } from "./providers/base";
import type { ProductSearchResult } from "./providers/search-result";

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

function isValidComparablePrice(price: number | null | undefined): boolean {
  return price != null && Number.isFinite(price) && price > 0;
}

function sourceProductToSearchResult(
  sp: ExtractedSourceProduct
): ProductSearchResult | null {
  if (!isValidComparablePrice(sp.originalPrice)) return null;
  if (sp.store !== "amazon" && sp.store !== "walmart") return null;

  return {
    store: sp.store,
    title: sp.title,
    normalizedTitle: sp.normalizedTitle,
    price: sp.originalPrice,
    currency: sp.currency,
    productUrl: sp.sourceUrl,
    affiliateUrl: sp.sourceUrl,
    sourceUrl: sp.sourceUrl,
    image: sp.image ?? null,
    inStock: true,
    sku: sp.sku ?? null,
    brand: sp.brand ?? null,
    model: sp.model ?? null,
    upc: sp.upc ?? null,
    sourceConfidence: 0.95,
    matchConfidence: 1,
  };
}

function dedupeByStoreAndUrl(
  items: ProductSearchResult[]
): ProductSearchResult[] {
  const map = new Map<string, ProductSearchResult>();
  for (const item of items) {
    const key = `${item.store}|${item.productUrl.split("?")[0].toLowerCase()}`;
    const prev = map.get(key);
    if (
      !prev ||
      (item.price ?? Number.POSITIVE_INFINITY) <
        (prev.price ?? Number.POSITIVE_INFINITY)
    ) {
      map.set(key, item);
    }
  }
  return [...map.values()];
}

export async function compareProduct(
  rawInput: string
): Promise<CompareProductResponse> {
  const input = rawInput.trim();

  if (!input) {
    throw new Error("Missing product input");
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
        item.score >= 1 ||
        item.result.store === detectedStore ||
        isValidComparablePrice(item.result.price)
    )
    .sort((a, b) => {
      const ap = a.result.price ?? Number.MAX_SAFE_INTEGER;
      const bp = b.result.price ?? Number.MAX_SAFE_INTEGER;
      if (ap !== bp) return ap - bp;
      return b.score - a.score;
    })
    .map((item) => item.result);

  const sourceAsResult = sourceProduct
    ? sourceProductToSearchResult(sourceProduct)
    : null;

  const searchPriced = ranked.filter((r) => isValidComparablePrice(r.price));

  const comparisonPool = dedupeByStoreAndUrl([
    ...(sourceAsResult ? [sourceAsResult] : []),
    ...searchPriced,
  ]);

  let bestDeal: ProductSearchResult | null = null;
  if (comparisonPool.length >= 2) {
    const sorted = [...comparisonPool].sort(
      (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)
    );
    bestDeal = sorted[0] ?? null;
  }

  return {
    sourceProduct,
    bestDeal,
    alternatives: ranked,
  };
}

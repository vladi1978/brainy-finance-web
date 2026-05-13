import { scrapeProduct } from "../scrapeProduct";
import { fetchAmazonSerpWithDiagnostics } from "../searchParse";
import { buildNormalizedProduct, normalizeTitle } from "../normalize";
import { isValidProductDetailUrl } from "../productDetailUrl";
import type {
  CandidateProduct,
  ProductProvider,
  ProviderResult,
  ProviderSearchContext,
  ProviderSearchDiagnostics,
  SourceProduct,
  StoreId,
} from "../types";

const STORE: StoreId = "amazon";

/** TEMP: set `PRODUCT_SERP_DEBUG=1` to log provider second-pass PDP filter (remove when done). */
function providerSerpDebug(payload: Record<string, unknown>): void {
  if (process.env.PRODUCT_SERP_DEBUG !== "1") return;
  console.log("[product-serp-debug]", payload);
}

function toDiagnostics(
  query: string,
  d: import("../searchParse").StoreSerpDiagnostics
): ProviderSearchDiagnostics {
  return {
    store: d.store,
    query,
    fetchOk: d.fetchOk,
    httpStatus: d.httpStatus,
    byteLength: d.byteLength,
    candidateCount: d.candidateCount,
    hints: d.hints,
  };
}

function titleFromAmazonUrl(input: string): string {
  const m = input.match(/amazon\.[^/]+\/([^/]+)\/dp\/[A-Z0-9]{9,14}/i);
  if (m?.[1] && !/^dp$/i.test(m[1])) {
    try {
      return decodeURIComponent(m[1]).replace(/-/g, " ").trim();
    } catch {
      return m[1].replace(/-/g, " ").trim();
    }
  }
  return "";
}

function rankRowsByQueryRelevance<
  T extends { title: string },
>(rows: T[], searchQuery: string): T[] {
  const q = normalizeTitle(searchQuery)
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  if (q.length === 0) return rows;
  const scored = rows.map((row) => {
    const t = normalizeTitle(row.title);
    let hits = 0;
    for (const w of q) {
      if (t.includes(w)) hits += 1;
    }
    return { row, hits };
  });
  scored.sort((a, b) => b.hits - a.hits);
  return scored.map((s) => s.row);
}

/** SERP titles are normalized for matching; TVs get strict `normalized.tv` signals from `buildNormalizedProduct`. */
function rowToCandidate(
  row: { title: string; price: number | null; currency: string; productUrl: string },
  searchQuery: string
): CandidateProduct {
  const normalized = buildNormalizedProduct(row.title, {
    price: row.price,
    currency: row.currency,
    productUrl: row.productUrl,
  });
  const qWords = normalizeTitle(searchQuery).split(/\s+/).filter((w) => w.length >= 3);
  let matchWords = 0;
  for (const w of qWords) {
    if (normalized.titleNorm.includes(w)) matchWords += 1;
  }
  const sourceConfidence =
    qWords.length > 0
      ? Math.min(0.98, 0.45 + (matchWords / qWords.length) * 0.5)
      : 0.65;

  return {
    store: STORE,
    title: row.title,
    price: row.price,
    currency: row.currency,
    productUrl: row.productUrl,
    affiliateUrl: row.productUrl,
    imageUrl: null,
    normalized,
    sourceConfidence,
  };
}

export const amazonProvider: ProductProvider = {
  id: STORE,

  canHandleProductUrl(url: string): boolean {
    return /\bamazon\.[a-z.]{2,}\b|\/\/a\.co\/|\/\/amzn\.to\//i.test(url);
  },

  async extractSourceProduct(url: string): Promise<SourceProduct | null> {
    const scraped = await scrapeProduct(url);
    const urlTitle = titleFromAmazonUrl(url);
    const title = scraped?.productName?.trim() || urlTitle;
    if (!title) return null;

    return {
      sourceUrl: url,
      store: STORE,
      title,
      originalPrice: scraped?.price ?? null,
      currency: scraped?.currency ?? "USD",
      normalized: buildNormalizedProduct(title),
    };
  },

  async searchCandidates(ctx: ProviderSearchContext): Promise<ProviderResult> {
    const effectiveQuery =
      ctx.searchQuery?.trim() ||
      normalizeTitle(ctx.productQuery || "") ||
      ctx.rawInput;
    const { candidates, diagnostics } = await fetchAmazonSerpWithDiagnostics(
      effectiveQuery,
      24
    );
    const ranked = rankRowsByQueryRelevance(candidates, effectiveQuery);

    const secondPassInvalid = ranked.filter(
      (c) => !isValidProductDetailUrl("amazon", c.productUrl)
    );
    providerSerpDebug({
      store: STORE,
      phase: "provider_search_second_pdp",
      fromParseCount: ranked.length,
      secondPassRejectedCount: secondPassInvalid.length,
      first3BeforeSecondPdp: ranked.slice(0, 3).map((c) => ({
        title: c.title.slice(0, 120),
        productUrl: c.productUrl,
        pdpValid: isValidProductDetailUrl("amazon", c.productUrl),
      })),
      sampleSecondPassRejectedUrls: secondPassInvalid
        .slice(0, 3)
        .map((c) => c.productUrl),
    });

    return {
      candidates: ranked
        .filter((c) => isValidProductDetailUrl("amazon", c.productUrl))
        .map((c) => rowToCandidate(c, effectiveQuery)),
      diagnostics: toDiagnostics(effectiveQuery, diagnostics),
    };
  },

  toAffiliateUrl(productUrl: string): string {
    return productUrl;
  },
};

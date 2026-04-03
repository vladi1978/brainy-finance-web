import { scrapeProduct } from "../scrapeProduct";
import { fetchWalmartSerpWithDiagnostics } from "../searchParse";
import { buildNormalizedProduct, normalizeTitle } from "../normalize";
import type {
  CandidateProduct,
  ProductProvider,
  ProviderResult,
  ProviderSearchContext,
  ProviderSearchDiagnostics,
  SourceProduct,
  StoreId,
} from "../types";

const STORE: StoreId = "walmart";

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

function cleanWalmartTitleFromUrl(input: string): string {
  return input
    .replace(/^https?:\/\/(www\.)?walmart\.com\/ip\//i, "")
    .replace(/\?.*$/, "")
    .replace(/-/g, " ")
    .replace(/\bip\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function rowToCandidate(
  row: { title: string; price: number | null; currency: string; productUrl: string },
  searchQuery: string
): CandidateProduct {
  const normalized = buildNormalizedProduct(row.title);
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
    normalized,
    sourceConfidence,
  };
}

export const walmartProvider: ProductProvider = {
  id: STORE,

  canHandleProductUrl(url: string): boolean {
    return /walmart\.com/i.test(url);
  },

  async extractSourceProduct(url: string): Promise<SourceProduct | null> {
    const scraped = await scrapeProduct(url);
    const title =
      scraped?.productName?.trim() || cleanWalmartTitleFromUrl(url);
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
    /** Prefer compact normalized query so SERP matches real product type, not URL slug noise. */
    const effectiveQuery =
      ctx.searchQuery?.trim() ||
      normalizeTitle(ctx.sourceProduct?.title || "") ||
      ctx.rawInput;
    const { candidates, diagnostics } = await fetchWalmartSerpWithDiagnostics(
      effectiveQuery,
      24
    );
    const ranked = rankRowsByQueryRelevance(candidates, effectiveQuery);

    return {
      candidates: ranked.map((c) => rowToCandidate(c, effectiveQuery)),
      diagnostics: toDiagnostics(effectiveQuery, diagnostics),
    };
  },

  toAffiliateUrl(productUrl: string): string {
    return productUrl;
  },
};

import {
  scrapeProduct,
  composeRetailShoppingTitleFromPdp,
  logRetailPdpShoppingIdentity,
} from "../scrapeProduct";
import { finalizedSlugShoppingLine } from "../urlProductQuery";
import { fetchAmazonSerpWithDiagnostics } from "../searchParse";
import {
  buildNormalizedProduct,
  extractAmazonAsinFromUrl,
  normalizeTitle,
} from "../normalize";
import { isUsablePdpTitle } from "../usablePdpTitle";
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

/** Second-pass PDP fetch — some bot walls serve a fuller `<title>` to Googlebot-style agents. */
const GOOGLEBOT_PDP_HEADERS: HeadersInit = {
  "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)",
  "Accept-Language": "en-US,en;q=0.9",
};

function slugSegmentBeforeAmazonAsinPath(pathname: string): string | null {
  const m = pathname.match(
    /\/([^/]+)\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})\b/i
  );
  if (!m?.[1]) return null;
  const raw = m[1];
  if (/^[A-Z0-9]{10}$/i.test(raw)) return null;
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "))
      .replace(/-/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return raw.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  }
}

/**
 * When HTML scraping fails, derive a minimal searchable line from the Amazon URL (slug + ASIN).
 */
function buildAmazonUrlFallbackTitle(url: string, slugLine: string): string {
  const asin = extractAmazonAsinFromUrl(url);
  const slugFromUtil = slugLine.replace(/\s+/g, " ").trim();

  let fromPath = "";
  try {
    fromPath = slugSegmentBeforeAmazonAsinPath(new URL(url).pathname) ?? "";
  } catch {
    fromPath = "";
  }

  const candidates = [slugFromUtil, fromPath].filter(
    (s) => s.length >= 4 && !/^dp$/i.test(s)
  );
  candidates.sort((a, b) => b.length - a.length);
  const headline = candidates[0] ?? "";

  const parts: string[] = [];
  if (headline) parts.push(headline);
  if (asin) parts.push(`ASIN ${asin}`);
  const joined = parts.join(" — ").replace(/\s+/g, " ").trim();
  if (joined) return joined;
  if (asin) return `Amazon ${asin}`;
  return "Amazon product";
}

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
    const slugLine = finalizedSlugShoppingLine(url);
    let scraped = await scrapeProduct(url);
    let { primaryTitle, primarySource } = composeRetailShoppingTitleFromPdp({
      scraped,
      slugDerivedQueryLine: slugLine,
    });

    let title = primaryTitle.trim();

    if (!isUsablePdpTitle(title)) {
      const scrapedBot = await scrapeProduct(url, { headers: GOOGLEBOT_PDP_HEADERS });
      if (scrapedBot) {
        scraped = scrapedBot;
        const second = composeRetailShoppingTitleFromPdp({
          scraped: scrapedBot,
          slugDerivedQueryLine: slugLine,
        });
        primarySource = second.primarySource;
        title = second.primaryTitle.trim();
      }
    }

    let urlFallback = false;
    if (!isUsablePdpTitle(title)) {
      title = buildAmazonUrlFallbackTitle(url, slugLine).trim();
      urlFallback = true;
    }

    if (!title) return null;

    const brandLog = scraped?.brand?.trim() || null;
    const modelLog =
      scraped?.model?.trim() || scraped?.sku?.trim() || null;

    logRetailPdpShoppingIdentity({
      store: STORE,
      title,
      brand: brandLog,
      model: modelLog,
      fallbackUsed: primarySource === "slug_path" || urlFallback,
    });

    return {
      sourceUrl: url,
      store: STORE,
      title,
      originalPrice: scraped?.price ?? null,
      currency: scraped?.currency ?? "USD",
      normalized: buildNormalizedProduct(title, {
        price: scraped?.price ?? null,
        currency: scraped?.currency ?? null,
        productUrl: url,
      }),
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

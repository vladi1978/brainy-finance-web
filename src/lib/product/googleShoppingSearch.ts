/** Active cross-store discovery for compare — Serper or SerpAPI Google Shopping. See `LEGACY.md`. */
import {
  resolveShoppingPurchasePrice,
} from "./commercialListingClassifier";
import { buildNormalizedProduct, detectStoreFromProductUrl } from "./normalize";
import { isProductDetailStoreKey } from "./productDetailUrl";
import { dedupeIdenticalListingUrls } from "./candidateDedupe";
import { extractBestMerchantProductUrl } from "./merchantProductUrl";
import { buildRetailerSearchUrlFromTitle } from "./source/buildSearchUrl";
import {
  classifyShoppingRawLink,
  isGoogleShoppingOverlayUrl,
} from "./source/linkClassification";
import { fetchSerpApiShoppingJson } from "./source/serpapiSource";
import { fetchSerperShoppingJson } from "./source/serperSource";
import { logProductSourceCandidate } from "./source/universalProductSource";
import { hostFromUrl } from "./source/storeDomains";
import type {
  CandidateProduct,
  ProviderSearchContext,
  ProviderSearchDiagnostics,
  ShoppingSourceAdapterId,
  StoreId,
  UniversalStoreId,
} from "./types";

export {
  extractBestMerchantProductUrl,
  unwrapMerchantUrl,
  finalizeMerchantProductUrlExport as finalizeMerchantProductUrl,
} from "./merchantProductUrl";

function shoppingLog(payload: Record<string, unknown>): void {
  if (process.env.PRODUCT_SHOPPING_DEBUG !== "1") return;
  console.log("[google-shopping]", payload);
}

const SHOPPING_ROW_VERBOSE =
  process.env.PRODUCT_SHOPPING_DEBUG === "1" ||
  process.env.DEBUG_COMPARE === "true";

/** Loose Serp shopping row flattened for logs / pre-match inspection. */
export type ParsedSerpShoppingItem = {
  title: string | null;
  /** Raw price string when present — may still be absent for weak listings */
  price: string | number | null;
  link: string | null;
  source: string | null;
  thumbnail: string | null;
};

function inferStoreFromSourceLabel(label: unknown): StoreId | null {
  if (typeof label !== "string") return null;
  const combined = `${label} ${label.replace(/^https?:\/\//i, "")}`.toLowerCase();
  if (/\bamazon\b|amazon\.(?:com|[a-z.]+)\b|\.amazon\./i.test(combined))
    return "amazon";
  if (/\bwalmart\b|walmart\.com\b/i.test(combined)) return "walmart";
  if (/\btarget\b|target\.com\b/i.test(combined)) return "target";
  if (/\btemu\b|temu\.com\b/i.test(combined)) return "temu";
  if (/\bbest\s*buy\b|bestbuy\.com\b/i.test(combined)) return "bestbuy";
  if (/\bhome\s*depot\b|homedepot\.com\b/i.test(combined)) return "homedepot";
  if (/\blowes\b|lowes\.com\b/i.test(combined)) return "lowes";
  if (/\bcostco\b|costco\.com\b/i.test(combined)) return "costco";
  if (/\bsam'?s\s*club\b|samsclub\.com\b/i.test(combined)) return "samsclub";
  if (/\bebay\b|ebay\.com\b/i.test(combined)) return "ebay";
  if (/\bmacys\b|macy'?s\b|macys\.com\b/i.test(combined)) return "macys";
  if (/\bkohls\b|kohl'?s\b|kohls\.com\b/i.test(combined)) return "kohls";
  if (/\bwayfair\b|wayfair\.com\b/i.test(combined)) return "wayfair";
  if (/\boverstock\b|overstock\.com\b/i.test(combined)) return "overstock";
  if (/\bchewy\b|chewy\.com\b/i.test(combined)) return "chewy";
  if (/\bacademy\b|academy\.com\b/i.test(combined)) return "academy";
  if (/\btractor\s*supply\b|tractorsupply\.com\b/i.test(combined))
    return "tractorsupply";
  if (/\bnike\b|nike\.com\b/i.test(combined)) return "nike";
  if (/\badidas\b|adidas\.com\b/i.test(combined)) return "adidas";
  return null;
}

function pickSourceLabel(row: Record<string, unknown>): string | null {
  const candidates = [
    row.source,
    row.seller,
    row.retailer,
    row.merchant,
    row.store,
    row.displayed_link,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

function pickThumbnailFromRow(row: Record<string, unknown>): string | null {
  const direct = [
    row.thumbnail,
    row.serpapi_thumbnail,
    row.imageUrl,
    row.image,
  ];
  for (const d of direct) {
    if (typeof d === "string" && d.startsWith("http")) return d;
  }
  const thumbs = row.thumbnails;
  if (Array.isArray(thumbs)) {
    for (const t of thumbs) {
      if (typeof t === "string" && t.startsWith("http")) return t;
    }
  }
  const st = row.serpapi_thumbnails;
  if (Array.isArray(st)) {
    for (const t of st) {
      if (typeof t === "string" && t.startsWith("http")) return t;
    }
  }
  return null;
}

function pickShoppingProductId(row: Record<string, unknown>): string | undefined {
  const raw =
    row.product_id ??
    row.productId ??
    row.gid ??
    row.product_token ??
    (row as { product_token_secure?: unknown }).product_token_secure;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return undefined;
}

function pickRatingFromRow(row: Record<string, unknown>): number | null {
  const raw = row.rating ?? row.stars ?? row.review_rating ?? row.star_rating;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw != null && typeof raw === "object") {
    const v = (raw as { value?: unknown; rating?: unknown }).value ??
      (raw as { rating?: unknown }).rating;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function dedupeShoppingRowKey(row: Record<string, unknown>): string {
  const link =
    (typeof row.product_link === "string" ? row.product_link : null) ||
    (typeof row.link === "string" ? row.link : null) ||
    (typeof row.adurl === "string" ? row.adurl : null) ||
    (typeof row.tracking_link === "string" ? row.tracking_link : null) ||
    (typeof row.url === "string" ? row.url : null);
  const title =
    typeof row.title === "string"
      ? row.title
      : typeof row.name === "string"
        ? row.name
        : "";
  const pos =
    typeof row.position === "number"
      ? String(row.position)
      : typeof row.position === "string"
        ? row.position
        : "";
  return (link ?? "").slice(0, 800) || `${title}:${pos}:${typeof row.product_id}`;
}

function pickRawHttpLinkFromRow(row: Record<string, unknown>): string | null {
  const keys = [
    "link",
    "adurl",
    "product_link",
    "merchant_link",
    "productUrl",
    "merchantUrl",
    "offerPageUrl",
    "directUrl",
    "product_url",
    "merchant_url",
    "tracking_link",
    "url",
  ];
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.startsWith("http")) return v;
  }
  const bundle = row.shoppingResults ?? row.shopping_results;
  if (Array.isArray(bundle) && bundle.length > 0) {
    const first = bundle[0];
    if (first != null && typeof first === "object") {
      const nested = first as Record<string, unknown>;
      for (const k of ["link", "product_link", "merchantUrl", "productUrl"]) {
        const v = nested[k];
        if (typeof v === "string" && v.startsWith("http")) return v;
      }
    }
  }
  return null;
}

function tryAddShoppingRow(
  raw: Record<string, unknown>,
  seen: Set<string>,
  out: Record<string, unknown>[]
): void {
  const nested =
    /** Serper keeps merchant PDP URLs on the parent row under `shoppingResults`; do not flatten it (child rows lack titles). */
    raw.shopping_results ?? raw.inline_shopping_results ?? raw.products;
  if (Array.isArray(nested)) {
    for (const inner of nested) {
      if (inner != null && typeof inner === "object") {
        tryAddShoppingRow(inner as Record<string, unknown>, seen, out);
      }
    }
    return;
  }
  const key = dedupeShoppingRowKey(raw);
  if (seen.has(key)) return;
  seen.add(key);
  out.push(raw);
}

/**
 * Normalize rows from Serper + SerpAPI Google Shopping payloads (different top-level buckets).
 */
function normalizeShoppingRows(payload: unknown): Record<string, unknown>[] {
  if (payload == null || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;

  const arrayCandidates: unknown[] = [
    root.shopping,
    root.shoppingResults,
    root.shopping_results,
    root.inline_shopping_results,
    (root as { items?: unknown }).items,
    root.organic_results,
  ];

  const pr = root.product_results;
  if (Array.isArray(pr)) arrayCandidates.push(pr);
  else if (pr != null && typeof pr === "object") {
    const prodObj = pr as Record<string, unknown>;
    arrayCandidates.push(prodObj.products);
    arrayCandidates.push(prodObj.items);
    /** Single enriched product capsule */
    if (
      typeof prodObj.title === "string" ||
      prodObj.link != null ||
      prodObj.product_link != null
    ) {
      arrayCandidates.push([prodObj]);
    }
  }

  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const bucket of arrayCandidates) {
    if (!Array.isArray(bucket)) continue;
    for (const raw of bucket) {
      if (raw == null || typeof raw !== "object") continue;
      tryAddShoppingRow(raw as Record<string, unknown>, seen, out);
    }
  }

  return out;
}

/** First top-level shopping array from Serper-style JSON (for debug logs). */
function extractRawSerperShoppingItems(payload: unknown): unknown[] {
  if (payload == null || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const buckets: unknown[] = [
    root.shopping,
    root.shoppingResults,
    root.shopping_results,
    root.inline_shopping_results,
    (root as { items?: unknown }).items,
    root.organic_results,
  ];
  const pr = root.product_results;
  if (Array.isArray(pr)) buckets.push(pr);
  else if (pr != null && typeof pr === "object") {
    const prodObj = pr as Record<string, unknown>;
    buckets.push(prodObj.products);
    buckets.push(prodObj.items);
  }
  for (const b of buckets) {
    if (Array.isArray(b) && b.length > 0) return b;
  }
  for (const b of buckets) {
    if (Array.isArray(b)) return b;
  }
  return [];
}

function parsedItemFromShoppingRow(row: Record<string, unknown>): ParsedSerpShoppingItem | null {
  const title =
    typeof row.title === "string"
      ? row.title
      : typeof row.name === "string"
        ? row.name
        : typeof row.snippet === "string"
          ? row.snippet.slice(0, 280)
          : null;
  if (!title || title.length < 2) return null;

  const link =
    (typeof row.merchant_link === "string" && row.merchant_link.startsWith("http")
      ? row.merchant_link
      : null) ||
    (typeof row.adurl === "string" && row.adurl.startsWith("http") ? row.adurl : null) ||
    (typeof row.product_link === "string" && row.product_link.startsWith("http")
      ? row.product_link
      : null) ||
    (typeof row.link === "string" && row.link.startsWith("http") ? row.link : null);

  const priceStr = (() => {
    const resolved = resolveShoppingPurchasePrice({
      title,
      price: row.price,
      extracted_price: row.extracted_price,
      installment: row.installment,
      alternative_price: row.alternative_price,
      url: link,
      storeLabel: pickSourceLabel(row),
    });
    if (resolved.rejected || resolved.purchasePrice == null) {
      return resolved.rawPriceText ?? null;
    }
    return resolved.rawPriceText ?? String(resolved.purchasePrice);
  })();
  const extractedNum =
    typeof row.extracted_price === "number" && Number.isFinite(row.extracted_price)
      ? row.extracted_price
      : null;

  return {
    title,
    /** Raw display string preferred; fallback to extracted numeric — may be absent for weak rows */
    price: priceStr ?? extractedNum,
    link,
    source: pickSourceLabel(row),
    thumbnail: pickThumbnailFromRow(row),
  };
}


function logShoppingRowSkip(reason: string, detail: Record<string, unknown>): void {
  if (!SHOPPING_ROW_VERBOSE) return;
  console.log("[google-shopping-row-skip]", { reason, ...detail });
}

function logUnknownStoreKept(detail: Record<string, unknown>): void {
  if (!SHOPPING_ROW_VERBOSE) return;
  console.log("[UNKNOWN_STORE_KEPT]", detail);
}

function resolveStoreForShoppingRow(
  merchantUrl: string | null,
  source: string | null
): { store: UniversalStoreId; mappedKnownStore: boolean } {
  if (merchantUrl) {
    const fromUrl = detectStoreFromProductUrl(merchantUrl);
    if (fromUrl) return { store: fromUrl, mappedKnownStore: true };
    return { store: "other", mappedKnownStore: false };
  }
  const inferred = inferStoreFromSourceLabel(source);
  if (inferred) return { store: inferred, mappedKnownStore: true };
  return { store: "other", mappedKnownStore: false };
}

function syntheticListingKey(store: UniversalStoreId, title: string): string {
  return `shopping:${store}:${title.replace(/\s+/g, " ").trim().toLowerCase()}`;
}

function resolveShoppingRowProductUrl(args: {
  merchantUrl: string | null;
  store: UniversalStoreId;
  title: string;
}): { productUrl: string; shoppingHintUrl: string | null; usedSearchFallback: boolean } {
  const merchantUrl = args.merchantUrl;
  if (merchantUrl && !isGoogleShoppingOverlayUrl(merchantUrl)) {
    return {
      productUrl: merchantUrl,
      shoppingHintUrl: merchantUrl,
      usedSearchFallback: false,
    };
  }

  if (isProductDetailStoreKey(args.store)) {
    const searchUrl = buildRetailerSearchUrlFromTitle(args.store, args.title).trim();
    if (searchUrl.startsWith("http")) {
      console.log(
        [
          "[PRODUCT_URL_FALLBACK_SEARCH_USED]",
          `store=${args.store}`,
          `title=${args.title.slice(0, 120)}`,
          `url=${searchUrl.slice(0, 220)}`,
        ].join(" "),
      );
      return {
        productUrl: searchUrl,
        shoppingHintUrl: null,
        usedSearchFallback: true,
      };
    }
  }

  return {
    productUrl: syntheticListingKey(args.store, args.title),
    shoppingHintUrl: null,
    usedSearchFallback: false,
  };
}

function rowToCandidate(
  row: Record<string, unknown>,
  searchQuery: string,
  sourceAdapter: ShoppingSourceAdapterId,
): CandidateProduct | null {
  const title =
    typeof row.title === "string"
      ? row.title
      : typeof row.name === "string"
        ? row.name
        : typeof row.snippet === "string"
          ? row.snippet.slice(0, 280).trim()
        : null;
  if (!title || title.length < 3) return null;

  const source = pickSourceLabel(row);
  const rawLink = pickRawHttpLinkFromRow(row);
  const merchantUrlForStore = extractBestMerchantProductUrl(row);
  const rawLinkType = classifyShoppingRawLink(rawLink, merchantUrlForStore);
  const retailerName = source?.trim() || null;

  const { store, mappedKnownStore } = resolveStoreForShoppingRow(
    merchantUrlForStore,
    source,
  );
  const resolvedUrls = resolveShoppingRowProductUrl({
    merchantUrl: merchantUrlForStore,
    store,
    title,
  });
  const productUrl = resolvedUrls.productUrl;
  const shoppingHintUrl = resolvedUrls.shoppingHintUrl;

  if (!mappedKnownStore) {
    logUnknownStoreKept({
      store: "other",
      retailerName,
      merchantUrlPreview: merchantUrlForStore?.slice(0, 220) ?? null,
      titlePreview: title.slice(0, 120),
    });
  }

  const priceResolution = resolveShoppingPurchasePrice({
    title,
    price: row.price,
    extracted_price: row.extracted_price,
    installment: row.installment,
    alternative_price: row.alternative_price,
    url: merchantUrlForStore ?? productUrl,
    hostname: merchantUrlForStore ? hostFromUrl(merchantUrlForStore) : null,
    storeLabel: retailerName,
  });

  if (
    priceResolution.purchasePrice == null ||
    priceResolution.rejected &&
      (priceResolution.rejectReason === "installment_only_no_full_purchase_price" ||
        priceResolution.rejectReason === "payment_period_price_only" ||
        priceResolution.rejectReason === "missing_parseable_purchase_price")
  ) {
    logShoppingRowSkip(priceResolution.rejectReason ?? "missing_parseable_price", {
      store,
      titlePreview: title.slice(0, 80),
      listingType: priceResolution.classification.listingType,
      priceIntent: priceResolution.classification.priceIntent,
    });
    return null;
  }

  const price = priceResolution.purchasePrice;
  const rawPriceText = priceResolution.rawPriceText;
  const commercialListing = priceResolution.classification;

  const imageUrl = pickThumbnailFromRow(row);
  const rating = pickRatingFromRow(row);
  const productId = pickShoppingProductId(row);

  const normalized = buildNormalizedProduct(title, {
    price,
    currency: "USD",
    productUrl,
  });

  const qWords = searchQuery
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  let matchWords = 0;
  for (const w of qWords) {
    if (normalized.titleNorm.includes(w)) matchWords += 1;
  }

  const sourceConfidence =
    qWords.length > 0
      ? Math.min(0.98, 0.45 + (matchWords / qWords.length) * 0.5)
      : 0.72;

  const out: CandidateProduct = {
    store,
    title,
    price,
    currency: "USD",
    productUrl,
    /** Raw merchant PDP; affiliate wrapping applied in compare pipeline */
    affiliateUrl: productUrl,
    imageUrl,
    normalized,
    sourceConfidence,
  };

  if (retailerName) out.sourceLabel = retailerName;
  if (shoppingHintUrl) out.shoppingHintUrl = shoppingHintUrl;
  if (rawLink) out.rawShoppingLink = rawLink;
  out.rawLinkType = rawLinkType;
  out.sourceAdapter = sourceAdapter;
  out.shoppingQueryUsed = searchQuery.replace(/\s+/g, " ").trim();
  if (rating != null) out.rating = rating;
  if (productId) out.productId = productId;
  if (rawPriceText) out.rawPriceText = rawPriceText;
  out.commercialListing = commercialListing;

  logProductSourceCandidate({
    phase: "shopping_ingest",
    sourceAdapter,
    store,
    title: title.slice(0, 120),
    price,
    rawPriceText,
    listingType: commercialListing.listingType,
    priceIntent: commercialListing.priceIntent,
    commercialSignals: commercialListing.signals,
    rawLinkType,
    hasPdpUrl: Boolean(shoppingHintUrl),
    usedSearchFallback: resolvedUrls.usedSearchFallback,
    rawLinkPreview: rawLink?.slice(0, 160) ?? null,
    shoppingHintPreview: shoppingHintUrl?.slice(0, 160) ?? null,
  });

  return out;
}

type FetchOutcome = {
  candidates: CandidateProduct[];
  diagnostics: ProviderSearchDiagnostics;
};

async function fetchShoppingForQuery(
  query: string,
  limit: number
): Promise<FetchOutcome> {
  const serperRes = await fetchSerperShoppingJson(query);
  let sourceAdapter: ShoppingSourceAdapterId = "serper";
  let hints: string[] = ["serper"];
  let payload: unknown | null = serperRes?.payload ?? null;
  let rawResponseByteLength = serperRes?.rawTextLength ?? 0;

  if (payload == null) {
    const serpapiRes = await fetchSerpApiShoppingJson(query);
    sourceAdapter = "serpapi";
    hints = ["serpapi"];
    payload = serpapiRes?.payload ?? null;
    rawResponseByteLength = serpapiRes?.rawTextLength ?? 0;
  }

  if (payload == null) {
    return {
      candidates: [],
      diagnostics: {
        store: "google_shopping",
        query,
        fetchOk: false,
        httpStatus: null,
        byteLength: 0,
        candidateCount: 0,
        hints: ["no_shopping_api_key_or_failed"],
      },
    };
  }

  const data = typeof payload === "object" && payload !== null ? payload : null;
  const rows = normalizeShoppingRows(payload);

  if (process.env.DEBUG_COMPARE === "true" && hints[0] === "serper") {
    const items = extractRawSerperShoppingItems(payload);
    console.log("[SERPER_TOTAL_ITEMS]", items.length);
    const firstItem = items[0];
    if (firstItem != null && typeof firstItem === "object" && !Array.isArray(firstItem)) {
      console.log("[SERPER_ROW_KEYS]", Object.keys(firstItem as Record<string, unknown>));
    }
    const preview = items.slice(0, 3).map((it) =>
      typeof it === "object" && it !== null && !Array.isArray(it)
        ? Object.fromEntries(
            Object.entries(it as Record<string, unknown>).map(([k, v]) => [
              k,
              typeof v === "string" ? v.slice(0, 120) : v,
            ])
          )
        : it
    );
    console.log("[SERPER_RAW_ITEMS_PREVIEW]", preview);
  }

  const parsedItems = rows
    .map(parsedItemFromShoppingRow)
    .filter((x): x is ParsedSerpShoppingItem => x != null);

  if (process.env.DEBUG_COMPARE === "true" && hints[0] === "serpapi") {
    console.log("[serpapi_raw_keys]", Object.keys(data ?? {}));
    console.log("[serpapi_items_found]", parsedItems.length);
    const first = parsedItems[0];
    console.log("[serpapi_first_item]", first
      ? {
          title: first.title?.slice(0, 100),
          price: first.price,
          link: typeof first.link === "string" ? first.link.slice(0, 120) : first.link,
        }
      : null);
  }

  const out: CandidateProduct[] = [];

  for (const row of rows) {
    const c = rowToCandidate(row, query, sourceAdapter);
    if (c) out.push(c);
    if (out.length >= limit) break;
  }

  const deduped = dedupeIdenticalListingUrls(out);

  return {
    candidates: deduped.slice(0, limit),
    diagnostics: {
      store: "google_shopping",
      query,
      fetchOk: true,
      httpStatus: 200,
      byteLength: rawResponseByteLength,
      candidateCount: deduped.length,
      hints,
    },
  };
}

/**
 * Issue progressively broader shopping queries until we collect enough merchant PDP rows.
 */
export async function fetchGoogleShoppingCandidatesWithDiagnostics(
  queries: string[],
  ctx: ProviderSearchContext,
  opts?: { perQueryLimit?: number; totalLimit?: number }
): Promise<{
  candidates: CandidateProduct[];
  diagnostics: ProviderSearchDiagnostics[];
  queriesTried: string[];
}> {
  const perQueryLimit = opts?.perQueryLimit ?? 24;
  const totalLimit = opts?.totalLimit ?? 48;

  const merged: CandidateProduct[] = [];
  const diagnostics: ProviderSearchDiagnostics[] = [];
  const queriesTried: string[] = [];

  for (const q of queries) {
    const qq = q.replace(/\s+/g, " ").trim();
    if (qq.length < 4) continue;
    if (queriesTried.includes(qq)) continue;
    queriesTried.push(qq);

    void ctx;
    const { candidates, diagnostics: d } = await fetchShoppingForQuery(qq, perQueryLimit);
    diagnostics.push(d);
    merged.push(...candidates);
    const deduped = dedupeIdenticalListingUrls(merged);
    merged.length = 0;
    merged.push(...deduped);
    if (merged.length >= totalLimit) break;
  }

  return {
    candidates: merged.slice(0, totalLimit),
    diagnostics,
    queriesTried,
  };
}

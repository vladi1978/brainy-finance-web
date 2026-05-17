import { buildNormalizedProduct, detectStoreFromProductUrl } from "./normalize";
import { isProductDetailStoreKey, isValidProductDetailUrl } from "./productDetailUrl";
import type {
  CandidateProduct,
  ProviderSearchContext,
  ProviderSearchDiagnostics,
} from "./types";

function shoppingLog(payload: Record<string, unknown>): void {
  if (process.env.PRODUCT_SHOPPING_DEBUG !== "1") return;
  console.log("[google-shopping]", payload);
}

const DISALLOW_HOST_SUBSTR = [
  "google.com",
  "googleusercontent.com",
  "gstatic.com",
  "schema.org",
];

function parsePriceLoose(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const cleaned = String(raw).replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Unwrap nested Google redirect URLs and decode common `url` / `q` parameters.
 */
export function unwrapMerchantUrl(raw: string, depth = 0): string | null {
  if (depth > 6) return null;
  const t = raw.trim();
  if (!t.startsWith("http")) return null;

  try {
    const u = new URL(t);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();

    if (host === "google.com" || host.endsWith(".google.com")) {
      const nested =
        u.searchParams.get("url") ||
        u.searchParams.get("q") ||
        u.searchParams.get("adurl");
      if (nested?.startsWith("http")) {
        try {
          return unwrapMerchantUrl(decodeURIComponent(nested), depth + 1);
        } catch {
          return unwrapMerchantUrl(nested, depth + 1);
        }
      }
      /** Pure Shopping product pages are not merchant PDPs — drop them. */
      if (u.pathname.includes("/shopping")) return null;
      return null;
    }

    for (const bad of DISALLOW_HOST_SUBSTR) {
      if (host === bad || host.endsWith(`.${bad}`)) return null;
    }

    return u.toString();
  } catch {
    return null;
  }
}

function pickRawLink(row: Record<string, unknown>): string | null {
  const keys = [
    "link",
    "product_link",
    "product_link_cleaned",
    "direct_link",
    "merchant_link",
    "offer_url",
    "source_link",
    "url",
  ];
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.startsWith("http")) return v;
  }
  return null;
}

function normalizeShoppingRows(payload: unknown): Record<string, unknown>[] {
  if (payload == null || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;

  const tryArrays = [
    root.shopping,
    root.shopping_results,
    (root as { items?: unknown }).items,
  ];

  for (const arr of tryArrays) {
    if (Array.isArray(arr)) {
      return arr.filter((x): x is Record<string, unknown> => x != null && typeof x === "object");
    }
  }
  return [];
}

async function fetchSerperShoppingJson(query: string): Promise<unknown | null> {
  const apiKey = process.env.SERPER_API_KEY?.trim();
  if (!apiKey) return null;

  const endpoint =
    process.env.PRODUCT_SERPER_SHOPPING_URL?.trim() ?? "https://google.serper.dev/shopping";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      gl: process.env.PRODUCT_SHOPPING_GL?.trim() ?? "us",
      hl: process.env.PRODUCT_SHOPPING_HL?.trim() ?? "en",
    }),
  });

  const httpStatus = res.status;
  const text = await res.text();
  shoppingLog({
    provider: "serper",
    httpStatus,
    queryPreview: query.slice(0, 120),
    byteLength: text.length,
  });

  if (!res.ok) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function fetchSerpApiShoppingJson(query: string): Promise<unknown | null> {
  const apiKey = process.env.SERPAPI_API_KEY?.trim();
  if (!apiKey) return null;

  const u = new URL("https://serpapi.com/search.json");
  u.searchParams.set("engine", "google_shopping");
  u.searchParams.set("q", query);
  u.searchParams.set("api_key", apiKey);
  u.searchParams.set("gl", process.env.PRODUCT_SHOPPING_GL?.trim() ?? "us");
  u.searchParams.set("hl", process.env.PRODUCT_SHOPPING_HL?.trim() ?? "en");

  const res = await fetch(u.toString());
  const httpStatus = res.status;
  const text = await res.text();
  shoppingLog({
    provider: "serpapi",
    httpStatus,
    queryPreview: query.slice(0, 120),
    byteLength: text.length,
  });

  if (!res.ok) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function rowToCandidate(
  row: Record<string, unknown>,
  searchQuery: string
): CandidateProduct | null {
  const title =
    typeof row.title === "string"
      ? row.title
      : typeof row.name === "string"
        ? row.name
        : null;
  if (!title || title.length < 3) return null;

  const rawLink = pickRawLink(row);
  if (!rawLink) return null;

  const productUrl = unwrapMerchantUrl(rawLink);
  if (!productUrl) return null;

  const store = detectStoreFromProductUrl(productUrl);
  if (!store) return null;
  if (!isProductDetailStoreKey(store)) return null;
  if (!isValidProductDetailUrl(store, productUrl)) return null;

  const priceRaw =
    typeof row.price === "string"
      ? row.price
      : typeof row.extracted_price === "number"
        ? String(row.extracted_price)
        : typeof row.extracted_price === "string"
          ? row.extracted_price
          : null;
  const price = parsePriceLoose(priceRaw);

  const imageUrl =
    typeof row.imageUrl === "string"
      ? row.imageUrl
      : typeof row.thumbnail === "string"
        ? row.thumbnail
        : typeof row.image === "string"
          ? row.image
          : null;

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

  return {
    store,
    title,
    price,
    currency: "USD",
    productUrl,
    affiliateUrl: productUrl,
    imageUrl,
    normalized,
    sourceConfidence,
  };
}

function dedupeCandidates(items: CandidateProduct[]): CandidateProduct[] {
  const map = new Map<string, CandidateProduct>();
  for (const item of items) {
    const key = item.productUrl.split("?")[0].toLowerCase();
    const prev = map.get(key);
    if (
      !prev ||
      (item.price ?? Number.POSITIVE_INFINITY) < (prev.price ?? Number.POSITIVE_INFINITY)
    ) {
      map.set(key, item);
    }
  }
  return [...map.values()];
}

type FetchOutcome = {
  candidates: CandidateProduct[];
  diagnostics: ProviderSearchDiagnostics;
};

async function fetchShoppingForQuery(
  query: string,
  limit: number
): Promise<FetchOutcome> {
  let payload = await fetchSerperShoppingJson(query);
  let hints: string[] = ["serper"];

  if (payload == null) {
    payload = await fetchSerpApiShoppingJson(query);
    hints = ["serpapi"];
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

  const rows = normalizeShoppingRows(payload);
  const out: CandidateProduct[] = [];

  for (const row of rows) {
    const c = rowToCandidate(row, query);
    if (c) out.push(c);
    if (out.length >= limit) break;
  }

  const deduped = dedupeCandidates(out);

  return {
    candidates: deduped.slice(0, limit),
    diagnostics: {
      store: "google_shopping",
      query,
      fetchOk: true,
      httpStatus: 200,
      byteLength: JSON.stringify(payload).length,
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
    const deduped = dedupeCandidates(merged);
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

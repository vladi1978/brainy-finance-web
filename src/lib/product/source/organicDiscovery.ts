import {
  isClearlyHomepageOrCategoryOnly,
  isProductDetailStoreKey,
  isProductLikeRetailerUrl,
  isStrictProductDetailUrl,
  type ProductDetailStoreKey,
} from "../productDetailUrl";
import type { UniversalStoreId } from "../types";
import {
  isUniversalPdpCandidateUrl,
  isUniversalRetailerSearchUrl,
  pickBestUniversalPdpFromCandidates,
  type UniversalSearchPdpPick,
} from "../universalSearchToPdp";

type SerperOrganicRow = {
  title?: string;
  link?: string;
  snippet?: string;
};

function normHost(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

function hostMatchesRetailerHost(url: string, retailerHost: string): boolean {
  try {
    const host = normHost(new URL(url.trim()).hostname);
    const want = normHost(retailerHost);
    return host === want || host.endsWith(`.${want}`);
  } catch {
    return false;
  }
}

async function fetchSerperWebSearchOrganic(
  query: string
): Promise<SerperOrganicRow[]> {
  const apiKey = process.env.SERPER_API_KEY?.trim();
  if (!apiKey) return [];

  const endpoint =
    process.env.PRODUCT_SERPER_SEARCH_URL?.trim() ??
    "https://google.serper.dev/search";

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
      num: 10,
    }),
  });

  if (!res.ok) return [];

  try {
    const payload = (await res.json()) as {
      organic?: SerperOrganicRow[];
    };
    return Array.isArray(payload.organic) ? payload.organic : [];
  } catch {
    return [];
  }
}

/** `site:{retailerHost} "{title}"` — universal organic PDP discovery query. */
export function buildOrganicPdpSerpQuery(args: {
  retailerHost: string;
  candidateTitle: string;
}): string {
  const host = normHost(args.retailerHost);
  const title = args.candidateTitle.replace(/["']/g, "").replace(/\s+/g, " ").trim();
  return `site:${host} "${title || "product"}"`;
}

function isRejectedNonPdpUrl(
  store: UniversalStoreId,
  url: string,
  retailerHost: string
): boolean {
  const trimmed = url.trim();
  if (!trimmed.startsWith("http")) return true;
  if (!hostMatchesRetailerHost(trimmed, retailerHost)) return true;
  if (isUniversalRetailerSearchUrl(trimmed)) return true;

  try {
    const u = new URL(trimmed);
    const path = u.pathname.replace(/\/+$/, "");
    if (path === "" || path === "/") return true;
    if (path.toLowerCase().includes("/category")) return true;
  } catch {
    return true;
  }

  if (isProductDetailStoreKey(store)) {
    if (isClearlyHomepageOrCategoryOnly(store as ProductDetailStoreKey, trimmed)) {
      return true;
    }
  }

  return false;
}

function isAcceptedOrganicPdpUrl(
  store: UniversalStoreId,
  url: string,
  retailerHost: string
): boolean {
  if (isRejectedNonPdpUrl(store, url, retailerHost)) return false;

  if (isProductDetailStoreKey(store)) {
    const key = store as ProductDetailStoreKey;
    return (
      isStrictProductDetailUrl(key, url) || isProductLikeRetailerUrl(key, url)
    );
  }

  return isUniversalPdpCandidateUrl(url, { searchPageHost: retailerHost });
}

function confidenceForPdpUrl(
  store: UniversalStoreId,
  productUrl: string,
  matchScore: number
): "medium" | "high" {
  if (isProductDetailStoreKey(store) && isStrictProductDetailUrl(store, productUrl)) {
    return "high";
  }
  if (matchScore >= 0.55) return "high";
  return "medium";
}

/**
 * Serper `site:{domain} "{title}"` → retailer PDP (no Google Shopping URL dependency).
 */
export async function resolveOrganicPdpDiscovery(args: {
  store: UniversalStoreId;
  retailerHost: string;
  candidateTitle: string;
  brandHint?: string | null;
  enrichedTitle?: string;
}): Promise<UniversalSearchPdpPick | null> {
  const retailerHost = normHost(args.retailerHost);
  if (!retailerHost) return null;

  const titleForQuery =
    args.enrichedTitle?.trim() || args.candidateTitle.trim();
  const query = buildOrganicPdpSerpQuery({
    retailerHost,
    candidateTitle: titleForQuery,
  });

  const organic = await fetchSerperWebSearchOrganic(query);
  if (organic.length === 0) return null;

  const picks: { productUrl: string; anchorText: string }[] = [];
  for (const row of organic) {
    const link = typeof row.link === "string" ? row.link.trim() : "";
    if (!link) continue;
    if (!isAcceptedOrganicPdpUrl(args.store, link, retailerHost)) continue;
    const anchorText =
      (typeof row.title === "string" && row.title.trim()) ||
      (typeof row.snippet === "string" && row.snippet.trim().slice(0, 200)) ||
      "";
    picks.push({ productUrl: link, anchorText });
  }

  if (picks.length === 0) return null;

  const best = pickBestUniversalPdpFromCandidates({
    candidateTitle: args.candidateTitle,
    brandHint: args.brandHint,
    store: args.store,
    picks,
  });

  if (!best) return null;

  return {
    ...best,
    confidence: confidenceForPdpUrl(args.store, best.productUrl, best.matchScore),
  };
}

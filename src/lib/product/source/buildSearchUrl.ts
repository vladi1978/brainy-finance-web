import type { StoreId } from "../types";
import { shortenSearchQuery, truncateAtWordBoundary } from "../shortenSearchQuery";

function prepareRetailerSearchQuery(title: string, maxDecoded: number): string {
  let q = shortenSearchQuery(title, maxDecoded);
  q = q.replace(/["'`]/g, "");
  q = truncateAtWordBoundary(q.replace(/\s+/g, " ").trim(), maxDecoded);
  if (!q.trim()) {
    q = truncateAtWordBoundary(
      title.replace(/\s+/g, " ").trim().replace(/["'`]/g, ""),
      maxDecoded,
    );
  }
  return q;
}

/** Extract search query from Tractor Supply URLs (canonical or legacy SERP paths). */
function tractorSupplySearchQuery(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (!u.hostname.toLowerCase().includes("tractorsupply.com")) return null;
    for (const key of ["keyword", "q", "searchTerm", "Ntt", "ntt", "query"]) {
      const v = u.searchParams.get(key)?.trim();
      if (v) return v;
    }
    return null;
  } catch {
    return null;
  }
}

/** Canonical Tractor Supply search URL. */
export function canonicalizeTractorSupplySearchUrl(
  url: string,
  queryFallback?: string
): string {
  const q = tractorSupplySearchQuery(url) ?? queryFallback?.trim();
  if (!q) return url.trim();
  const prepared = prepareRetailerSearchQuery(q, 60);
  return `https://www.tractorsupply.com/tsc/search?keyword=${encodeURIComponent(prepared || q)}`;
}

/**
 * Retailer search URL using a shortened listing title (honest fallback when no PDP is found).
 */
export function buildRetailerSearchUrlFromTitle(store: StoreId, title: string): string {
  const maxDecoded = store === "bestbuy" ? 50 : 60;
  const q = prepareRetailerSearchQuery(title, maxDecoded);
  const enc = encodeURIComponent(q || " ");
  switch (store) {
    case "amazon":
      return `https://www.amazon.com/s?k=${enc}`;
    case "walmart":
      return `https://www.walmart.com/search?q=${enc}`;
    case "target":
      return `https://www.target.com/s?searchTerm=${enc}`;
    case "temu":
      return `https://www.temu.com/search_result.html?search_key=${enc}`;
    case "bestbuy":
      return `https://www.bestbuy.com/site/searchpage.jsp?st=${enc}`;
    case "homedepot":
      return `https://www.homedepot.com/s/${enc}`;
    case "lowes":
      return `https://www.lowes.com/search?searchTerm=${enc}`;
    case "costco":
      return `https://www.costco.com/CatalogSearch?keyword=${enc}`;
    case "samsclub":
      return `https://www.samsclub.com/search?searchTerm=${enc}`;
    case "ebay":
      return `https://www.ebay.com/sch/i.html?_nkw=${enc}`;
    case "macys":
      return `https://www.macys.com/shop/featured/${enc}`;
    case "kohls":
      return `https://www.kohls.com/search/results.jsp?search=${enc}`;
    case "wayfair":
      return `https://www.wayfair.com/keyword.php?keyword=${enc}`;
    case "overstock":
      return `https://www.overstock.com/search?keywords=${enc}`;
    case "chewy":
      return `https://www.chewy.com/s?query=${enc}`;
    case "academy":
      return `https://www.academy.com/search?q=${enc}`;
    case "tractorsupply":
      return canonicalizeTractorSupplySearchUrl(
        `https://www.tractorsupply.com/tsc/search?keyword=${enc}`,
        q,
      );
    case "nike":
      return `https://www.nike.com/w?q=${enc}`;
    case "adidas":
      return `https://www.adidas.com/us/search?q=${enc}`;
    default:
      return "";
  }
}

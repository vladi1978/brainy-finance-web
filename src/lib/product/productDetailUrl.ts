import type { StoreId } from "./types";

/** Retailers with PDP heuristics — mirrors {@link StoreId}. */
export type ProductDetailStoreKey = StoreId;

const PDP_STORE_KEYS = new Set<string>([
  "amazon",
  "walmart",
  "target",
  "temu",
  "bestbuy",
  "homedepot",
  "lowes",
]);

export function isProductDetailStoreKey(s: string): s is ProductDetailStoreKey {
  return PDP_STORE_KEYS.has(s);
}

function normHost(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

function searchParamsHasInsensitive(sp: URLSearchParams, want: string): boolean {
  const w = want.toLowerCase();
  for (const k of sp.keys()) {
    if (k.toLowerCase() === w) return true;
  }
  return false;
}

function demoHostMatchesStore(store: ProductDetailStoreKey, host: string): boolean {
  return host === `${store}.example.com`;
}

function hostMatchesStoreKey(store: ProductDetailStoreKey, host: string): boolean {
  if (demoHostMatchesStore(store, host)) return true;
  switch (store) {
    case "amazon":
      return (
        /^amazon\.[a-z.]+$/.test(host) ||
        host.endsWith(".amazon.com") ||
        host.endsWith(".amazon.co.jp")
      );
    case "walmart":
      return host === "walmart.com";
    case "target":
      return host === "target.com";
    case "temu":
      return host.endsWith("temu.com");
    case "bestbuy":
      return host.endsWith("bestbuy.com");
    case "homedepot":
      return host.endsWith("homedepot.com");
    case "lowes":
      return host.endsWith("lowes.com");
    default:
      return false;
  }
}

function searchParamValueInsensitive(sp: URLSearchParams, name: string): string | null {
  const w = name.toLowerCase();
  for (const [k, v] of sp) {
    if (k.toLowerCase() === w) return v;
  }
  return null;
}

/**
 * Store search URLs accepted when Google Shopping rows lack merchant PDP links.
 */
export function isRetailerSearchLandingUrl(
  store: ProductDetailStoreKey,
  u: URL
): boolean {
  const path = u.pathname;
  const pl = path.toLowerCase();

  switch (store) {
    case "amazon": {
      if (pl !== "/s" && !pl.startsWith("/s/")) return false;
      const k = searchParamValueInsensitive(u.searchParams, "k");
      return Boolean(k?.trim());
    }
    case "walmart": {
      if (pl !== "/search" && !pl.startsWith("/search/")) return false;
      const q = searchParamValueInsensitive(u.searchParams, "q");
      return Boolean(q?.trim());
    }
    case "bestbuy": {
      if (!pl.includes("searchpage.jsp")) return false;
      const st = searchParamValueInsensitive(u.searchParams, "st");
      return Boolean(st?.trim());
    }
    case "target": {
      if (pl !== "/s") return false;
      const term = searchParamValueInsensitive(u.searchParams, "searchterm");
      return Boolean(term?.trim());
    }
    case "homedepot": {
      const m = path.match(/^\/s\/(.+)/i);
      return Boolean(m?.[1]?.trim());
    }
    case "temu": {
      if (!pl.includes("search_result.html")) return false;
      const sk = searchParamValueInsensitive(u.searchParams, "search_key");
      return Boolean(sk?.trim());
    }
    case "lowes": {
      const plNorm = pl.replace(/\/+$/, "");
      if (plNorm !== "/search" && !plNorm.startsWith("/search?")) return false;
      const term = searchParamValueInsensitive(u.searchParams, "searchterm");
      return Boolean(term?.trim());
    }
    default:
      return false;
  }
}

function isDemoPdpPlaceholder(host: string, pathname: string): boolean {
  return /\.example\.com$/i.test(host) && pathname.toLowerCase().startsWith("/p/");
}

function universalBadRetailUrl(u: URL): boolean {
  const href = u.href.toLowerCase();
  const path = u.pathname.toLowerCase();
  const sp = u.searchParams;
  const host = normHost(u.hostname);

  if (host === "a.co" || host === "amzn.to") return true;

  if (href.includes("/gp/slredirect") || path.includes("/gp/slredirect")) return true;
  if (/slredirect/i.test(href)) return true;

  /** Block Google Shopping / search / redirect hops — we only surface merchant PDPs. */
  if (host === "google.com" || host.endsWith(".google.com")) {
    if (
      path.includes("/shopping") ||
      path === "/url" ||
      path.startsWith("/search") ||
      path.startsWith("/imgres")
    ) {
      return true;
    }
  }

  if (path.includes("/redirect") || /\/rd\//i.test(path)) return true;

  if (path === "/search" || path.startsWith("/search?") || path.startsWith("/search/"))
    return true;

  if (path === "/s" || path.startsWith("/s/")) {
    if (
      searchParamsHasInsensitive(sp, "k") ||
      searchParamsHasInsensitive(sp, "field-keywords") ||
      searchParamsHasInsensitive(sp, "searchterm") ||
      searchParamsHasInsensitive(sp, "search_term")
    ) {
      return true;
    }
  }

  if (path.includes("search_result")) return true;
  if (path.includes("searchpage.jsp")) return true;

  if ((path.startsWith("/b/") || path === "/b") && sp.has("node")) return true;
  if (path.startsWith("/gp/browse")) return true;

  if (
    path.includes("/cart") ||
    path.includes("/checkout") ||
    path.includes("/buybucket")
  ) {
    return true;
  }

  return false;
}

function amazonPdpPath(path: string): boolean {
  return (
    /\/dp\/[a-z0-9]{10}\b/i.test(path) ||
    /\/gp\/product\/[a-z0-9]{10}\b/i.test(path) ||
    /\/exec\/obidos\/asin\/[a-z0-9]{10}\b/i.test(path)
  );
}

function walmartPdpPath(path: string): boolean {
  if (!/^\/ip\//i.test(path)) return false;
  if (/^\/ip\/search/i.test(path)) return false;
  const rest = path.slice(4);
  return rest.length >= 3;
}

function targetPdpPath(path: string): boolean {
  return /\/p\/[^/]+\/-\/a-\d+/i.test(path);
}

function temuPdpPath(path: string): boolean {
  if (!/\.html$/i.test(path)) return false;
  const leaf = path.split("/").pop() ?? "";
  return leaf.length > 5 && !/search/i.test(leaf);
}

function bestbuyPdpPath(path: string): boolean {
  return /^\/site\/[^/]+\/\d+\.p\b/i.test(path);
}

function homedepotPdpPath(path: string): boolean {
  return /^\/p\/[^/]+\/[^/]+/i.test(path);
}

function lowesPdpPath(path: string): boolean {
  return /^\/pd\/[^/]+\/\d+/i.test(path);
}

/** True only for retailer-hosted product detail paths (never search/category landing pages). */
export function isStrictProductDetailUrl(
  store: ProductDetailStoreKey,
  url: string
): boolean {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }

  if (!/^https?:$/i.test(u.protocol)) return false;

  const host = normHost(u.hostname);

  if (universalBadRetailUrl(u)) return false;

  const path = u.pathname;

  if (isDemoPdpPlaceholder(host, path)) {
    return demoHostMatchesStore(store, host);
  }

  if (!hostMatchesStoreKey(store, host)) return false;

  switch (store) {
    case "amazon":
      return amazonPdpPath(path);
    case "walmart":
      return walmartPdpPath(path);
    case "target":
      return targetPdpPath(path);
    case "temu":
      return temuPdpPath(path);
    case "bestbuy":
      return bestbuyPdpPath(path);
    case "homedepot":
      return homedepotPdpPath(path);
    case "lowes":
      return lowesPdpPath(path);
    default:
      return false;
  }
}

/**
 * Retailer-hosted search/browse URL (same heuristics as {@link isValidProductDetailUrl} search paths,
 * restricted to matching store host — unlike {@link isValidProductDetailUrl}, does not classify PDPs.)
 */
export function isRetailerSearchUrl(store: ProductDetailStoreKey, url: string): boolean {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }

  if (!/^https?:$/i.test(u.protocol)) return false;

  const host = normHost(u.hostname);
  if (!hostMatchesStoreKey(store, host)) return false;

  const hrefLower = u.href.toLowerCase();
  if (
    hrefLower.includes("/search") ||
    hrefLower.includes("searchterm") ||
    hrefLower.includes("?q=") ||
    hrefLower.includes("&q=") ||
    hrefLower.includes("?k=") ||
    hrefLower.includes("&k=") ||
    hrefLower.includes("?st=") ||
    hrefLower.includes("&st=") ||
    hrefLower.includes("_nkw=")
  ) {
    return true;
  }

  return isRetailerSearchLandingUrl(store, u);
}

/**
 * True when `url` is a retailer product detail page or an allowed store search fallback
 * (used when Shopping APIs only return Google hops), for `store`.
 */
export function isValidProductDetailUrl(
  store: ProductDetailStoreKey,
  url: string
): boolean {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }

  if (!/^https?:$/i.test(u.protocol)) return false;

  const hrefLower = u.href.toLowerCase();
  if (
    hrefLower.includes("/search") ||
    hrefLower.includes("searchterm") ||
    hrefLower.includes("?q=") ||
    hrefLower.includes("?k=") ||
    hrefLower.includes("?st=") ||
    hrefLower.includes("_nkw=")
  ) {
    return true;
  }

  const host = normHost(u.hostname);

  if (hostMatchesStoreKey(store, host) && isRetailerSearchLandingUrl(store, u)) {
    return true;
  }

  if (universalBadRetailUrl(u)) return false;

  const path = u.pathname;

  if (isDemoPdpPlaceholder(host, path)) {
    return demoHostMatchesStore(store, host);
  }

  if (!hostMatchesStoreKey(store, host)) return false;

  switch (store) {
    case "amazon":
      return amazonPdpPath(path);
    case "walmart":
      return walmartPdpPath(path);
    case "target":
      return targetPdpPath(path);
    case "temu":
      return temuPdpPath(path);
    case "bestbuy":
      return bestbuyPdpPath(path);
    case "homedepot":
      return homedepotPdpPath(path);
    case "lowes":
      return lowesPdpPath(path);
    default:
      return false;
  }
}

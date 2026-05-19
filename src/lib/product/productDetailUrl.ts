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
  "costco",
  "samsclub",
  "ebay",
  "macys",
  "kohls",
  "wayfair",
  "overstock",
  "chewy",
  "academy",
  "tractorsupply",
  "nike",
  "adidas",
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
    case "costco":
      return host.endsWith("costco.com");
    case "samsclub":
      return host.endsWith("samsclub.com");
    case "ebay":
      return host.endsWith("ebay.com");
    case "macys":
      return host.endsWith("macys.com");
    case "kohls":
      return host.endsWith("kohls.com");
    case "wayfair":
      return host.endsWith("wayfair.com");
    case "overstock":
      return host.endsWith("overstock.com");
    case "chewy":
      return host.endsWith("chewy.com");
    case "academy":
      return host.endsWith("academy.com");
    case "tractorsupply":
      return host.endsWith("tractorsupply.com");
    case "nike":
      return host.endsWith("nike.com");
    case "adidas":
      return host.endsWith("adidas.com") || host.endsWith("adidas.us");
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
    case "costco": {
      if (!pl.includes("catalogsearch")) return false;
      const kw = searchParamValueInsensitive(u.searchParams, "keyword");
      return Boolean(kw?.trim());
    }
    case "samsclub": {
      if (!pl.includes("search")) return false;
      const st = searchParamValueInsensitive(u.searchParams, "searchterm");
      return Boolean(st?.trim());
    }
    case "ebay": {
      if (!pl.includes("/sch/")) return false;
      const nkw = searchParamValueInsensitive(u.searchParams, "_nkw");
      return Boolean(nkw?.trim());
    }
    case "macys": {
      if (!pl.includes("/shop/")) return false;
      return path.length > 8;
    }
    case "kohls": {
      if (!pl.includes("search")) return false;
      const s = searchParamValueInsensitive(u.searchParams, "search");
      return Boolean(s?.trim());
    }
    case "wayfair": {
      if (!pl.includes("keyword.php")) return false;
      const kw = searchParamValueInsensitive(u.searchParams, "keyword");
      return Boolean(kw?.trim());
    }
    case "overstock": {
      if (!pl.includes("search")) return false;
      const kw = searchParamValueInsensitive(u.searchParams, "keywords");
      return Boolean(kw?.trim());
    }
    case "chewy": {
      if (pl !== "/s" && !pl.startsWith("/s/")) return false;
      const q = searchParamValueInsensitive(u.searchParams, "query");
      return Boolean(q?.trim());
    }
    case "academy": {
      if (!pl.includes("search")) return false;
      const q = searchParamValueInsensitive(u.searchParams, "q");
      return Boolean(q?.trim());
    }
    case "tractorsupply": {
      if (!pl.includes("/tsc/search")) return false;
      const q = searchParamValueInsensitive(u.searchParams, "q");
      return Boolean(q?.trim());
    }
    case "nike": {
      if (pl !== "/w" && !pl.startsWith("/w/")) return false;
      const q = searchParamValueInsensitive(u.searchParams, "q");
      return Boolean(q?.trim());
    }
    case "adidas": {
      if (!pl.includes("search")) return false;
      const q = searchParamValueInsensitive(u.searchParams, "q");
      return Boolean(q?.trim());
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

  if (path.includes("/account") || path.includes("/login")) return true;
  if (path.includes("/category")) return true;

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

function isHomepageOnlyRetailPath(u: URL): boolean {
  const p = u.pathname.replace(/\/+$/, "");
  return p === "" || p === "/";
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
 * Retailer-hosted search/browse URL (restricted to matching store host — does not classify PDPs.)
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

const PRODUCT_LIKE_PATH_FRAGMENTS = [
  "/product/",
  "/products/",
  "/p/",
  "/pd/",
  "/item/",
  "/items/",
  "/sku/",
  "/dp/",
  "/ip/",
  "/site/",
  "/itm/",
] as const;

const PRODUCT_LIKE_QUERY_KEYS = new Set([
  "productid",
  "itemid",
  "sku",
  "offerid",
  "model",
  "upc",
  "gtin",
]);

function pathHasProductLikeSignals(pathLower: string): boolean {
  for (const frag of PRODUCT_LIKE_PATH_FRAGMENTS) {
    if (pathLower.includes(frag)) return true;
  }
  return false;
}

function queryHasProductLikeSignals(sp: URLSearchParams): boolean {
  for (const k of sp.keys()) {
    if (PRODUCT_LIKE_QUERY_KEYS.has(k.toLowerCase())) return true;
  }
  return false;
}

/**
 * Product-like URL shape: more than a bare landing page (path depth / slug) plus at least one
 * PDP-ish path fragment or product id query key.
 */
function hasMeaningfulProductPathDepth(pathname: string): boolean {
  const trimmed = pathname.replace(/\/+$/, "");
  const segs = trimmed.split("/").filter(Boolean);
  if (segs.length >= 2) return true;
  if (segs.length === 1) {
    const leaf = segs[0];
    if (/\.html?$/i.test(leaf) && leaf.length >= 8) return true;
    return leaf.length >= 12;
  }
  return false;
}

/**
 * Safe blocklist + product-like heuristics for merchant URLs that are not strict PDP patterns.
 * Excludes retailer search/category/cart/account and Google hops — see {@link universalBadRetailUrl}.
 */
export function isProductLikeRetailerUrl(
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
    if (!demoHostMatchesStore(store, host)) return false;
    if (isHomepageOnlyRetailPath(u)) return false;
    return (
      hasMeaningfulProductPathDepth(path) &&
      (pathHasProductLikeSignals(path.toLowerCase()) ||
        queryHasProductLikeSignals(u.searchParams))
    );
  }

  if (!hostMatchesStoreKey(store, host)) return false;

  if (isHomepageOnlyRetailPath(u)) return false;

  const trimmed = url.trim();
  if (isRetailerSearchUrl(store, trimmed)) return false;

  const pathLower = path.toLowerCase();
  if (!hasMeaningfulProductPathDepth(path)) return false;
  return (
    pathHasProductLikeSignals(pathLower) || queryHasProductLikeSignals(u.searchParams)
  );
}

/**
 * True only for retailer-hosted **product detail** URLs (PDPs). Search/category/listing pages are false —
 * use {@link isValidStoreOutboundUrl} for Shopping pipeline outbound URLs until affiliate APIs land.
 */
export function isValidProductDetailUrl(
  store: ProductDetailStoreKey,
  url: string
): boolean {
  return isStrictProductDetailUrl(store, url);
}

/**
 * URLs safe to send users to the correct retailer host: strict PDPs, product-like merchant paths,
 * or known retailer search URLs (generated search URLs are built elsewhere).
 * Rejects empty/broken URLs, wrong-host links, and bare homepages.
 */
export function isValidStoreOutboundUrl(
  store: ProductDetailStoreKey,
  url: string
): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return false;
  }

  if (!/^https?:$/i.test(u.protocol)) return false;

  const host = normHost(u.hostname);
  if (!hostMatchesStoreKey(store, host)) return false;

  if (isHomepageOnlyRetailPath(u)) return false;

  /** PDP branch applies {@link universalBadRetailUrl}; search URLs intentionally bypass it (e.g. `/s?k=`). */
  if (isStrictProductDetailUrl(store, trimmed)) return true;

  if (isProductLikeRetailerUrl(store, trimmed)) return true;

  return isRetailerSearchUrl(store, trimmed);
}

/**
 * Outbound URLs for Google Shopping rows tied to merchants we do not map to {@link StoreId}:
 * HTTPS links with a non-root path, or `google.com/search?q=` fallbacks (never Shopping surfaces).
 */
export function isAcceptableUniversalShoppingOutboundUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return false;
  }

  if (!/^https?:$/i.test(u.protocol)) return false;

  const host = normHost(u.hostname);

  if (host === "google.com" || host.endsWith(".google.com")) {
    const pl = u.pathname.toLowerCase();
    if (!pl.startsWith("/search")) return false;
    const q = u.searchParams.get("q")?.trim();
    return Boolean(q && q.length >= 2);
  }

  if (
    host === "googleusercontent.com" ||
    host.endsWith(".googleusercontent.com") ||
    host === "gstatic.com" ||
    host.endsWith(".gstatic.com") ||
    host === "schema.org"
  ) {
    return false;
  }

  const path = u.pathname.replace(/\/+$/, "");
  if (path === "" || path === "/") return false;

  const plower = u.pathname.toLowerCase();
  if (
    plower.includes("/cart") ||
    plower.includes("/checkout") ||
    plower.includes("/buybucket")
  ) {
    return false;
  }

  return true;
}

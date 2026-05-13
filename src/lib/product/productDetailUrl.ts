import type { StoreId } from "./types";

/**
 * Registered retailers plus common US hosts we may wire later — PDP rules are enforced here.
 */
export type ProductDetailStoreKey =
  | StoreId
  | "bestbuy"
  | "homedepot"
  | "lowes";

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

/**
 * True when `url` looks like a retailer product detail page for `store`, not search/category/redirect.
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

  const host = normHost(u.hostname);
  const path = u.pathname;

  if (universalBadRetailUrl(u)) return false;

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

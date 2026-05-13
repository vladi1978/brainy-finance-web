import type { StoreId } from "./types";

const SHORT_EXPAND_HOST_SUFFIXES = [
  "a.co",
  "amzn.to",
  "bit.ly",
  "tinyurl.com",
];

const SHORT_URL_TIMEOUT_MS = 4500;

function hostnameIsKnownShort(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  return SHORT_EXPAND_HOST_SUFFIXES.some(
    (s) => h === s || h.endsWith(`.${s}`)
  );
}

async function probeFinalUrlViaFetch(
  href: string,
  method: "HEAD" | "GET"
): Promise<string | undefined> {
  try {
    const res = await fetch(href, {
      method,
      redirect: "follow",
      signal: AbortSignal.timeout(SHORT_URL_TIMEOUT_MS),
      headers:
        method === "GET"
          ? { Range: "bytes=0-0", Accept: "*/*" }
          : { Accept: "*/*" },
    });
    return res.url;
  } catch {
    return undefined;
  }
}

/**
 * Expand allowlisted retailer / generic short URLs to their final HTTPS target.
 * Logs are temporary instrumentation (short_url_*).
 *
 * Returns `null` when the input is not a known short URL, resolution fails,
 * or the URL does not change after probing.
 */
export async function expandKnownShortRetailUrl(
  httpUrlSansFragment: string
): Promise<string | null> {
  let normalized: URL;
  try {
    normalized = new URL(httpUrlSansFragment.trim());
  } catch {
    return null;
  }
  if (normalized.protocol !== "http:" && normalized.protocol !== "https:") {
    return null;
  }
  if (!hostnameIsKnownShort(normalized.hostname)) {
    return null;
  }

  const inputHref = normalized.href;
  const preview = () => ({
    preview: httpUrlSansFragment.trim().slice(0, 200),
  });

  console.log("[short_url_detected]", JSON.stringify({ ...preview() }));

  const canonHref = (h: string | undefined): string | null => {
    if (h == null) return null;
    try {
      return new URL(h).href;
    } catch {
      return null;
    }
  };

  let resolvedHref = await probeFinalUrlViaFetch(inputHref, "HEAD");
  if (
    resolvedHref == null ||
    canonHref(resolvedHref) === normalized.href
  ) {
    resolvedHref = await probeFinalUrlViaFetch(inputHref, "GET");
  }

  if (resolvedHref == null) {
    console.log(
      "[short_url_failed]",
      JSON.stringify({
        ...preview(),
        reason: "fetch_failed",
      })
    );
    return null;
  }

  let out: URL;
  try {
    out = new URL(resolvedHref.split("#")[0] ?? resolvedHref);
  } catch {
    console.log(
      "[short_url_failed]",
      JSON.stringify({ ...preview(), reason: "invalid_final_url" })
    );
    return null;
  }
  if (out.protocol !== "http:" && out.protocol !== "https:") {
    console.log(
      "[short_url_failed]",
      JSON.stringify({ ...preview(), reason: "non_http_final_protocol" })
    );
    return null;
  }
  if (out.href === inputHref || out.href === normalized.href) {
    console.log(
      "[short_url_failed]",
      JSON.stringify({ ...preview(), reason: "no_expansion" })
    );
    return null;
  }

  console.log(
    "[short_url_resolved]",
    JSON.stringify({
      from: inputHref.slice(0, 200),
      to: out.href.slice(0, 200),
    })
  );
  return out.href;
}

/**
 * Derive a human-readable product query from retailer URLs without scraping.
 * Used for search-first comparison (URL is not a trusted "source product").
 */

export function productQueryFromAmazonUrl(input: string): string {
  const m = input.match(/amazon\.[^/]+\/([^/]+)\/dp\/[A-Z0-9]{9,14}/i);
  if (m?.[1] && !/^dp$/i.test(m[1])) {
    try {
      return decodeURIComponent(m[1]).replace(/-/g, " ").trim();
    } catch {
      return m[1].replace(/-/g, " ").trim();
    }
  }
  const short = input.match(/\/dp\/([A-Z0-9]{10})/i);
  if (short) {
    return "";
  }
  return "";
}

export function productQueryFromWalmartUrl(input: string): string {
  return input
    .replace(/^https?:\/\/(www\.)?walmart\.com\/ip\//i, "")
    .replace(/\?.*$/, "")
    .replace(/\/\d{6,}\s*$/i, "")
    .replace(/-/g, " ")
    .replace(/\bip\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function productQueryFromTargetUrl(input: string): string {
  if (!/target\.com\/p\//i.test(input)) return "";
  return input
    .replace(/^https?:\/\/[^/]+\/p\//i, "")
    .replace(/\/-\/A-\d+.*$/i, "")
    .replace(/-/g, " ")
    .trim();
}

export function productQueryFromTemuUrl(input: string): string {
  try {
    const u = new URL(input);
    const seg = u.pathname.split("/").filter(Boolean);
    const last = seg[seg.length - 1];
    if (last && /\.html$/i.test(last)) {
      return decodeURIComponent(last.replace(/\.html$/i, "")).replace(/-/g, " ").trim();
    }
  } catch {
    /* ignore */
  }
  return "";
}

function detectUrlStore(raw: string): StoreId | null {
  const t = raw.trim();
  if (!/^https?:\/\//i.test(t)) return null;
  if (/\bamazon\.[a-z.]{2,}\b|\/\/a\.co\/|\/\/amzn\.to\//i.test(t)) return "amazon";
  if (/walmart\.com/i.test(t)) return "walmart";
  if (/target\.com/i.test(t)) return "target";
  if (/temu\.com/i.test(t)) return "temu";
  return null;
}

export type UrlDerivedQuery = {
  productQuery: string;
  store: StoreId | null;
};

/**
 * Best-effort product description string from a product page URL (slug/title segment only).
 */
export function extractProductQueryFromRetailUrl(url: string): UrlDerivedQuery {
  const store = detectUrlStore(url);
  let productQuery = "";
  if (store === "amazon") productQuery = productQueryFromAmazonUrl(url);
  else if (store === "walmart") productQuery = productQueryFromWalmartUrl(url);
  else if (store === "target") productQuery = productQueryFromTargetUrl(url);
  else if (store === "temu") productQuery = productQueryFromTemuUrl(url);

  return { productQuery, store };
}

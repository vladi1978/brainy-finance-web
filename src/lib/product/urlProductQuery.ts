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

/** Collapse hyphenated / underscored PDP slugs into a human shopping query. */
function slugToSpaces(raw: string): string {
  const s = raw.replace(/[+_]/g, " ").replace(/-/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

function tryDecode(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/** True when segment is SKU / opaque id noise, not descriptive text. */
function isOpaquePathSegment(seg: string): boolean {
  const s = seg.trim();
  if (s.length < 4) return true;
  if (/^[\d.-]+$/i.test(s)) return true;
  if (/^[a-z\d]{10}$/i.test(s)) return true;
  if (/^g-\d+$/i.test(s)) return true;
  if (/^-a-\d+$/i.test(s)) return true;

  /** Best Buy leaf: `6426149.p` */
  if (/^\d{5,}\.p$/i.test(s)) return true;

  /** File-like but not prose (e.g. product.html numeric prefix) — keep if has many letters */
  if (/\.(?:html|htm)$/i.test(s)) {
    const base = s.replace(/\.(?:html|htm)$/i, "");
    if (/^\d+[a-z0-9_-]*$/i.test(base)) return /^[\d_-]+$/i.test(base.replace(/-/g, ""));
  }

  if (!/[a-z]/i.test(s)) return true;
  /** Very short alphanumeric codes */
  if (s.length <= 5 && !/-|_|\s/.test(s) && /^\w+$/i.test(s))
    return /^\d+[a-z]?\d*$/i.test(s);
  return false;
}

/**
 * Amazon ASIN-shaped single token (10 chars: letter + digit + 8 alphanumeric).
 * Used to avoid using opaque IDs as shopping search queries.
 */
export function looksLikeAmazonAsinToken(s: string): boolean {
  const t = s.replace(/\s+/g, "").trim();
  return /^[A-Z]\d[A-Z0-9]{8}$/i.test(t);
}

/** True when derived query looks like hostname / site boilerplate rather than item text. */
export function isGenericRetailProductQuery(candidate: string): boolean {
  const t = slugToSpaces(tryDecode(candidate.trim()));
  if (!t || t.length < 4) return true;
  if (/^product$/i.test(t)) return true;

  const collapsed = t.toLowerCase().replace(/\s+/g, " ").trim();

  const siteOnlyPatterns: RegExp[] = [
    /^amazon(\s+\.|[\s.])(com|[a-z.]+)$/,
    /^walmart\s+com$/,
    /^target\s+com$/,
    /^best\s*buy$/,
    /^home\s+depot$/,
    /^lowe'?s$/,
    /^temu$/,
    /^temu\s+shop$/,
    /^(www\s+)?(amazon|walmart|target)\s+(com)$/,
    /^(shop|buy|browse|search)\s+/,
    /^(welcome|sign\s*in)$/i,
    /^gift\s*(cards)?$/i,
  ];
  if (siteOnlyPatterns.some((re) => re.test(collapsed))) return true;

  const tokens = collapsed.split(/\s+/).filter(Boolean);
  /** Only host-shaped tokens ("amazon","com","www") etc. */
  const stopHost = new Set([
    "www",
    "com",
    "co",
    "shop",
    "store",
    "amazon",
    "walmart",
    "target",
    "temu",
    "bestbuy",
    "best",
    "buy",
    "homdepot",
    "home",
    "depot",
    "lowes",
    "lowe",
    "s",
    "m",
    "http",
    "https",
    "html",
    "ip",
    "p",
    "pd",
    "site",
    "product",
    "products",
    "dp",
    "gp",
    "item",
    "shopping",
    "cart",
    "help",
    "ssl",
    "smile",
  ]);
  if (tokens.length > 0 && tokens.every((w) => stopHost.has(w))) return true;

  if (/^\d+$/.test(collapsed)) return true;

  if (tokens.length === 1 && looksLikeAmazonAsinToken(tokens[0]!)) return true;

  return false;
}

export function productQueryFromAmazonUrl(input: string): string {
  const pathMatch = input.match(
    /amazon\.[^/]+\/([^/]+)\/(?:dp|gp\/(?:product|aw\/d)|exec\/obidos\/asin)\//i
  );
  if (pathMatch?.[1]) {
    const seg = pathMatch[1];
    if (
      /^dp$/i.test(seg) ||
      /^(gp|exec|oauth|stores|wishlist|checkout|cart|browse|portal|homepage|mz|oauth2|apid|help|forum)$/i.test(
        seg
      )
    )
      return "";
    return slugToSpaces(decodeURIComponentSmart(seg));
  }
  return "";
}

function decodeURIComponentSmart(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function productQueryFromWalmartUrl(input: string): string {
  if (!/^https?:\/\/[^/]*walmart\.com\/ip\//i.test(input)) return "";
  const rest = input
    .replace(/^https?:\/\/(www\.)?walmart\.com\/ip\//i, "")
    .replace(/\?.*$/, "");
  /** `/ip/Product-Here/6223345` → first slug segment words */
  const parts = rest.split("/").filter(Boolean);
  let slugParts = [...parts];

  /** Drop trailing long numeric SKU id segment */
  if (slugParts.length > 0 && /^\d{5,}$/.test(slugParts[slugParts.length - 1]!))
    slugParts = slugParts.slice(0, -1);

  if (slugParts.length === 0) return "";

  const joined = slugToSpaces(slugParts.join(" "))
    .replace(/\bip\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return joined.length >= 3 ? joined : "";
}

export function productQueryFromTargetUrl(input: string): string {
  if (!/target\.com\/p\//i.test(input)) return "";
  try {
    const u = new URL(input);
    const path = u.pathname;
    /** `/p/Product-Slug/-/A-123` */
    const afterP = path.replace(/^\/p\//i, "");
    const first = afterP.split("/")[0]?.trim() ?? "";
    if (!first || first.length < 3) return "";
    return slugToSpaces(decodeURIComponentSmart(first));
  } catch {
    return input
      .replace(/^https?:\/\/[^/]+\/p\//i, "")
      .split("/")[0]!
      .replace(/-/g, " ")
      .trim();
  }
}

export function productQueryFromTemuUrl(input: string): string {
  try {
    const u = new URL(input);
    const seg = u.pathname.split("/").filter(Boolean);
    const last = seg[seg.length - 1];
    if (last && /\.html$/i.test(last)) {
      const base = last.replace(/\.html$/i, "");
      const q = slugToSpaces(tryDecode(base));
      return q.length >= 3 ? q : "";
    }
  } catch {
    /* ignore */
  }
  return "";
}

export function productQueryFromBestBuyUrl(input: string): string {
  if (!/bestbuy\.com/i.test(input)) return "";
  try {
    const u = new URL(input);
    const parts = u.pathname.split("/").filter(Boolean);
    const siteIx = parts.indexOf("site");
    if (siteIx >= 0 && parts[siteIx + 1]) {
      const slug = parts[siteIx + 1]!;
      const q = slugToSpaces(slug.replace(/\.p$/i, ""));
      return q.length >= 3 ? q : "";
    }
  } catch {
    /* ignore */
  }
  return "";
}

/** Home Depot PDP: `/p/Description-Frag/ModelSlug` → join descriptive chunks */
export function productQueryFromHomeDepotUrl(input: string): string {
  try {
    const u = new URL(input);
    if (!/[.]homedepot[.]com$/i.test(u.hostname.replace(/^www\./, ""))) {
      return "";
    }

    const segs = u.pathname.split("/").filter(Boolean);
    const pIx = segs.indexOf("p");
    const after = pIx >= 0 ? segs.slice(pIx + 1) : [];
    const words = after
      .filter((seg) => !isOpaquePathSegment(seg))
      .map((s) => slugToSpaces(tryDecode(s)));
    const joined = words.join(" ").replace(/\s+/g, " ").trim();
    return joined.length >= 4 ? joined : "";
  } catch {
    return "";
  }
}

export function productQueryFromLowesUrl(input: string): string {
  if (!/lowes\.com/i.test(input)) return "";
  try {
    const u = new URL(input);
    const parts = u.pathname.split("/").filter(Boolean);
    const pdIx = parts.indexOf("pd");
    /** `/pd/Product-Slug/itemId` → first prose segment */
    const slug = pdIx >= 0 && parts[pdIx + 1] ? parts[pdIx + 1]! : parts[1] ?? "";
    if (!slug || /^pd$/i.test(slug)) return "";
    const q = slugToSpaces(tryDecode(slug));
    return q.replace(/\s+/g, " ").trim().length >= 4 ? q : "";
  } catch {
    return "";
  }
}

function detectUrlStore(raw: string): StoreId | null {
  const t = raw.trim();
  if (!/^https?:\/\//i.test(t)) return null;
  if (
    /\bamazon\.[a-z.]{2,}\b|\/\/a\.co\/|\/\/amzn\.to\//i.test(t)
  )
    return "amazon";
  if (/walmart\.com/i.test(t)) return "walmart";
  if (/target\.com/i.test(t)) return "target";
  if (/temu\.com/i.test(t)) return "temu";
  if (/bestbuy\.com/i.test(t)) return "bestbuy";
  if (/homedepot\.com/i.test(t)) return "homedepot";
  if (/lowes\.com/i.test(t)) return "lowes";
  if (/costco\.com/i.test(t)) return "costco";
  if (/samsclub\.com/i.test(t)) return "samsclub";
  if (/ebay\.com/i.test(t)) return "ebay";
  if (/macys\.com/i.test(t)) return "macys";
  if (/kohls\.com/i.test(t)) return "kohls";
  if (/wayfair\.com/i.test(t)) return "wayfair";
  if (/overstock\.com/i.test(t)) return "overstock";
  if (/chewy\.com/i.test(t)) return "chewy";
  if (/academy\.com/i.test(t)) return "academy";
  if (/tractorsupply\.com/i.test(t)) return "tractorsupply";
  if (/nike\.com/i.test(t)) return "nike";
  if (/adidas\.com/i.test(t) || /adidas\.us/i.test(t)) return "adidas";
  return null;
}

export type UrlDerivedQuery = {
  productQuery: string;
  store: StoreId | null;
};

/** Longest PDP-like path segment heuristic for any HTTPS URL. */
export function pathnameSlugShoppingFallback(httpUrlSansFragment: string): string {
  let u: URL;
  try {
    u = new URL(httpUrlSansFragment.trim());
  } catch {
    return "";
  }
  const segs = u.pathname
    .split("/")
    .map((seg) => tryDecode(seg))
    .filter(Boolean);

  /** Prefer substantive segments; drop obvious ids last */
  const candidates = [...segs].filter((seg) => !isOpaquePathSegment(seg));
  const weighted = candidates
    .filter((seg) => seg.replace(/-+|\./g, " ").trim().split(/\s+/).length >= 2 || seg.length >= 12)
    .map((seg) => slugToSpaces(seg.replace(/\.(?:html|htm)$/i, "")));

  weighted.sort((a, b) => b.length - a.length);
  for (const w of weighted) {
    if (!isGenericRetailProductQuery(w) && w.length >= 8) return w;
  }

  weighted.length = 0;
  /** Same as weighted path: never promote SKU/ASIN segments to the shopping query. */
  const soft = [...segs]
    .filter((seg) => !isOpaquePathSegment(seg))
    .slice()
    .reverse()
    .map((seg) => slugToSpaces(seg.replace(/\.(?:html|htm)$/i, "")))
    .filter((s) => s.length >= 6);

  for (const w of soft) {
    if (!isGenericRetailProductQuery(w)) return w.slice(0, 200).trim();
  }

  const lastMeaning =
    [...segs]
      .reverse()
      .find(
        (s) =>
          !isOpaquePathSegment(s) &&
          /[a-z]{3}/i.test(s) &&
          s.length >= 5
      ) ?? "";
  const out = slugToSpaces(lastMeaning.replace(/\.(?:html|htm)$/i, ""));
  return !isGenericRetailProductQuery(out) ? out.trim() : "";
}

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
  else if (store === "bestbuy") productQuery = productQueryFromBestBuyUrl(url);
  else if (store === "homedepot") productQuery = productQueryFromHomeDepotUrl(url);
  else if (store === "lowes") productQuery = productQueryFromLowesUrl(url);

  if (!productQuery || isGenericRetailProductQuery(productQuery)) {
    productQuery = pathnameSlugShoppingFallback(url);
  }

  /** Unknown host: pathname-only derivation + null store hint */
  if (!store && productQuery === "") {
    productQuery = pathnameSlugShoppingFallback(url);
  }

  return { productQuery, store };
}

/** Slug-derived Google Shopping baseline — hardened against domain-only prose. */
export function finalizedSlugShoppingLine(url: string): string {
  const q = extractProductQueryFromRetailUrl(url).productQuery
    .replace(/\s+/g, " ")
    .trim();
  if (q.length >= 4 && !isGenericRetailProductQuery(q)) return q;
  const extra = pathnameSlugShoppingFallback(url).replace(/\s+/g, " ").trim();
  if (extra.length >= 4 && !isGenericRetailProductQuery(extra)) return extra;
  return q.length ? q : extra;
}

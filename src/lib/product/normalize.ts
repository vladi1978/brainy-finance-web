import type { NormalizedProduct, ProductCategory, StoreId } from "./types";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "your",
  "new",
  "pack",
  "set",
  "each",
  "per",
  "inch",
  "inches",
  "size",
]);

/** Known consumer brands — extend as needed. */
const BRAND_PATTERN =
  /\b(samsung|lg|sony|tcl|hisense|vizio|insignia|onn|apple|google|beats|bose|jbl|sonos|anker|nike|adidas|reebok|puma|new balance|asics|crocs|ugg|hanes|gildan|champion|microsoft|dell|hp|lenovo|asus|acer|msi)\b/i;

/**
 * Lowercase, strip punctuation noise, collapse whitespace (search / matching).
 */
export function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeSignificant(text: string): string[] {
  const n = normalizeTitle(text);
  return n
    .split(/\s+/)
    .map((w) => w.replace(/-/g, ""))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export function extractBrand(title: string): string | null {
  const m = title.match(BRAND_PATTERN);
  return m ? m[1]!.toLowerCase().replace(/\s+/g, " ") : null;
}

/**
 * Model-like tokens: SKU fragments, alnum codes (e.g. QN65, XR-55X90K, air-max-270).
 */
export function extractModelTokens(title: string): string[] {
  const norm = normalizeTitle(title);
  const out = new Set<string>();

  for (const m of norm.matchAll(/\b[a-z]{0,3}\d{2,5}[a-z0-9-]*\b/gi)) {
    const t = m[0]!.replace(/-/g, "").toLowerCase();
    if (t.length >= 4) out.add(t);
  }
  for (const m of norm.matchAll(/\b(qn|un|qn|xr|oled|qled|u\d|serie)\w*\d{2,4}\w*\b/gi)) {
    out.add(m[0]!.replace(/\s+/g, "").toLowerCase());
  }
  return [...out].slice(0, 12);
}

/**
 * TV / monitor diagonal in inches when clearly stated.
 */
export function extractSizeInches(title: string): number | null {
  const norm = title.replace(/\u2033/g, '"'); // unicode double prime

  const m1 = norm.match(/\b(\d{2,3})\s*(?:\"|''|′′|inches?\b|inch\b|-inch)\b/i);
  if (m1) {
    const n = parseInt(m1[1]!, 10);
    if (n >= 20 && n <= 120) return n;
  }

  const m2 = norm.match(/\b(\d{2,3})\s*inch\b/i);
  if (m2) {
    const n = parseInt(m2[1]!, 10);
    if (n >= 20 && n <= 120) return n;
  }

  return null;
}

const HOUSEHOLD_RE =
  /\b(detergent|cleaner|bleach|disinfectant|paper towel|trash bag|garbage bag|sponge|mop|broom|laundry|dish soap|soap|ziploc|aluminum foil|batteries aa|batteries aaa|aa battery|aaa battery|light bulb|led bulb)\b/i;

const APPAREL_RE =
  /\b(shirt|tee|t-shirt|hoodie|sweatshirt|jacket|coat|pants|jeans|shorts|dress|skirt|underwear|bra|legging|joggers|sweater|polo)\b/i;

const SOCKS_RE = /\b(sock|socks|crew|ankle sock|no show|quarter sock)\b/i;

export function extractGender(title: string): string | null {
  const n = normalizeTitle(title);
  if (/\b(men|mens|man|male)\b/.test(n)) return "men";
  if (/\b(women|womens|woman|female|ladies|lady)\b/.test(n)) return "women";
  if (/\b(kids|kid|boys|girls|toddler|youth|junior)\b/.test(n)) return "kids";
  if (/\bunisex\b/.test(n)) return "unisex";
  return null;
}

export function extractCategory(title: string): ProductCategory {
  const n = normalizeTitle(title);
  if (
    /\b(smart tv|oled|qled|4k tv|8k tv|uhd tv|television)\b/.test(n) ||
    (/\btv\b/.test(n) && extractSizeInches(title) != null) ||
    (/\bneo qled\b/.test(n) && /\b\d{2,3}\b/.test(n))
  ) {
    return "tv";
  }
  if (SOCKS_RE.test(n)) {
    return "socks";
  }
  if (/\b(shoe|sneaker|boot|sandal|cleat|air max|yeezy|loafer|slip-on)\b/.test(n)) {
    return "footwear";
  }
  if (/\b(headphone|earbud|ear buds|airpods|speaker|soundbar|subwoofer)\b/.test(n)) {
    return "audio";
  }
  if (HOUSEHOLD_RE.test(n)) {
    return "household";
  }
  if (APPAREL_RE.test(n)) {
    return "apparel";
  }
  return "general";
}

/**
 * Pack / count when relevant (multipacks, grocery).
 */
export function extractPackCount(title: string): number | null {
  const n = normalizeTitle(title);

  const p1 = n.match(/\b(\d{1,3})\s*(?:pack|pk|ct|count)\b/);
  if (p1) return parseInt(p1[1]!, 10);

  const p2 = n.match(/\bpack of (\d{1,3})\b/);
  if (p2) return parseInt(p2[1]!, 10);

  const p3 = n.match(/\b(\d{1,3})\s*x\s*(?:count|ct)\b/);
  if (p3) return parseInt(p3[1]!, 10);

  const p4 = n.match(/\b(\d{1,3})\s*[- ]\s*pair\b/);
  if (p4) return parseInt(p4[1]!, 10);

  return null;
}

export function buildNormalizedProduct(title: string): NormalizedProduct {
  const titleNorm = normalizeTitle(title);
  return {
    titleNorm,
    brand: extractBrand(title),
    modelTokens: extractModelTokens(title),
    sizeInches: extractSizeInches(title),
    category: extractCategory(title),
    packCount: extractPackCount(title),
    gender: extractGender(title),
  };
}

/**
 * Compact, high-signal query for retailer search.
 */
export function extractSearchQuery(input: string): string {
  const cleaned = normalizeTitle(input);

  const brandMatch = cleaned.match(BRAND_PATTERN);
  const modelMatch = cleaned.match(
    /\b(qn\d{2,4}[a-z0-9]*|xr[\w-]*|oled|qled|neo qled|air max|u\d{3,4}[a-z]?)\b/i
  );
  const sizeMatch = cleaned.match(/\b\d{2,3}(?:\s*-\s*)?(?:inch|inches|")\b/i);
  const typeMatch = cleaned.match(
    /\b(tv|smart tv|shoes|socks|crew socks|speaker|headphones|earbuds|laptop|detergent|hoodie|sneakers)\b/i
  );

  const parts = [
    brandMatch?.[0],
    modelMatch?.[0],
    sizeMatch?.[0]?.replace(/-/g, " "),
    typeMatch?.[0],
  ].filter(Boolean);

  if (parts.length >= 2) {
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  return cleaned;
}

/**
 * Detect retailer from a product URL (used when scrape/extract did not set `SourceProduct`).
 */
export function detectStoreFromProductUrl(raw: string): StoreId | null {
  const t = raw.trim();
  if (!/^https?:\/\//i.test(t)) return null;
  if (/\bamazon\.[a-z.]{2,}\b|\/\/a\.co\/|\/\/amzn\.to\//i.test(t)) return "amazon";
  if (/walmart\.com/i.test(t)) return "walmart";
  if (/target\.com/i.test(t)) return "target";
  if (/temu\.com/i.test(t)) return "temu";
  return null;
}

/** Amazon ASIN — matches `/dp/`, `/gp/product/`, and slug-style `/dp/` paths. */
export function extractAmazonAsinFromUrl(url: string): string | null {
  const m = url.match(
    /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin|o\/ASIN|d)\/([A-Z0-9]{10})\b/i
  );
  return m ? m[1]!.toUpperCase() : null;
}

/** Walmart numeric item id (last path segment under `/ip/` when it is 6+ digits). */
export function extractWalmartItemIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/walmart\.com$/i.test(u.hostname.replace(/^www\./, ""))) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const ip = parts.indexOf("ip");
    if (ip === -1) return null;
    const after = parts.slice(ip + 1);
    for (let i = after.length - 1; i >= 0; i--) {
      const seg = after[i]!;
      if (/^\d{6,}$/.test(seg)) return seg;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Target TCIN from `/A-12345678` style paths. */
export function extractTargetTcinFromUrl(url: string): string | null {
  const m = url.match(/\/A-(\d{6,12})\b/i);
  return m ? m[1]! : null;
}

/** Temu: best-effort product key from `-g-<id>` or last `.html` slug segment. */
export function extractTemuListingKeyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/temu\.com$/i.test(u.hostname.replace(/^www\./, ""))) return null;
    const g = url.match(/-g-(\d{4,20})\b/i);
    if (g?.[1]) return `g-${g[1]}`;
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && /\.html$/i.test(last)) {
      return last.replace(/\.html$/i, "").toLowerCase().slice(0, 120);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function fallbackUrlIdentityKey(url: string): string {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "").toLowerCase() || "/";
    return `${host}${path}`;
  } catch {
    return url.split("?")[0].split("#")[0].toLowerCase().trim();
  }
}

/**
 * Stable identity for “same listing” checks across canonical vs pretty URLs
 * (e.g. Amazon `/title/dp/ASIN` vs `/dp/ASIN`).
 */
export function retailerListingIdentityKey(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";

  const noFrag = trimmed.split("#")[0] ?? trimmed;
  const noQuery = noFrag.split("?")[0] ?? noFrag;

  if (/\bamazon\.[a-z.]{2,}\b|a\.co|amzn\.to/i.test(trimmed)) {
    const asin = extractAmazonAsinFromUrl(noQuery);
    if (asin) return `amazon:asin:${asin}`;
  }

  if (/walmart\.com/i.test(noQuery)) {
    const wid = extractWalmartItemIdFromUrl(trimmed);
    if (wid) return `walmart:id:${wid}`;
  }

  if (/target\.com/i.test(noQuery)) {
    const tc = extractTargetTcinFromUrl(noQuery);
    if (tc) return `target:tcin:${tc}`;
  }

  if (/temu\.com/i.test(noQuery)) {
    const tk = extractTemuListingKeyFromUrl(trimmed);
    if (tk) return `temu:${tk}`;
  }

  return `url:${fallbackUrlIdentityKey(trimmed)}`;
}

export function areSameRetailerListings(urlA: string, urlB: string): boolean {
  const a = retailerListingIdentityKey(urlA);
  const b = retailerListingIdentityKey(urlB);
  return a.length > 0 && a === b;
}

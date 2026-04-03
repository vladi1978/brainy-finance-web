export type ScrapedProduct = {
  productName: string;
  price: number | null;
  currency: string;
};

/** Chrome-on-macOS fingerprint: matches real navigation from a desktop browser. */
export const STEALTH_HEADERS: HeadersInit = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "max-age=0",
  DNT: "1",
  "Sec-Ch-Ua":
    '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
  "Sec-Ch-Ua-Platform-Version": '"15.2.0"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  Priority: "u=0, i",
};

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(html: string): string {
  return decodeHtmlEntities(
    html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  );
}

function getMetaProperty(html: string, property: string): string | null {
  const esc = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const a = new RegExp(
    `<meta\\s+property=["']${esc}["']\\s+content=["']([^"']*)["']`,
    "i"
  );
  const b = new RegExp(
    `<meta\\s+content=["']([^"']*)["']\\s+property=["']${esc}["']`,
    "i"
  );
  const m = html.match(a) || html.match(b);
  return m ? decodeHtmlEntities(m[1]) : null;
}

function parsePriceFromString(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function visitJsonLdNode(
  node: unknown,
  out: { name?: string; price?: number; currency?: string }
): void {
  if (node == null || typeof node !== "object") return;

  const o = node as Record<string, unknown>;
  const types = Array.isArray(o["@type"])
    ? o["@type"]
    : o["@type"] != null
      ? [o["@type"]]
      : [];

  if (
    types.some((x) => x === "Product" || x === "IndividualProduct") &&
    typeof o.name === "string" &&
    !out.name
  ) {
    out.name = o.name;
  }

  if (
    types.some((x) => x === "Product" || x === "IndividualProduct") &&
    o.offers
  ) {
    const offers = o.offers;
    const list = Array.isArray(offers) ? offers : [offers];
    for (const off of list) {
      if (!off || typeof off !== "object") continue;
      const offer = off as Record<string, unknown>;
      const offerTypes = Array.isArray(offer["@type"])
        ? offer["@type"]
        : offer["@type"] != null
          ? [offer["@type"]]
          : [];

      if (offerTypes.some((t) => t === "AggregateOffer")) {
        const aggPrice =
          offer.lowPrice ?? offer.highPrice ?? offer.price ?? null;
        if (out.price == null && aggPrice != null) {
          const n =
            typeof aggPrice === "number"
              ? aggPrice
              : parseFloat(String(aggPrice).replace(/[^0-9.]/g, ""));
          if (Number.isFinite(n)) out.price = n;
        }
        if (
          !out.currency &&
          typeof offer.priceCurrency === "string" &&
          offer.priceCurrency
        ) {
          out.currency = offer.priceCurrency;
        }
        continue;
      }

      if (out.price == null && offer.price != null) {
        const p = offer.price;
        const n =
          typeof p === "number"
            ? p
            : parseFloat(String(p).replace(/[^0-9.]/g, ""));
        if (Number.isFinite(n)) out.price = n;
      }
      if (
        !out.currency &&
        typeof offer.priceCurrency === "string" &&
        offer.priceCurrency
      ) {
        out.currency = offer.priceCurrency;
      }
    }
  }

  if (
    types.some((x) => x === "Product" || x === "IndividualProduct") &&
    out.price == null &&
    o.price != null
  ) {
    const p = o.price;
    const n =
      typeof p === "number" ? p : parseFloat(String(p).replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n)) out.price = n;
  }

  if (Array.isArray(o["@graph"])) {
    for (const g of o["@graph"]) visitJsonLdNode(g, out);
  }
}

function extractFromJsonLd(html: string): {
  name?: string;
  price?: number;
  currency?: string;
} {
  const out: { name?: string; price?: number; currency?: string } = {};
  const scripts = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );

  for (const [, jsonText] of scripts) {
    let data: unknown;
    try {
      data = JSON.parse(jsonText.trim());
    } catch {
      continue;
    }

    visitJsonLdNode(data, out);
    if (Array.isArray(data)) {
      for (const item of data) visitJsonLdNode(item, out);
    }
    const g = (data as { "@graph"?: unknown[] })["@graph"];
    if (Array.isArray(g)) {
      for (const node of g) visitJsonLdNode(node, out);
    }
  }

  return out;
}

function tryAmazonDirectTitle(html: string): string | null {
  const patterns = [
    /id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i,
    /data-cy=["']product-title["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
    /id=["']title["'][^>]*class=["'][^"']*product[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
    /<span[^>]*id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i,
    /<h1[^>]*class=["'][^"']*a-size-large[^"']*product[^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (!m?.[1]) continue;
    const t = stripTags(m[1]);
    if (t.length > 3) return t;
  }
  return null;
}

function tryWalmartDirectTitle(html: string): string | null {
  const patterns = [
    /data-automation-id=["']product-title["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
    /<h1[^>]*itemprop=["']name["'][^>]*>([\s\S]*?)<\/h1>/i,
    /class=["'][^"']*prod-ProductTitle[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (!m?.[1]) continue;
    const t = stripTags(m[1]);
    if (t.length > 3) return t;
  }
  return null;
}

function tryDirectPrice(html: string): number | null {
  const itemprop = html.match(
    /itemprop=["']price["'][^>]*content=["']([0-9]+(?:\.[0-9]+)?)["']/i
  );
  if (itemprop) return parsePriceFromString(itemprop[1]);

  const productAmount = getMetaProperty(html, "product:price:amount");
  const n = parsePriceFromString(productAmount);
  return n;
}

function pickTitle(
  html: string,
  host: string,
  jsonLd: { name?: string }
): string | null {
  if (jsonLd.name && jsonLd.name.trim()) return jsonLd.name.trim();

  const isWalmart = /walmart\.com/i.test(host);
  const isAmazon = /amazon\./i.test(host);

  if (isAmazon) {
    const t = tryAmazonDirectTitle(html);
    if (t) return t;
  }
  if (isWalmart) {
    const t = tryWalmartDirectTitle(html);
    if (t) return t;
  }

  const og = getMetaProperty(html, "og:title");
  if (og && og.trim()) return og.trim();

  return null;
}

function pickPrice(
  html: string,
  jsonLd: ReturnType<typeof extractFromJsonLd>
): { price: number | null; currency: string } {
  let price: number | null = tryDirectPrice(html);

  if (price == null) {
    price = jsonLd.price ?? null;
  }

  if (price == null) {
    price = parsePriceFromString(getMetaProperty(html, "og:price:amount"));
  }

  const currency =
    getMetaProperty(html, "og:price:currency") ||
    getMetaProperty(html, "product:price:currency") ||
    jsonLd.currency ||
    "USD";

  return { price, currency };
}

/**
 * Fetches a product page with stealth (Chrome/macOS) headers and extracts name/price
 * via DOM/meta patterns first, then JSON-LD in application/ld+json, then og:price.
 */
export async function scrapeProduct(url: string): Promise<ScrapedProduct | null> {
  let html: string;
  try {
    const res = await fetch(url, {
      headers: STEALTH_HEADERS,
      cache: "no-store",
      redirect: "follow",
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }

  const jsonLd = extractFromJsonLd(html);

  let productName = pickTitle(html, host, jsonLd);

  const { price, currency } = pickPrice(html, jsonLd);

  if (!productName) {
    const ogTitle = getMetaProperty(html, "og:title");
    if (ogTitle?.trim()) productName = ogTitle.trim();
  }

  if (!productName) {
    const docTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (docTitle?.[1]) {
      const t = stripTags(docTitle[1])
        .replace(/\s*[|\u2013\u2014-]\s*Walmart\.com.*$/i, "")
        .replace(/\s*[|\u2013\u2014-]\s*Amazon\.com.*$/i, "")
        .trim();
      if (t.length > 3) productName = t;
    }
  }

  if (!productName) {
    return null;
  }

  return {
    productName,
    price,
    currency: currency || "USD",
  };
}

export type FetchHtmlResult = {
  html: string | null;
  httpStatus: number | null;
  byteLength: number;
};

/**
 * Fetches store pages (e.g. search SERP) with HTTP metadata for diagnostics.
 */
export async function fetchSearchPageHtmlDetailed(
  url: string
): Promise<FetchHtmlResult> {
  try {
    const res = await fetch(url, {
      headers: STEALTH_HEADERS,
      cache: "no-store",
      redirect: "follow",
    });
    const httpStatus = res.status;
    if (!res.ok) {
      return { html: null, httpStatus, byteLength: 0 };
    }
    const html = await res.text();
    return { html, httpStatus, byteLength: html.length };
  } catch {
    return { html: null, httpStatus: null, byteLength: 0 };
  }
}

/**
 * Fetches store pages (e.g. search SERP) with the same stealth fingerprint as PDP scraping.
 */
export async function fetchSearchPageHtml(url: string): Promise<string | null> {
  const { html } = await fetchSearchPageHtmlDetailed(url);
  return html;
}

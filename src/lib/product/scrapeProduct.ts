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
  const cleaned = String(raw)
    .replace(/,/g, "")
    .replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Reasonable PDP range — excludes obvious junk / SKU fragments */
function isPlausibleProductPrice(n: number): boolean {
  return Number.isFinite(n) && n >= 0.01 && n < 1_000_000;
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

  const isOffer = types.some(
    (x) => x === "Offer" || x === "AggregateOffer" || x === "OfferForPurchase"
  );

  if (isOffer && out.price == null) {
    const raw =
      types.some((x) => x === "AggregateOffer") && (o.lowPrice ?? o.highPrice)
        ? (o.lowPrice ?? o.highPrice)
        : o.price;
    if (raw != null) {
      const p = raw;
      const n =
        typeof p === "number"
          ? p
          : parseFloat(String(p).replace(/[^0-9.]/g, ""));
      if (Number.isFinite(n) && isPlausibleProductPrice(n)) out.price = n;
    }
    if (
      !out.currency &&
      typeof o.priceCurrency === "string" &&
      o.priceCurrency
    ) {
      out.currency = o.priceCurrency;
    }
  }

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

/**
 * Meta tags and itemprop (any attribute order) for common retailer PDPs.
 */
function tryMetaAndItempropPrice(html: string): number | null {
  const metaPriceAmount =
    getMetaProperty(html, "product:price:amount") ||
    getMetaProperty(html, "og:price:amount");

  let n = parsePriceFromString(metaPriceAmount);
  if (n != null && isPlausibleProductPrice(n)) return n;

  const itempropPatterns = [
    /itemprop=["']price["'][^>]*content=["']([0-9]+(?:\.[0-9]+)?)["']/i,
    /content=["']([0-9]+(?:\.[0-9]+)?)["'][^>]*itemprop=["']price["']/i,
    /<meta[^>]*itemprop=["']price["'][^>]*content=["']([0-9]+(?:\.[0-9]+)?)["']/i,
    /<meta[^>]*content=["']([0-9]+(?:\.[0-9]+)?)["'][^>]*itemprop=["']price["']/i,
  ];
  for (const re of itempropPatterns) {
    const m = html.match(re);
    n = parsePriceFromString(m?.[1]);
    if (n != null && isPlausibleProductPrice(n)) return n;
  }

  const spanItemprop = html.match(
    /<[^>]+itemprop=["']price["'][^>]*>([^<]{0,40})</i
  );
  n = parsePriceFromString(spanItemprop?.[1]);
  if (n != null && isPlausibleProductPrice(n)) return n;

  return null;
}

function sliceAmazonBuybox(html: string): string {
  const markers = [
    /id=["']corePrice_feature_div["']/i,
    /id=["']corePriceDisplay_desktop_feature_div["']/i,
    /id=["']priceblock_inside_buybox["']/i,
    /data-feature-name=["']corePrice["']/i,
    /class=["'][^"']*a-price[^"']*a-text-price[^"']*["']/i,
  ];
  for (const re of markers) {
    const m = re.exec(html);
    if (m?.index != null) {
      return html.slice(m.index, m.index + 16000);
    }
  }
  return html.slice(0, 120000);
}

/**
 * Amazon PDP: buybox a-offscreen, a-price-whole + fraction, itemprop, visible $x.xx
 */
function extractAmazonPdpPrice(html: string): number | null {
  const focus = sliceAmazonBuybox(html);

  const offscreens = [
    ...focus.matchAll(/class=["'][^"']*a-offscreen[^"']*["'][^>]*>\s*([^<]+)</gi),
  ];
  for (const m of offscreens) {
    const n = parsePriceFromString(m[1]);
    if (n != null && isPlausibleProductPrice(n)) return n;
  }

  const whole = focus.match(/class="[^"]*a-price-whole[^"]*"[^>]*>([0-9,]+)/i);
  const frac = focus.match(/class="[^"]*a-price-fraction[^"]*"[^>]*>([0-9]+)/i);
  if (whole?.[1] && frac?.[1]) {
    const n = parseFloat(`${whole[1].replace(/,/g, "")}.${frac[1]}`);
    if (isPlausibleProductPrice(n)) return n;
  }

  const twisterWhole = focus.match(
    /class="[^"]*a-price[^"]*"[^>]*>[\s\S]{0,400}?class="[^"]*a-price-whole[^"]*"[^>]*>([0-9,]+)/i
  );
  const twisterFrac = focus.match(
    /class="[^"]*a-price-fraction[^"]*"[^>]*>([0-9]+)/i
  );
  if (twisterWhole?.[1] && twisterFrac?.[1]) {
    const n = parseFloat(
      `${twisterWhole[1].replace(/,/g, "")}.${twisterFrac[1]}`
    );
    if (isPlausibleProductPrice(n)) return n;
  }

  const ip = focus.match(
    /itemprop=["']price["'][^>]*content=["']([0-9]+(?:\.[0-9]+)?)["']/i
  );
  let n = parsePriceFromString(ip?.[1]);
  if (n != null && isPlausibleProductPrice(n)) return n;

  const vis = focus.match(/\$\s*([0-9]{1,5}(?:\.[0-9]{2})?)/);
  n = parsePriceFromString(vis?.[1]);
  if (n != null && isPlausibleProductPrice(n)) return n;

  return null;
}

function walkJsonForUsdPrices(
  obj: unknown,
  depth: number,
  out: number[]
): void {
  if (depth > 18 || obj == null) return;
  if (typeof obj === "number") return;
  if (typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const x of obj) walkJsonForUsdPrices(x, depth + 1, out);
    return;
  }

  const r = obj as Record<string, unknown>;
  const cur = r.currency ?? r.priceCurrency;
  const curOk =
    cur === "USD" ||
    cur === "usd" ||
    cur === undefined ||
    cur === null ||
    cur === "";

  if (curOk) {
    if (typeof r.price === "number" && isPlausibleProductPrice(r.price)) {
      out.push(r.price);
    } else if (typeof r.price === "string") {
      const pn = parsePriceFromString(r.price);
      if (pn != null && isPlausibleProductPrice(pn)) out.push(pn);
    }
  }
  if (
    r.currentPrice &&
    typeof r.currentPrice === "object" &&
    !Array.isArray(r.currentPrice)
  ) {
    const cp = r.currentPrice as Record<string, unknown>;
    if (
      typeof cp.price === "number" &&
      isPlausibleProductPrice(cp.price)
    ) {
      out.push(cp.price);
    }
  }
  for (const v of Object.values(r)) walkJsonForUsdPrices(v, depth + 1, out);
}

function tryNextDataScriptPrice(html: string): number | null {
  const m = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!m?.[1]) return null;
  try {
    const data = JSON.parse(m[1]) as unknown;
    const candidates: number[] = [];
    walkJsonForUsdPrices(data, 0, candidates);
    if (candidates.length === 0) return null;
    const plausible = candidates.filter((p) => p > 0.01 && p < 100_000);
    if (plausible.length === 0) return null;
    return Math.min(...plausible);
  } catch {
    return null;
  }
}

/**
 * Walmart PDP: meta, JSON-LD (caller), __NEXT_DATA__, aria, automation ids, visible text.
 */
function extractWalmartPdpPrice(html: string): number | null {
  let n = tryMetaAndItempropPrice(html);
  if (n != null) return n;

  n = tryNextDataScriptPrice(html);
  if (n != null) return n;

  const aria = html.match(/aria-label=["'][^"']*\$\s*([0-9]+(?:\.[0-9]{2})?)/i);
  n = parsePriceFromString(aria?.[1]);
  if (n != null && isPlausibleProductPrice(n)) return n;

  const cur = html.match(/current price\s*\$\s*([0-9]+(?:\.[0-9]{2})?)/i);
  n = parsePriceFromString(cur?.[1]);
  if (n != null && isPlausibleProductPrice(n)) return n;

  const gpt = html.match(
    /data-test-id=["']gpt-main-price-display["'][\s\S]{0,800}?\$\s*<\/span>\s*<span[^>]*>([0-9]+)<\/span>\s*<span[^>]*>([0-9]{2})<\/span>/i
  );
  if (gpt?.[1] != null && gpt?.[2] != null) {
    n = parseFloat(`${gpt[1]}.${gpt[2]}`);
    if (isPlausibleProductPrice(n)) return n;
  }

  const autoPrice = html.match(
    /data-automation-id=["'](?:product-price|price)[^"']*["'][\s\S]{0,400}?\$\s*([0-9]+(?:\.[0-9]{2})?)/i
  );
  n = parsePriceFromString(autoPrice?.[1]);
  if (n != null && isPlausibleProductPrice(n)) return n;

  const priceClass = html.match(
    /class=["'][^"']*(?:Price|price|prod-Price)[^"']*["'][^>]*>\s*\$\s*([0-9]+(?:\.[0-9]{2})?)/i
  );
  n = parsePriceFromString(priceClass?.[1]);
  if (n != null && isPlausibleProductPrice(n)) return n;

  const scan = html.slice(0, 200_000);
  const dollars = [...scan.matchAll(/\$\s*([0-9]{1,5}\.[0-9]{2})\b/g)].map(
    (x) => parseFloat(x[1]!)
  );
  const plausible = dollars.filter(
    (p) => isPlausibleProductPrice(p) && p >= 1 && p <= 50_000
  );
  if (plausible.length > 0) {
    return plausible[0]!;
  }

  return null;
}

function isAmazonHostname(host: string): boolean {
  return /amazon\./i.test(host) || /^a\.co$/i.test(host);
}

function pickTitle(
  html: string,
  host: string,
  jsonLd: { name?: string }
): string | null {
  if (jsonLd.name && jsonLd.name.trim()) return jsonLd.name.trim();

  const isWalmart = /walmart\.com/i.test(host);
  const isAmazon = isAmazonHostname(host);

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
  jsonLd: ReturnType<typeof extractFromJsonLd>,
  host: string
): { price: number | null; currency: string } {
  const isWalmart = /walmart\.com/i.test(host);
  const isAmazon = isAmazonHostname(host);

  let price: number | null = null;

  if (isWalmart) {
    price = extractWalmartPdpPrice(html);
  } else if (isAmazon) {
    price = extractAmazonPdpPrice(html);
  }

  if (price == null) {
    price = tryMetaAndItempropPrice(html);
  }

  if (price == null) {
    const jp = jsonLd.price ?? null;
    price = jp != null && isPlausibleProductPrice(jp) ? jp : null;
  }

  if (price == null) {
    price = parsePriceFromString(getMetaProperty(html, "og:price:amount"));
  }

  if (price == null) {
    const loose = html.match(/\$\s*([0-9]{1,6}(?:\.[0-9]{2})?)/);
    const n = parsePriceFromString(loose?.[1]);
    price = n != null && isPlausibleProductPrice(n) ? n : null;
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

  const { price, currency } = pickPrice(html, jsonLd, host);

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

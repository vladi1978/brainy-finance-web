import { detectStoreFromProductUrl } from "./normalize";
import type { SourceScrapedHints, StoreId } from "./types";
import {
  isGenericRetailProductQuery,
  looksLikeAmazonAsinToken,
} from "./urlProductQuery";

export type PriceExtractionSource =
  | "json_ld"
  | "open_graph"
  | "meta_itemprop"
  | "retailer_specific"
  | "visible_usd"
  | null;

export type ScrapedProduct = {
  /** Listing / PDP-visible product title when parseable — may be empty when only meta/sku cues exist */
  productName: string;
  price: number | null;
  currency: string;
  /** How {@link ScrapedProduct.price} was resolved when present */
  priceSource?: PriceExtractionSource;
  /** og:image / twitter:image when present */
  imageUrl: string | null;
  brand: string | null;
  /** Retailer SKU when present */
  sku: string | null;
  /** MPN / model string when tighter than SKU */
  model: string | null;
  /** Breadcrumb-derived category hint */
  category: string | null;
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

function mergeLongestTextLine(
  a: string | undefined | null,
  b: string | undefined | null
): string {
  const x = a?.trim() ?? "";
  const y = b?.trim() ?? "";
  if (!y) return x;
  if (!x) return y;
  return y.length > x.length ? y : x;
}

function coerceJsonLdBrand(raw: unknown): string | null {
  if (typeof raw === "string" && raw.trim().length >= 2) return raw.trim();
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    const nm = (raw as { name?: unknown }).name;
    if (typeof nm === "string" && nm.trim().length >= 2) return nm.trim();
  }
  return null;
}

function coerceJsonLdStringField(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length >= 2 ? t : null;
}

/** Parse first sensible breadcrumb trail from JSON-LD. */
function readBreadcrumbCategory(o: Record<string, unknown>): string | null {
  const els = o["itemListElement"];
  const list = Array.isArray(els) ? els : els != null ? [els] : [];
  const names: string[] = [];
  for (const raw of list) {
    if (raw == null || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    let label: string | null = coerceJsonLdStringField(item.name);
    if (
      label == null &&
      item.item &&
      typeof item.item === "object" &&
      !Array.isArray(item.item)
    ) {
      const sub = item.item as Record<string, unknown>;
      label = coerceJsonLdStringField(sub.name);
    }
    if (label) names.push(label);
  }

  /** Drop leading “Home / Shop / …” site chrome */
  const skip = /^home\b|^shop\b|^departments\b|^all\s+departments\b/i;
  while (names.length > 1 && skip.test(names[0]!)) {
    names.shift();
  }

  const trail = names.join(" › ").trim();
  if (trail.length < 4 || trail.split("›").length < 2) return null;
  return trail.slice(0, 200).trim();
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

function isShoppingDebug(): boolean {
  return process.env.PRODUCT_SHOPPING_DEBUG === "1";
}

function logReferencePriceExtracted(payload: {
  price: number;
  source: string;
  store: string;
  url: string;
}): void {
  if (!isShoppingDebug()) return;
  console.log("[REFERENCE_PRICE_EXTRACTED]", JSON.stringify(payload));
}

function logReferencePriceRejected(payload: {
  value: number;
  reason: string;
  source: string;
  store: string;
}): void {
  if (!isShoppingDebug()) return;
  console.log("[REFERENCE_PRICE_REJECTED]", JSON.stringify(payload));
}

function logReferencePriceMissing(payload: {
  reason: string;
  store: string;
  url: string;
}): void {
  if (!isShoppingDebug()) return;
  console.log("[REFERENCE_PRICE_MISSING]", JSON.stringify(payload));
}

/** When several PDP prices appear, prefer the main line item over accessory / promo noise. */
function pickPrimaryPdpPriceFromCandidates(candidates: number[]): number | null {
  const plausible = [...new Set(candidates.filter(isPlausibleProductPrice))];
  if (plausible.length === 0) return null;
  if (plausible.length === 1) return plausible[0]!;
  plausible.sort((a, b) => a - b);
  const min = plausible[0]!;
  const max = plausible[plausible.length - 1]!;
  if (min <= 0) return max;
  if (max / min >= 5) return max;
  return min;
}

const PRICE_NOISE_CONTEXT_RE =
  /(?:save|savings|coupon|promo|promotion|rebate|%\s*off|percent\s+off|was\s+now|list\s+price|compare\s+at|per\s+month|\/mo\b|monthly\s+payment|financ|installment|gift\s+card|reward|points|credit|free\s+shipping|shipping\s+(?:by|on)|arrives|delivery|quantity|qty|rating|reviews?|stars|answered\s+questions|prime\s+visa|subscribe|subscription|with\s+coupon|clip\s+coupon|apply\s+coupon|\/\s*ea\b|\/\s*unit|each\s+when|count\s+only|off\s+with|you\s+save)/i;

/** Reject prices embedded in coupon / financing / rating / shipping UI chrome. */
function rejectPriceInContext(
  html: string,
  matchIndex: number,
  matchText: string
): string | null {
  const window = html.slice(
    Math.max(0, matchIndex - 160),
    matchIndex + (matchText.length || 8) + 160
  );
  if (PRICE_NOISE_CONTEXT_RE.test(window)) return "noise_context";
  if (/\b(?:from|as\s+low\s+as|starting\s+at)\b[\s\S]{0,48}\$/i.test(window))
    return "promo_lead_in";
  if (/\$\s*[\d,.]+\s*(?:\/|per)\s*(?:mo|month|wk|week)/i.test(window))
    return "installment";
  if (/\(\s*\d[\d,]*\s*(?:ratings?|reviews?)\s*\)/i.test(window))
    return "rating_count";
  return null;
}

function pushJsonLdPrice(out: JsonLdProductHints, raw: unknown): void {
  if (raw == null) return;
  const n =
    typeof raw === "number"
      ? raw
      : parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || !isPlausibleProductPrice(n)) return;
  if (!out.priceCandidates) out.priceCandidates = [];
  if (!out.priceCandidates.includes(n)) out.priceCandidates.push(n);
}

type JsonLdProductHints = {
  name?: string;
  price?: number;
  priceCandidates?: number[];
  currency?: string;
  brand?: string;
  sku?: string;
  mpn?: string;
  model?: string;
  category?: string;
};

function visitJsonLdNode(node: unknown, out: JsonLdProductHints): void {
  if (node == null || typeof node !== "object") return;

  const o = node as Record<string, unknown>;
  const types = Array.isArray(o["@type"])
    ? o["@type"]
    : o["@type"] != null
      ? [o["@type"]]
      : [];

  const typeStrList = types.map((x) => String(x));

  /** Breadcrumbs — richer category cue than SKU-only pages */
  if (typeStrList.some((t) => /BreadcrumbList/i.test(t))) {
    const cat = readBreadcrumbCategory(o);
    if (
      cat &&
      (!out.category || cat.length > out.category.length)
    ) {
      out.category = cat;
    }
  }

  const isOffer = types.some(
    (x) => x === "Offer" || x === "AggregateOffer" || x === "OfferForPurchase"
  );

  if (isOffer) {
    const raw =
      types.some((x) => x === "AggregateOffer") && (o.lowPrice ?? o.highPrice)
        ? (o.lowPrice ?? o.highPrice)
        : o.price;
    pushJsonLdPrice(out, raw);
    if (
      !out.currency &&
      typeof o.priceCurrency === "string" &&
      o.priceCurrency
    ) {
      out.currency = o.priceCurrency;
    }
  }

  const isProduct = types.some(
    (x) => x === "Product" || x === "IndividualProduct"
  );

  if (isProduct && typeof o.name === "string") {
    const merged = mergeLongestTextLine(out.name, o.name);
    if (merged) out.name = merged;
  }

  if (isProduct) {
    const br = coerceJsonLdBrand(o.brand);
    if (br && (!out.brand || br.length > out.brand.length)) out.brand = br;

    const skuRaw =
      coerceJsonLdStringField(o.sku) ??
      coerceJsonLdStringField(o.gtin13) ??
      coerceJsonLdStringField(o.gtin14) ??
      coerceJsonLdStringField(o.productID);
    if (
      skuRaw &&
      skuRaw.length >= 4 &&
      (!out.sku || skuRaw.length > out.sku.length)
    )
      out.sku = skuRaw;

    const mpn = coerceJsonLdStringField(o.mpn);
    if (
      mpn &&
      mpn.length >= 3 &&
      (!out.mpn || mpn.length > out.mpn.length)
    )
      out.mpn = mpn;

    const modelRaw = coerceJsonLdStringField(o.model);
    if (
      modelRaw &&
      modelRaw.length >= 3 &&
      (!out.model || modelRaw.length > out.model.length)
    )
      out.model = modelRaw;
  }

  if (isProduct && o.offers) {
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
        pushJsonLdPrice(out, offer.lowPrice ?? offer.highPrice ?? offer.price);
        if (
          !out.currency &&
          typeof offer.priceCurrency === "string" &&
          offer.priceCurrency
        ) {
          out.currency = offer.priceCurrency;
        }
        continue;
      }

      pushJsonLdPrice(out, offer.price);
      if (
        !out.currency &&
        typeof offer.priceCurrency === "string" &&
        offer.priceCurrency
      ) {
        out.currency = offer.priceCurrency;
      }
    }
  }

  if (isProduct) pushJsonLdPrice(out, o.price);

  if (Array.isArray(o["@graph"])) {
    for (const g of o["@graph"]) visitJsonLdNode(g, out);
  }
}

function extractFromJsonLd(html: string): JsonLdProductHints {
  const out: JsonLdProductHints = {};
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

  if (out.priceCandidates?.length) {
    out.price = pickPrimaryPdpPriceFromCandidates(out.priceCandidates) ?? undefined;
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

function tryRetailStructuredH1(html: string): string | null {
  const patterns = [
    /<h1[^>]*itemprop=["']name["'][^>]*>([\s\S]*?)<\/h1>/i,
    /<h1[^>]*sku-title-heading[^>]*>([\s\S]*?)<\/h1>/i,
    /<h1[^>]*data-testid=["']product-title(?:-heading)?["'][^>]*>([\s\S]*?)<\/h1>/i,
    /<h1[^>]*id=["'](?:Heading|sku-title-heading|(?:productHeading))["'][^>]*>([\s\S]*?)<\/h1>/i,
    /<h1[^>]*class=["'][^"']*product[^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
  ];
  let best = "";
  for (const re of patterns) {
    const m = html.match(re);
    if (!m?.[1]) continue;
    const t = stripTags(m[1]).replace(/\s+/g, " ").trim();
    if (t.length > best.length && t.length > 4) best = t;
  }
  return best || null;
}

/** Strip storefront boilerplate prefixes/suffixes from listing titles. */
function polishRetailerListingTitle(raw: string, host: string): string {
  let t = stripTags(raw).replace(/\s+/g, " ").trim();

  /** `Amazon.com: …` prefix */
  t = t.replace(
    /^Amazon\s*[.:]?\s*(?:com(?:\.[a-z.]+|\s+))?[/\s:]+/i,
    ""
  ).trim();

  /** `Title : Shopping at Walmart.com — …` */
  t = t.replace(/\s*:\s*Shopping\b.*$/i, "").trim();

  t = t.replace(/\s*[|\u2013\u2014-]\s*(?:Walmart(?:\.|[\s ])com|Wal-Mart).*$/i, "");
  t = t.replace(/\s*[|\u2013\u2014-]\s*Target(?:\.|[\s ])(?:com|Corporation).*$/i, "");
  t = t.replace(/\s*[|\u2013\u2014-]\s*(?:Best\s*Buy|The\s*Best\s*Buy).*$/i, "");
  t = t.replace(/\s*[|\u2013\u2014-]\s*Lowe'?s\b.*$/i, "");
  t = t.replace(/\s*[|\u2013\u2014-]\s*The\s*Home\s*Depot.*$/i, "");
  t = t.replace(/\s*[|\u2013\u2014-]\s*Temu\b.*$/i, "");

  if (/amazon/i.test(host) || /\.amazon\./i.test(host)) {
    t = t.replace(/\s+[|\u2013\u2014-]\s*Amazon\.(?:com|[a-z.]+).*$/i, "").trim();
  }

  /** Document-title style “…” */
  const docClean = stripTags(t)
    .replace(/\s*[|\u2013\u2014-]\s*Walmart(?:\.[\s]*)?com.*$/i, "")
    .replace(/\s*[|\u2013\u2014-]\s*Amazon\.(?:com|[a-z.]+).*$/i, "")
    .trim();
  t = docClean.length >= 4 ? docClean : t;

  const max = 240;
  return t.length > max ? `${t.slice(0, max - 3).trim()}...` : t;
}

function tryTwitterCardPrice(html: string): number | null {
  const label =
    getMetaProperty(html, "twitter:label1") ||
    getMetaProperty(html, "twitter:label2") ||
    "";
  const data1 = getMetaProperty(html, "twitter:data1");
  const data2 = getMetaProperty(html, "twitter:data2");
  const labelLooksPrice = /\bprice\b/i.test(label);
  for (const raw of [data1, labelLooksPrice ? null : data2]) {
    if (!raw) continue;
    if (!labelLooksPrice && !/^\s*\$?\s*\d/.test(raw)) continue;
    const n = parsePriceFromString(raw);
    if (n != null && isPlausibleProductPrice(n)) return n;
  }
  if (labelLooksPrice && data1) {
    const n = parsePriceFromString(data1);
    if (n != null && isPlausibleProductPrice(n)) return n;
  }
  return null;
}

/**
 * Meta tags and itemprop (any attribute order) for common retailer PDPs.
 */
function tryMetaAndItempropPrice(html: string): number | null {
  const metaPriceAmount = getMetaProperty(html, "product:price:amount");

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

function readAmazonWholeFractionPrice(focus: string): number | null {
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
  return null;
}

/**
 * Amazon PDP: buybox a-price-whole + fraction, then current (non-list) a-offscreen prices.
 */
function extractAmazonPdpPrice(html: string): number | null {
  const focus = sliceAmazonBuybox(html);

  const wholeFrac = readAmazonWholeFractionPrice(focus);
  if (wholeFrac != null) return wholeFrac;

  const candidates: number[] = [];
  for (const m of focus.matchAll(
    /class=["'][^"']*a-offscreen[^"']*["'][^>]*>\s*([^<]+)</gi
  )) {
    const idx = m.index ?? 0;
    const snippet = m[0] ?? "";
    const before = focus.slice(Math.max(0, idx - 280), idx);
    if (/a-text-price|listPrice|basisPrice|priceWas|strike/i.test(before)) continue;
    if (rejectPriceInContext(focus, idx, snippet)) continue;
    const n = parsePriceFromString(m[1]);
    if (n != null && isPlausibleProductPrice(n)) candidates.push(n);
  }

  const picked = pickPrimaryPdpPriceFromCandidates(candidates);
  if (picked != null) return picked;

  const ip = focus.match(
    /itemprop=["']price["'][^>]*content=["']([0-9]+(?:\.[0-9]+)?)["']/i
  );
  const n = parsePriceFromString(ip?.[1]);
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
    return pickPrimaryPdpPriceFromCandidates(plausible);
  } catch {
    return null;
  }
}

/**
 * Walmart PDP: __NEXT_DATA__, aria, automation ids, visible text in price region.
 * (Meta / JSON-LD handled by universal {@link pickPrice} first.)
 */
function extractWalmartPdpPrice(html: string): number | null {
  let n = tryNextDataScriptPrice(html);
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

  return extractGenericVisiblePdpPrice(html);
}

/** Target PDP price containers (buybox / data-test product-price). */
function extractTargetPdpPrice(html: string): number | null {
  const region = slicePdpPriceRegion(html);
  const patterns = [
    /data-test=["']product-price["'][\s\S]{0,500}?\$\s*([0-9]{1,6}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i,
    /data-test=["']product-price["'][\s\S]{0,500}?>\s*([0-9]{1,6}(?:\.[0-9]{2})?)/i,
    /<span[^>]*data-test=["']product-price["'][^>]*>[\s\S]{0,200}?\$\s*([0-9]+(?:\.[0-9]{2})?)/i,
    /class=["'][^"']*styles_price[^"']*["'][\s\S]{0,300}?\$\s*([0-9]+(?:\.[0-9]{2})?)/i,
  ];
  for (const re of patterns) {
    const m = region.match(re);
    const n = parsePriceFromString(m?.[1]);
    if (n != null && isPlausibleProductPrice(n)) return n;
  }
  return extractGenericVisiblePdpPrice(region);
}

/** Home Depot / Lowe's / Best Buy visible price containers. */
function extractBigBoxRetailerPdpPrice(html: string): number | null {
  const region = slicePdpPriceRegion(html);
  const patterns = [
    /data-testid=["']customer-price["'][^>]*>[\s\S]{0,200}?\$\s*([0-9]+(?:\.[0-9]{2})?)/i,
    /data-test=["']product-price["'][\s\S]{0,400}?\$\s*([0-9]+(?:\.[0-9]{2})?)/i,
    /data-price=["']([0-9]+(?:\.[0-9]{2})?)["']/i,
    /class=["'][^"']*(?:price__|price-format|pricing-price|product-price)[^"']*["'][\s\S]{0,300}?\$\s*([0-9]+(?:\.[0-9]{2})?)/i,
    /itemprop=["']price["'][^>]*content=["']([0-9]+(?:\.[0-9]+)?)["']/i,
  ];
  for (const re of patterns) {
    const m = region.match(re);
    const n = parsePriceFromString(m?.[1]);
    if (n != null && isPlausibleProductPrice(n)) return n;
  }
  return extractGenericVisiblePdpPrice(region);
}

function slicePdpPriceRegion(html: string): string {
  let titleIndex = -1;
  const titlePatterns = [
    /id=["']productTitle["']/i,
    /<h1[^>]*(?:itemprop=["']name["']|data-testid=["']product-title|data-test=["']product-title)[^>]*>/i,
    /data-automation-id=["']product-title["']/i,
    /id=["'](?:Heading|sku-title-heading|productHeading)["']/i,
  ];
  for (const re of titlePatterns) {
    const m = re.exec(html);
    if (m?.index != null) titleIndex = Math.max(titleIndex, m.index);
  }

  const buyboxPatterns = [
    /id=["'](?:corePrice|priceblock|buybox)[^"']*/i,
    /data-test(?:id)?=["'][^"']*(?:product-price|customer-price|add-to-cart)/i,
    /(?:add[\s-]*to[\s-]*cart|buy\s+now)/i,
  ];
  for (const re of buyboxPatterns) {
    const m = re.exec(html);
    if (m?.index != null) {
      return html.slice(Math.max(0, m.index - 400), m.index + 18_000);
    }
  }

  if (titleIndex >= 0) return html.slice(titleIndex, titleIndex + 24_000);
  return html.slice(0, 80_000);
}

function extractGenericVisiblePdpPrice(html: string): number | null {
  const region = slicePdpPriceRegion(html);
  const candidates: number[] = [];
  const patterns = [
    /\$\s*([0-9]{1,6}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/g,
    /\bUSD\s*([0-9]{1,6}(?:,[0-9]{3})*(?:\.[0-9]{2})?)\b/gi,
  ];
  for (const re of patterns) {
    for (const m of region.matchAll(re)) {
      const idx = m.index ?? 0;
      if (rejectPriceInContext(region, idx, m[0] ?? "")) continue;
      const n = parsePriceFromString(m[1]);
      if (n != null && isPlausibleProductPrice(n)) candidates.push(n);
    }
  }
  return pickPrimaryPdpPriceFromCandidates(candidates);
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

  const h1Retail = tryRetailStructuredH1(html);
  if (h1Retail) return h1Retail;

  const og = getMetaProperty(html, "og:title");
  if (og && og.trim()) return og.trim();

  return null;
}

/** DOM-only retailer price peek — used to reject bad JSON-LD outliers. */
function peekRetailerDomPrice(html: string, host: string): number | null {
  if (isAmazonHostname(host)) return extractAmazonPdpPrice(html);
  if (/walmart\.com/i.test(host)) return extractWalmartPdpPrice(html);
  if (/target\.com/i.test(host)) return extractTargetPdpPrice(html);
  if (
    /homedepot\.com/i.test(host) ||
    /lowes\.com/i.test(host) ||
    /bestbuy\.com/i.test(host)
  ) {
    return extractBigBoxRetailerPdpPrice(html);
  }
  return extractGenericVisiblePdpPrice(html);
}

function pickPrice(
  html: string,
  jsonLd: ReturnType<typeof extractFromJsonLd>,
  url: string
): {
  price: number | null;
  currency: string;
  priceSource: PriceExtractionSource;
} {
  const store = detectStoreFromProductUrl(url) ?? "unknown";
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  const isWalmart = /walmart\.com/i.test(host);
  const isAmazon = isAmazonHostname(host);
  const isTarget = /target\.com/i.test(host);
  const isBigBox =
    /homedepot\.com/i.test(host) ||
    /lowes\.com/i.test(host) ||
    /bestbuy\.com/i.test(host);

  let price: number | null = null;
  let priceSource: PriceExtractionSource = null;

  const accept = (
    value: number | null,
    source: PriceExtractionSource,
    label: string
  ): boolean => {
    if (value == null) return false;
    if (!isPlausibleProductPrice(value)) {
      logReferencePriceRejected({
        value,
        reason: "implausible_range",
        source: label,
        store,
      });
      return false;
    }
    price = value;
    priceSource = source;
    logReferencePriceExtracted({
      price: value,
      source: label,
      store,
      url,
    });
    return true;
  };

  const jsonLdPrice = jsonLd.price ?? null;
  const domPeek = peekRetailerDomPrice(html, host);
  const jsonLdUsable =
    jsonLdPrice != null &&
    isPlausibleProductPrice(jsonLdPrice) &&
    !(
      domPeek != null &&
      domPeek > jsonLdPrice &&
      domPeek / jsonLdPrice >= 5
    );

  if (!jsonLdUsable && jsonLdPrice != null && domPeek != null && domPeek > jsonLdPrice) {
    logReferencePriceRejected({
      value: jsonLdPrice,
      reason: "json_ld_dom_mismatch",
      source: "json_ld",
      store,
    });
  }

  if (
    !(jsonLdUsable && accept(jsonLdPrice, "json_ld", "json_ld")) &&
    !accept(
      parsePriceFromString(getMetaProperty(html, "og:price:amount")),
      "open_graph",
      "og:price:amount"
    ) &&
    !accept(
      parsePriceFromString(getMetaProperty(html, "product:price:amount")),
      "open_graph",
      "product:price:amount"
    ) &&
    !accept(tryTwitterCardPrice(html), "open_graph", "twitter:data1") &&
    !accept(tryMetaAndItempropPrice(html), "meta_itemprop", "meta_itemprop") &&
    !(isWalmart && accept(extractWalmartPdpPrice(html), "retailer_specific", "walmart_pdp")) &&
    !(isAmazon && accept(extractAmazonPdpPrice(html), "retailer_specific", "amazon_pdp")) &&
    !(isTarget && accept(extractTargetPdpPrice(html), "retailer_specific", "target_pdp")) &&
    !(
      isBigBox &&
      accept(extractBigBoxRetailerPdpPrice(html), "retailer_specific", "bigbox_pdp")
    ) &&
    !accept(extractGenericVisiblePdpPrice(html), "visible_usd", "visible_pdp_region")
  ) {
    /* no confident price */
  }

  if (price == null) {
    logReferencePriceMissing({
      reason: "no_confident_pdp_price",
      store,
      url,
    });
  }

  const currency =
    getMetaProperty(html, "og:price:currency") ||
    getMetaProperty(html, "product:price:currency") ||
    jsonLd.currency ||
    "USD";

  return { price, currency, priceSource };
}

/**
 * Fetches a product page with stealth (Chrome/macOS) headers and extracts name/price
 * via DOM/meta patterns first, then JSON-LD in application/ld+json, then og:price.
 */
export async function scrapeProduct(
  url: string,
  options?: { headers?: HeadersInit }
): Promise<ScrapedProduct | null> {
  let html: string;
  try {
    const res = await fetch(url, {
      headers: options?.headers ?? STEALTH_HEADERS,
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

  let productName = pickTitle(html, host, jsonLd) ?? null;

  const { price, currency, priceSource } = pickPrice(html, jsonLd, url);

  if (!productName) {
    const ogTitle = getMetaProperty(html, "og:title");
    if (ogTitle?.trim()) productName = ogTitle.trim();
  }

  if (!productName) {
    const docTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (docTitle?.[1]) productName = stripTags(docTitle[1]).trim();
  }

  /** Last-rescue: visible H1 heuristic for Temu/Target/Best Buy-style shells */
  if (!productName) {
    productName = tryRetailStructuredH1(html);
  }

  if (productName) {
    productName = polishRetailerListingTitle(productName, host);
  }

  /** Meta / Json-Ld identity crumbs still useful when title is storefront-only */
  const metaBrandHint =
    getMetaProperty(html, "product:brand") ||
    getMetaProperty(html, "brand") ||
    null;

  const brandMergedRaw = mergeLongestTextLine(jsonLd.brand, metaBrandHint);
  const brandLine = brandMergedRaw.trim()
    ? stripTags(brandMergedRaw).trim() || null
    : null;

  const skuRaw = jsonLd.sku?.trim() || "";
  const skuLine = skuRaw.length >= 4 ? skuRaw : null;

  /** Prefer concise model / MPN for logs and rescue strings */
  const modelLineCandidateRaw = mergeLongestTextLine(jsonLd.model, jsonLd.mpn);
  let modelLine =
    modelLineCandidateRaw.trim().length >= 4 ? modelLineCandidateRaw.trim() : null;

  if (skuLine && modelLine && skuLine.trim() === modelLine.trim())
    modelLine = null;

  /** Category breadcrumbs from JSON-LD */
  const ctTrail = jsonLd.category?.trim();
  const categoryTrail =
    ctTrail && ctTrail.length >= 4 ? ctTrail : null;

  const ogImage =
    getMetaProperty(html, "og:image") ||
    getMetaProperty(html, "twitter:image") ||
    null;
  const imageUrl =
    ogImage?.trim().startsWith("http") ? ogImage.trim() : null;

  return {
    productName: productName?.trim() || "",
    price,
    currency: currency || "USD",
    priceSource: price != null ? priceSource : null,
    imageUrl,
    brand: brandLine,
    sku: skuLine,
    model: modelLine,
    category: categoryTrail,
  };
}

/** Compact PDP hints for `SourceProduct.scrapedHints` — safe to omit when scrape failed. */
export function toSourceScrapedHints(
  scraped: ScrapedProduct | null | undefined
): SourceScrapedHints | undefined {
  if (!scraped) return undefined;
  const categoryTrail = scraped.category?.trim() || null;
  const retailerSku = scraped.sku?.trim() || null;
  const modelOrMpn = scraped.model?.trim() || null;
  const brand = scraped.brand?.trim() || null;
  if (!categoryTrail && !retailerSku && !modelOrMpn && !brand) return undefined;
  return { categoryTrail, retailerSku, modelOrMpn, brand };
}

function attachDetachedScrapedBrand(
  productTitle: string,
  scraped: ScrapedProduct | null
): string {
  const line = productTitle.replace(/\s+/g, " ").trim();
  const b = scraped?.brand?.replace(/\s+/g, " ").trim();
  if (!b || b.length < 2) return line;
  if (!line) return b;
  const low = line.toLowerCase();
  const bl = b.toLowerCase().replace(/\s+/g, " ");
  if (low.includes(bl)) return line;
  if (/\b(low|high)voltage\b/i.test(low) && bl === "lowe") return line;
  return `${b} ${line}`.replace(/\s+/g, " ").trim();
}

export type ShoppingTitlePrimarySource =
  | "scraped_listing"
  | "scraped_identity"
  | "slug_path"
  | "weak_scraped_listing";

/** Choose Google-Shopping-facing title: PDP scrape when trustworthy, URL slug fallback otherwise. */
export function composeRetailShoppingTitleFromPdp(opts: {
  scraped: ScrapedProduct | null;
  slugDerivedQueryLine: string;
}): {
  primaryTitle: string;
  primarySource: ShoppingTitlePrimarySource;
} {
  const scraped = opts.scraped;
  const slug = opts.slugDerivedQueryLine.replace(/\s+/g, " ").trim();
  const listing = scraped?.productName?.replace(/\s+/g, " ").trim() ?? "";

  const slugOk =
    slug.length >= 5 &&
    !isGenericRetailProductQuery(slug) &&
    !looksLikeAmazonAsinToken(slug);

  const scrapedListingOk =
    listing.length >= 5 &&
    !isGenericRetailProductQuery(listing) &&
    !/^product$/i.test(listing);

  const brand = scraped?.brand?.trim() ?? "";
  const sku = scraped?.sku?.trim() ?? "";
  const mdl = scraped?.model?.trim() ?? "";
  const salvageParts: string[] = [];
  if (brand) salvageParts.push(brand);
  if (mdl) salvageParts.push(mdl);
  else if (sku) salvageParts.push(sku);
  const salvageLine = salvageParts.join(" ").trim();
  const salvageOk =
    salvageLine.length >= 6 && !isGenericRetailProductQuery(salvageLine);

  let primaryTitle: string;
  let primarySource: ShoppingTitlePrimarySource;

  if (scrapedListingOk) {
    primaryTitle = listing;
    primarySource = "scraped_listing";
  } else if (salvageOk) {
    primaryTitle = salvageLine;
    primarySource = "scraped_identity";
  } else if (slugOk) {
    primaryTitle = slug;
    primarySource = "slug_path";
  } else if (listing.length >= 10) {
    primaryTitle = listing;
    primarySource = "weak_scraped_listing";
  } else if (listing.length >= 6) {
    primaryTitle = listing;
    primarySource = "weak_scraped_listing";
  } else if (listing.length >= 1) {
    primaryTitle = listing;
    primarySource = "weak_scraped_listing";
  } else if (slug.length >= 4 && !looksLikeAmazonAsinToken(slug)) {
    primaryTitle = slug;
    primarySource = "slug_path";
  } else {
    primaryTitle = salvageLine || slug || listing;
    primarySource =
      salvageLine.length >= 3
        ? "scraped_identity"
        : slug
          ? "slug_path"
          : "weak_scraped_listing";
  }

  primaryTitle = attachDetachedScrapedBrand(primaryTitle, scraped);

  if (
    primaryTitle &&
    isGenericRetailProductQuery(primaryTitle) &&
    slugOk
  ) {
    primaryTitle = attachDetachedScrapedBrand(slug, scraped).trim();
    primarySource = "slug_path";
  }

  return {
    primaryTitle: primaryTitle.replace(/\s+/g, " ").trim(),
    primarySource,
  };
}

export function logRetailPdpShoppingIdentity(args: {
  store: StoreId;
  title: string;
  brand: string | null;
  model: string | null;
  fallbackUsed: boolean;
}): void {
  console.log("[PDP_SOURCE_STORE]", args.store);
  console.log("[PDP_TITLE]", args.title);
  console.log("[PDP_BRAND]", args.brand ?? "");
  console.log("[PDP_MODEL]", args.model ?? "");
  console.log("[PDP_FALLBACK_USED]", args.fallbackUsed);
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

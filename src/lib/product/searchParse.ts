import {
  fetchSearchPageHtml,
  fetchSearchPageHtmlDetailed,
} from "./scrapeProduct";

export type ParsedSearchCandidate = {
  title: string;
  price: number | null;
  currency: string;
  productUrl: string;
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

function parsePriceFromString(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function dedupeByProductUrl(items: ParsedSearchCandidate[]): ParsedSearchCandidate[] {
  const seen = new Set<string>();
  const out: ParsedSearchCandidate[] = [];
  for (const item of items) {
    const key = item.productUrl.split("?")[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function extractAmazonTitle(block: string): string | null {
  const aria = block.match(/<h2[^>]*aria-label="([^"]+)"/i);
  if (aria?.[1]) {
    const t = aria[1]
      .replace(/^Sponsored Ad\s*-\s*/i, "")
      .replace(/^Amazon's Choice:\s*/i, "")
      .trim();
    if (t.length >= 3) return decodeHtmlEntities(t);
  }
  const spanInH2 = block.match(
    /<h2[^>]*class="[^"]*a-size-medium[^"]*"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/i
  );
  if (spanInH2?.[1]) return decodeHtmlEntities(spanInH2[1].trim());
  const textNorm = block.match(
    /<span[^>]*class="[^"]*a-text-normal[^"]*"[^>]*>([^<]+)<\/span>/i
  );
  if (textNorm?.[1]) return decodeHtmlEntities(textNorm[1].trim());
  return null;
}

function extractAmazonPrice(block: string): number | null {
  const offscreens = [...block.matchAll(/class="a-offscreen"[^>]*>\s*([^<]+)</gi)];
  for (const m of offscreens) {
    const n = parsePriceFromString(m[1]);
    if (n != null && n > 0) return n;
  }
  const whole = block.match(/class="a-price-whole"[^>]*>([0-9,]+)/i);
  const frac = block.match(/class="a-price-fraction"[^>]*>([0-9]+)/i);
  if (whole?.[1] && frac?.[1]) {
    const n = parseFloat(`${whole[1].replace(/,/g, "")}.${frac[1]}`);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function extractAmazonAsinAndHref(block: string): { asin: string; productUrl: string } | null {
  const m = block.match(/href="([^"]*\/dp\/([A-Z0-9]{10})[^"]*)"/i);
  if (!m?.[2]) return null;
  const asin = m[2];
  return {
    asin,
    productUrl: `https://www.amazon.com/dp/${asin}`,
  };
}

/**
 * Parses organic/sponsored search tiles from an Amazon SERP HTML document.
 */
export function parseAmazonSearchHtml(
  html: string,
  limit = 12
): ParsedSearchCandidate[] {
  if (!html.includes("data-component-type=\"s-search-result\"")) {
    return [];
  }

  const parts = html.split(/data-component-type=["']s-search-result["']/i);
  const out: ParsedSearchCandidate[] = [];

  for (let i = 1; i < parts.length && out.length < limit; i++) {
    const block = parts[i];
    const link = extractAmazonAsinAndHref(block);
    if (!link) continue;

    const title = extractAmazonTitle(block);
    if (!title || title.length < 3) continue;

    const price = extractAmazonPrice(block);

    out.push({
      title,
      price,
      currency: "USD",
      productUrl: link.productUrl,
    });
  }

  return dedupeByProductUrl(out).slice(0, limit);
}

function extractWalmartIpFromContext(before: string): string | null {
  const direct = before.match(/https:\/\/www\.walmart\.com\/ip\/[^"?\s]+/i);
  if (direct?.[0]) return direct[0].split("?")[0];

  const rd = before.match(/rd=(https%3A%2F%2Fwww\.walmart\.com%2Fip%2F[^&]+)/i);
  if (rd?.[1]) {
    try {
      return decodeURIComponent(rd[1]).split("?")[0];
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Parses product tiles from a Walmart search HTML document (when not blocked by bot interstitials).
 */
export function parseWalmartSearchHtml(
  html: string,
  limit = 12
): ParsedSearchCandidate[] {
  if (/Robot or human/i.test(html)) {
    return [];
  }

  const out: ParsedSearchCandidate[] = [];
  let pos = 0;

  while (out.length < limit) {
    const titleMarker = html.indexOf('data-automation-id="product-title"', pos);
    if (titleMarker === -1) break;

    const h3open = html.indexOf("<h3", titleMarker);
    if (h3open === -1 || h3open > titleMarker + 80) {
      pos = titleMarker + 20;
      continue;
    }
    const h3close = html.indexOf("</h3>", h3open);
    if (h3close === -1) break;

    const inner = html.slice(h3open, h3close);
    const title = stripTags(inner.replace(/^<h3\b[^>]*>/i, "")).trim();

    const chunk = html.slice(titleMarker, titleMarker + 5000);
    let price: number | null = null;
    const cur = chunk.match(/current price \$\s*([\d]+\.[\d]{2})/i);
    if (cur?.[1]) {
      price = parseFloat(cur[1]);
      if (!Number.isFinite(price)) price = null;
    }
    if (price == null) {
      const parts = chunk.match(
        /aria-hidden="true"[^>]*data-test-id="gpt-main-price-display"[\s\S]*?\$\s*<\/span>\s*<span[^>]*>(\d+)<\/span>\s*<span[^>]*>(\d+)<\/span>/i
      );
      if (parts?.[1] != null && parts?.[2] != null) {
        price = parseFloat(`${parts[1]}.${parts[2]}`);
        if (!Number.isFinite(price)) price = null;
      }
    }

    const before = html.slice(Math.max(0, titleMarker - 8000), titleMarker);
    const productUrl = extractWalmartIpFromContext(before);

    if (title.length >= 3 && productUrl) {
      out.push({
        title,
        price,
        currency: "USD",
        productUrl,
      });
    }

    pos = h3close + 5;
  }

  return dedupeByProductUrl(out).slice(0, limit);
}

export async function fetchParsedAmazonSearch(
  query: string,
  limit = 12
): Promise<ParsedSearchCandidate[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(q)}`;
  const html = await fetchSearchPageHtml(url);
  if (!html) return [];
  return parseAmazonSearchHtml(html, limit);
}

export async function fetchParsedWalmartSearch(
  query: string,
  limit = 12
): Promise<ParsedSearchCandidate[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `https://www.walmart.com/search?q=${encodeURIComponent(q)}`;
  const html = await fetchSearchPageHtml(url);
  if (!html) return [];
  return parseWalmartSearchHtml(html, limit);
}

/** Structured SERP fetch outcome for logs and scaling. */
export type StoreSerpDiagnostics = {
  store: "amazon" | "walmart";
  url: string;
  fetchOk: boolean;
  httpStatus: number | null;
  byteLength: number;
  candidateCount: number;
  hints: string[];
};

function amazonSerpHints(
  html: string | null,
  candidateCount: number
): string[] {
  const hints: string[] = [];
  if (html == null) {
    hints.push("fetch_returned_no_html");
    return hints;
  }
  if (!html.includes('data-component-type="s-search-result"')) {
    hints.push("parser_marker_missing_s_search_result");
  }
  if (/api-services-support|Enter the characters you see/i.test(html)) {
    hints.push("possible_bot_or_captcha_page");
  }
  if (/sorry.*we couldn|try.*different.*keyword/i.test(html)) {
    hints.push("possible_block_or_error_page");
  }
  if (candidateCount === 0 && html.length > 8000) {
    hints.push("zero_candidates_despite_large_html");
  }
  return hints;
}

function walmartSerpHints(
  html: string | null,
  candidateCount: number
): string[] {
  const hints: string[] = [];
  if (html == null) {
    hints.push("fetch_returned_no_html");
    return hints;
  }
  if (/Robot or human/i.test(html)) {
    hints.push("walmart_bot_interstitial");
  }
  if (candidateCount === 0 && html.length > 8000) {
    hints.push("zero_candidates_despite_large_html");
  }
  return hints;
}

export async function fetchAmazonSerpWithDiagnostics(
  query: string,
  limit = 12
): Promise<{
  candidates: ParsedSearchCandidate[];
  diagnostics: StoreSerpDiagnostics;
}> {
  const q = query.trim();
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(q)}`;
  if (!q) {
    return {
      candidates: [],
      diagnostics: {
        store: "amazon",
        url,
        fetchOk: false,
        httpStatus: null,
        byteLength: 0,
        candidateCount: 0,
        hints: ["empty_query"],
      },
    };
  }

  const { html, httpStatus, byteLength } =
    await fetchSearchPageHtmlDetailed(url);
  const candidates = html
    ? parseAmazonSearchHtml(html, limit)
    : [];
  const diagnostics: StoreSerpDiagnostics = {
    store: "amazon",
    url,
    fetchOk: html != null && html.length > 0,
    httpStatus,
    byteLength,
    candidateCount: candidates.length,
    hints: amazonSerpHints(html, candidates.length),
  };
  return { candidates, diagnostics };
}

export async function fetchWalmartSerpWithDiagnostics(
  query: string,
  limit = 12
): Promise<{
  candidates: ParsedSearchCandidate[];
  diagnostics: StoreSerpDiagnostics;
}> {
  const q = query.trim();
  const url = `https://www.walmart.com/search?q=${encodeURIComponent(q)}`;
  if (!q) {
    return {
      candidates: [],
      diagnostics: {
        store: "walmart",
        url,
        fetchOk: false,
        httpStatus: null,
        byteLength: 0,
        candidateCount: 0,
        hints: ["empty_query"],
      },
    };
  }

  const { html, httpStatus, byteLength } =
    await fetchSearchPageHtmlDetailed(url);
  const candidates = html
    ? parseWalmartSearchHtml(html, limit)
    : [];
  const diagnostics: StoreSerpDiagnostics = {
    store: "walmart",
    url,
    fetchOk: html != null && html.length > 0,
    httpStatus,
    byteLength,
    candidateCount: candidates.length,
    hints: walmartSerpHints(html, candidates.length),
  };
  return { candidates, diagnostics };
}

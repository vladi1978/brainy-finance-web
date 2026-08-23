/**
 * Universal retailer search SERP → PDP resolution (any product category, any store host).
 * Store-specific strict checks are optional precision boosts only.
 */
import {
  extractBrand,
  extractModelTokens,
  normalizeTitle,
  tokenizeSignificant,
} from "./normalize";
import {
  isProductDetailStoreKey,
  isProductLikeRetailerUrl,
  isStrictProductDetailUrl,
  type ProductDetailStoreKey,
} from "./productDetailUrl";
import { getOutboundUrlBlockReason } from "./outboundUrlValidation";
import type { UniversalStoreId } from "./types";

const PDP_DEBUG = process.env.PDP_UNIVERSAL_DEBUG === "1";

/** Minimum title/slug overlap to accept a PDP pick from search HTML. */
export const UNIVERSAL_PDP_MIN_MATCH_SCORE = 0.22;

/** Minimum score to upgrade outbound from search → product (do not fake PDPs below this). */
export const UNIVERSAL_PDP_SAFE_MATCH_SCORE = 0.42;

export type UniversalSearchPdpPick = {
  productUrl: string;
  anchorText: string;
  matchScore: number;
  confidence: "medium" | "high";
};

const UNIVERSAL_PDP_PATH_TESTS: readonly RegExp[] = [
  /\/dp\/[a-z0-9]{8,12}\b/i,
  /\/gp\/product\/[a-z0-9]{8,12}\b/i,
  /\/gp\/aw\/d\/[a-z0-9]{8,12}\b/i,
  /\/ip\/[^/]+\/\d{5,}/i,
  /\/p\/[^/]+\/[^/]+/i,
  /\/pd\/[^/]{3,}/i,
  /\/product\/[^/]{3,}/i,
  /\/products\/[^/]{3,}/i,
  /\/item\/[^/]{3,}/i,
  /\/items\/[^/]{3,}/i,
  /\/itm\/\d{5,}/i,
  /\/site\/[^/]+\/\d+\.p\b/i,
  /\/tsc\/product\/[^/]+/i,
  /\/sku\/\d{4,}/i,
  /\.html$/i,
];

const NON_PDP_PATH_TESTS: readonly RegExp[] = [
  /\/search\b/i,
  /searchpage\.jsp/i,
  /search_result/i,
  /keyword\.php/i,
  /\/tsc\/search/i,
  /\/sch\/i\.html/i,
  /\/catalogsearch/i,
  /\/gp\/browse/i,
  /\/cart\b/i,
  /\/checkout\b/i,
  /\/account\b/i,
  /\/login\b/i,
  /\/category\b/i,
  /\/redirect\b/i,
  /\/rd\//i,
];

function normHost(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

function pdpDebug(payload: Record<string, unknown>): void {
  if (!PDP_DEBUG) return;
  console.log("[PDP_UNIVERSAL]", payload);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function hostAllowedForSearchFetch(host: string): boolean {
  const h = normHost(host);
  if (!h.includes(".")) return false;
  if (h.split(".").includes("google")) return false;
  if (h === "schema.org") return false;
  return getOutboundUrlBlockReason(`https://${h}/`) === null;
}

/**
 * True when the URL is a retailer-hosted search/browse page (not a PDP), any store.
 */
export function isUniversalRetailerSearchUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed.startsWith("http")) return false;
  if (getOutboundUrlBlockReason(trimmed) !== null) return false;

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return false;
  }

  if (!/^https?:$/i.test(u.protocol)) return false;
  const host = normHost(u.hostname);
  if (!hostAllowedForSearchFetch(host)) return false;

  const path = u.pathname;
  const pl = path.toLowerCase();
  const hrefLower = u.href.toLowerCase();

  if (pl === "" || pl === "/") return false;

  if (isUniversalPdpCandidateUrl(trimmed)) return false;

  for (const re of NON_PDP_PATH_TESTS) {
    if (re.test(pl) || re.test(hrefLower)) return true;
  }

  if (pl === "/s" || pl.startsWith("/s/")) {
    const sp = u.searchParams;
    if (
      sp.has("k") ||
      sp.has("q") ||
      sp.has("searchterm") ||
      sp.has("search_term") ||
      sp.has("st") ||
      sp.has("query") ||
      sp.has("keyword")
    ) {
      return true;
    }
    if (host.endsWith("homedepot.com") && /^\/s\/[^/]+\/?$/i.test(pl)) return true;
    if (host.endsWith("walmart.com") && pl.startsWith("/s")) return true;
  }

  if (
    hrefLower.includes("searchterm=") ||
    hrefLower.includes("?q=") ||
    hrefLower.includes("&q=") ||
    hrefLower.includes("?k=") ||
    hrefLower.includes("&k=") ||
    hrefLower.includes("?st=") ||
    hrefLower.includes("_nkw=") ||
    hrefLower.includes("search_key=") ||
    hrefLower.includes("keywords=")
  ) {
    return true;
  }

  return false;
}

function pathHasLongProductId(pathname: string): boolean {
  const segs = pathname.split("/").filter(Boolean);
  for (const seg of segs) {
    const clean = seg.replace(/\.html?$/i, "");
    if (/^\d{6,}$/.test(clean)) return true;
    if (/^[a-z0-9]{10,}$/i.test(clean) && /\d/.test(clean)) return true;
  }
  return false;
}

/**
 * Product-detail URL shape using universal path heuristics (unknown stores included).
 */
export function isUniversalPdpCandidateUrl(
  url: string,
  opts?: { searchPageHost?: string }
): boolean {
  const trimmed = url.trim();
  if (!trimmed.startsWith("http")) return false;
  if (getOutboundUrlBlockReason(trimmed) !== null) return false;

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return false;
  }

  if (!/^https?:$/i.test(u.protocol)) return false;

  const host = normHost(u.hostname);
  if (!hostAllowedForSearchFetch(host)) return false;

  if (opts?.searchPageHost) {
    const searchHost = normHost(opts.searchPageHost);
    if (host !== searchHost && !host.endsWith(`.${searchHost}`)) return false;
  }

  const path = u.pathname;
  const pl = path.toLowerCase();
  const hrefLower = u.href.toLowerCase();

  if (pl === "" || pl === "/") return false;

  for (const re of NON_PDP_PATH_TESTS) {
    if (re.test(pl) || re.test(hrefLower)) return false;
  }

  if (pl === "/s" || /^\/s\/[^/]+\/?$/i.test(pl)) {
    if (
      u.searchParams.has("k") ||
      u.searchParams.has("q") ||
      u.searchParams.has("searchterm")
    ) {
      return false;
    }
    if (host.endsWith("homedepot.com")) return false;
  }

  for (const re of UNIVERSAL_PDP_PATH_TESTS) {
    if (re.test(path)) return true;
  }

  if (pathHasLongProductId(path) && path.split("/").filter(Boolean).length >= 2) {
    return true;
  }

  return false;
}

function storeAdapterConfirmsPdp(
  store: UniversalStoreId,
  productUrl: string
): boolean {
  if (!isProductDetailStoreKey(store)) return false;
  const s = store as ProductDetailStoreKey;
  return (
    isStrictProductDetailUrl(s, productUrl) ||
    isProductLikeRetailerUrl(s, productUrl)
  );
}

function slugTokensFromUrl(productUrl: string): string[] {
  try {
    const u = new URL(productUrl);
    const parts = u.pathname
      .replace(/\.html?$/i, "")
      .split(/[/\-_+]+/)
      .filter(Boolean);
    return tokenizeSignificant(parts.join(" "));
  } catch {
    return [];
  }
}

/**
 * Generic overlap: candidate title vs anchor text, URL slug, optional brand, model tokens.
 */
export function scoreUniversalPdpCandidateMatch(args: {
  candidateTitle: string;
  anchorText: string;
  productUrl: string;
  brandHint?: string | null;
}): number {
  const { candidateTitle, anchorText, productUrl, brandHint } = args;
  const cand = new Set(tokenizeSignificant(candidateTitle));
  if (cand.size === 0) return 0;

  const anchor = new Set(tokenizeSignificant(anchorText));
  const slug = new Set(slugTokensFromUrl(productUrl));

  let interAnchor = 0;
  let interSlug = 0;
  for (const t of cand) {
    if (anchor.has(t)) interAnchor += 1;
    if (slug.has(t)) interSlug += 1;
  }

  const anchorScore = interAnchor / cand.size;
  const slugScore = interSlug / cand.size;
  let score = Math.max(anchorScore, slugScore * 0.92);

  const models = extractModelTokens(candidateTitle);
  if (models.length > 0) {
    const blob = `${anchorText} ${productUrl}`.toLowerCase();
    let hits = 0;
    for (const m of models) {
      if (blob.includes(m)) hits += 1;
    }
    score += (hits / models.length) * 0.22;
  }

  const brand =
    brandHint?.trim() ||
    extractBrand(candidateTitle);
  if (brand) {
    const b = normalizeTitle(brand).replace(/\s+/g, "");
    const blob = `${anchorText} ${productUrl}`.toLowerCase().replace(/\s+/g, "");
    if (b.length >= 3 && blob.includes(b)) score += 0.07;
  }

  return Math.min(0.98, score);
}

function isSafeToUpgradePdp(args: {
  store: UniversalStoreId;
  productUrl: string;
  matchScore: number;
}): boolean {
  const { store, productUrl, matchScore } = args;
  if (matchScore < UNIVERSAL_PDP_MIN_MATCH_SCORE) return false;
  if (matchScore >= UNIVERSAL_PDP_SAFE_MATCH_SCORE) return true;

  if (storeAdapterConfirmsPdp(store, productUrl)) {
    return matchScore >= 0.2;
  }

  if (isUniversalPdpCandidateUrl(productUrl) && matchScore >= 0.3) {
    try {
      if (pathHasLongProductId(new URL(productUrl).pathname)) return true;
    } catch {
      /* ignore */
    }
  }

  return false;
}

function resolveHref(base: URL, href: string): string | null {
  const h = decodeHtmlEntities(href.trim());
  if (!h || h.startsWith("#") || /^javascript:/i.test(h)) return null;
  try {
    if (h.startsWith("//")) return new URL(`https:${h}`).href;
    if (h.startsWith("http")) return new URL(h).href;
    return new URL(h, base).href;
  } catch {
    return null;
  }
}

function anchorTextNearHref(html: string, hrefIndex: number): string {
  const windowStart = Math.max(0, hrefIndex - 420);
  // Long absolute hrefs + indented anchor text often sit beyond +80 chars.
  const chunk = html.slice(windowStart, hrefIndex + 280);
  const attrs = [
    ...chunk.matchAll(/(?:aria-label|title|data-name|alt)=["']([^"']{3,200})["']/gi),
  ];
  for (let i = attrs.length - 1; i >= 0; i--) {
    const t = decodeHtmlEntities(attrs[i]![1]!.trim());
    if (t.length >= 3) return t;
  }
  const textSpans = [
    ...chunk.matchAll(/>([^<]{4,180})</g),
  ];
  for (let i = textSpans.length - 1; i >= 0; i--) {
    const t = decodeHtmlEntities(textSpans[i]![1]!.replace(/\s+/g, " ").trim());
    if (t.length >= 4 && !/^[\d$.,\s]+$/.test(t)) return t;
  }
  return "";
}

function anchorTextNearJsonUrl(html: string, idx: number): string {
  const windowStart = Math.max(0, idx - 700);
  const chunk = html.slice(windowStart, idx + 220);
  const fieldMatches = [
    ...chunk.matchAll(
      /"(?:title|name|productName|displayName|shortDescription)"\s*:\s*"([^"]{4,220})"/gi
    ),
  ];
  for (let i = fieldMatches.length - 1; i >= 0; i--) {
    const t = decodeHtmlEntities(fieldMatches[i]![1]!.replace(/\\u0026/g, "&"))
      .replace(/\\"/g, '"')
      .replace(/\s+/g, " ")
      .trim();
    if (t.length >= 4 && !/^[\d$.,\s]+$/.test(t)) return t;
  }
  return "";
}

/**
 * Scan search HTML for same-host PDP links and anchor context (no store-specific selectors).
 */
export function extractUniversalPdpLinksFromSearchHtml(
  html: string,
  searchUrl: string,
  maxLinks = 80
): { productUrl: string; anchorText: string }[] {
  if (!html?.trim()) return [];

  let base: URL;
  try {
    base = new URL(searchUrl);
  } catch {
    return [];
  }

  const searchHost = base.hostname;
  const seen = new Set<string>();
  const out: { productUrl: string; anchorText: string }[] = [];

  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const resolved = resolveHref(base, m[1]!);
    if (!resolved) continue;
    if (!isUniversalPdpCandidateUrl(resolved, { searchPageHost: searchHost })) continue;

    const key = resolved.split("?")[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const anchorText = anchorTextNearHref(html, m.index);
    out.push({ productUrl: resolved, anchorText });
    if (out.length >= maxLinks) break;
  }

  if (out.length < maxLinks) {
    const jsonUrlRe =
      /"(?:url|link|productUrl|canonicalUrl)"\s*:\s*"(https?:\/\/[^"]+)"/gi;
    while ((m = jsonUrlRe.exec(html)) !== null) {
      const jsonUrl = m[1]!.replace(/\\\//g, "/");
      const resolved = resolveHref(base, jsonUrl);
      if (!resolved) continue;
      if (!isUniversalPdpCandidateUrl(resolved, { searchPageHost: searchHost })) continue;

      const key = resolved.split("?")[0].toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const anchorText = anchorTextNearJsonUrl(html, m.index);
      out.push({ productUrl: resolved, anchorText });
      if (out.length >= maxLinks) break;
    }
  }

  return out;
}

export function pickBestUniversalPdpFromCandidates(args: {
  candidateTitle: string;
  brandHint?: string | null;
  store: UniversalStoreId;
  picks: { productUrl: string; anchorText: string }[];
  requiredSpecTokens?: string[];
}): UniversalSearchPdpPick | null {
  const { candidateTitle, brandHint, store, picks } = args;
  const requiredSpecTokens = (args.requiredSpecTokens ?? [])
    .map((t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ""))
    .filter((t) => t.length >= 2)
    .slice(0, 12);

  let best: UniversalSearchPdpPick | null = null;
  let bestWeightedScore = -1;

  for (const pick of picks) {
    const baseScore = scoreUniversalPdpCandidateMatch({
      candidateTitle,
      anchorText: pick.anchorText,
      productUrl: pick.productUrl,
      brandHint,
    });
    let weightedScore = baseScore;

    if (requiredSpecTokens.length > 0) {
      const blob = `${pick.anchorText} ${pick.productUrl}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
      let specHits = 0;
      for (const token of requiredSpecTokens) {
        if (blob.includes(token)) specHits += 1;
      }
      const specCoverage = specHits / requiredSpecTokens.length;
      weightedScore += specCoverage * 0.24;
      if (specHits === 0) weightedScore -= 0.08;
    }
    const matchScore = Math.max(0, Math.min(0.98, weightedScore));

    if (!isSafeToUpgradePdp({ store, productUrl: pick.productUrl, matchScore })) {
      continue;
    }

    if (!best || matchScore > bestWeightedScore) {
      best = {
        productUrl: pick.productUrl,
        anchorText: pick.anchorText,
        matchScore,
        confidence: matchScore >= 0.55 ? "high" : "medium",
      };
      bestWeightedScore = matchScore;
    }
  }

  return best;
}

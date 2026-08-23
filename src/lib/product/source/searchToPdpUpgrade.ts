import { extractModelTokens, tokenizeSignificant } from "../normalize";
import { isProductDetailStoreKey, isStrictProductDetailUrl } from "../productDetailUrl";
import {
  extractUniversalPdpLinksFromSearchHtml,
  isUniversalRetailerSearchUrl,
  pickBestUniversalPdpFromCandidates,
} from "../universalSearchToPdp";
import type { NormalizedProduct, UniversalStoreId } from "../types";

const ENABLE_FLAG = "PRODUCT_ENABLE_SEARCH_TO_PDP_UPGRADE";
const TIMEOUT_MS_ENV = "PRODUCT_SEARCH_TO_PDP_TIMEOUT_MS";
const DEFAULT_TIMEOUT_MS = 2500;
const ALLOWED_STORES = new Set<UniversalStoreId>(["walmart", "bestbuy", "homedepot"]);
const MIN_MATCH_SCORE = 0.55;

const ACCESSORY_PART_TERMS = [
  "accessory",
  "accessories",
  "replacement",
  "replacements",
  "part",
  "parts",
  "filter",
  "filters",
  "case",
  "cover",
  "mount",
  "stand",
  "strap",
  "cable",
] as const;

function normalizeHost(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

function timeoutMs(): number {
  const raw = Number(process.env[TIMEOUT_MS_ENV] ?? "");
  if (!Number.isFinite(raw)) return DEFAULT_TIMEOUT_MS;
  return Math.max(300, Math.min(5000, Math.round(raw)));
}

function isEnabled(): boolean {
  return process.env[ENABLE_FLAG] === "true";
}

function isSupportedStore(store: UniversalStoreId): boolean {
  return ALLOWED_STORES.has(store);
}

function hostMatchesRetailer(url: string, retailerHost: string): boolean {
  try {
    const got = normalizeHost(new URL(url).hostname);
    const want = normalizeHost(retailerHost);
    return got === want || got.endsWith(`.${want}`);
  } catch {
    return false;
  }
}

function hasAccessoryOrPartSignals(text: string): boolean {
  const t = text.toLowerCase();
  return ACCESSORY_PART_TERMS.some((term) => t.includes(term));
}

function buildKeySpecTokens(normalized: NormalizedProduct | undefined, title: string): string[] {
  const tokens = new Set<string>();
  const size = normalized?.sizeInches ?? normalized?.structured?.sizeInches ?? null;
  if (typeof size === "number" && Number.isFinite(size) && size > 0) {
    tokens.add(String(Math.round(size)));
  }
  for (const token of extractModelTokens(title)) {
    if (token.length >= 4) tokens.add(token.toLowerCase());
  }
  return [...tokens].slice(0, 10);
}

function keySpecsMatch(args: {
  requiredTokens: string[];
  anchorText: string;
  productUrl: string;
}): boolean {
  const { requiredTokens, anchorText, productUrl } = args;
  if (requiredTokens.length === 0) return true;
  const blob = `${anchorText} ${productUrl}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
  for (const token of requiredTokens) {
    const t = token.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (t.length >= 2 && blob.includes(t)) return true;
  }
  return false;
}

function logUpgrade(event: string, payload: Record<string, unknown>): void {
  console.log("[SEARCH_TO_PDP_UPGRADE]", JSON.stringify({ event, ...payload }));
}

async function fetchHtmlWithTimeout(searchUrl: string, ms: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(searchUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (contentType && !contentType.includes("html")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function attemptSearchToPdpUpgrade(args: {
  store: UniversalStoreId;
  title: string;
  normalized?: NormalizedProduct;
  retailerHost: string;
  searchUrl: string;
}): Promise<{ productUrl: string; confidence: "medium" | "high"; matchScore: number } | null> {
  if (!isEnabled()) {
    logUpgrade("SEARCH_TO_PDP_UPGRADE_SKIPPED", { reason: "flag_off", store: args.store });
    return null;
  }
  if (!isSupportedStore(args.store)) {
    logUpgrade("SEARCH_TO_PDP_UPGRADE_SKIPPED", {
      reason: "store_not_supported",
      store: args.store,
    });
    return null;
  }
  if (!isUniversalRetailerSearchUrl(args.searchUrl)) {
    logUpgrade("SEARCH_TO_PDP_UPGRADE_SKIPPED", {
      reason: "not_search_url",
      store: args.store,
    });
    return null;
  }

  const candidateTitle = args.title.replace(/\s+/g, " ").trim();
  if (!candidateTitle) {
    logUpgrade("SEARCH_TO_PDP_UPGRADE_SKIPPED", {
      reason: "missing_title",
      store: args.store,
    });
    return null;
  }

  logUpgrade("SEARCH_TO_PDP_UPGRADE_ATTEMPT", {
    store: args.store,
    url: args.searchUrl.slice(0, 220),
  });

  const html = await fetchHtmlWithTimeout(args.searchUrl, timeoutMs());
  if (!html) {
    logUpgrade("SEARCH_TO_PDP_UPGRADE_REJECTED", { reason: "fetch_failed", store: args.store });
    return null;
  }

  const sourceLooksAccessory = hasAccessoryOrPartSignals(candidateTitle);
  const rawCandidates = extractUniversalPdpLinksFromSearchHtml(html, args.searchUrl, 60);
  const candidates = rawCandidates.filter((pick) => {
    if (!hostMatchesRetailer(pick.productUrl, args.retailerHost)) return false;
    if (sourceLooksAccessory) return true;
    return !hasAccessoryOrPartSignals(`${pick.anchorText} ${pick.productUrl}`);
  });
  if (candidates.length === 0) {
    logUpgrade("SEARCH_TO_PDP_UPGRADE_REJECTED", {
      reason: "no_candidates",
      store: args.store,
      totalCandidates: rawCandidates.length,
      sourceLooksAccessory,
    });
    return null;
  }

  const best = pickBestUniversalPdpFromCandidates({
    candidateTitle,
    store: args.store,
    picks: candidates,
    requiredSpecTokens: buildKeySpecTokens(args.normalized, candidateTitle),
  });
  if (!best || best.matchScore < MIN_MATCH_SCORE) {
    logUpgrade("SEARCH_TO_PDP_UPGRADE_REJECTED", {
      reason: "low_similarity",
      store: args.store,
      score: best?.matchScore ?? 0,
    });
    return null;
  }

  const requiredTokens = buildKeySpecTokens(args.normalized, candidateTitle);
  if (
    !keySpecsMatch({
      requiredTokens,
      anchorText: best.anchorText,
      productUrl: best.productUrl,
    })
  ) {
    logUpgrade("SEARCH_TO_PDP_UPGRADE_REJECTED", {
      reason: "key_specs_mismatch",
      store: args.store,
    });
    return null;
  }

  if (
    isProductDetailStoreKey(args.store) &&
    !isStrictProductDetailUrl(args.store, best.productUrl)
  ) {
    logUpgrade("SEARCH_TO_PDP_UPGRADE_REJECTED", {
      reason: "not_strict_pdp",
      store: args.store,
    });
    return null;
  }

  const similarTokens = tokenizeSignificant(`${best.anchorText} ${best.productUrl}`);
  if (similarTokens.length === 0) {
    logUpgrade("SEARCH_TO_PDP_UPGRADE_REJECTED", { reason: "uncertain_ranking", store: args.store });
    return null;
  }

  const confidence: "medium" | "high" = best.matchScore >= 0.7 ? "high" : "medium";
  logUpgrade("SEARCH_TO_PDP_UPGRADE_SUCCESS", {
    store: args.store,
    productUrl: best.productUrl.slice(0, 220),
    score: best.matchScore,
  });
  return {
    productUrl: best.productUrl,
    confidence,
    matchScore: best.matchScore,
  };
}

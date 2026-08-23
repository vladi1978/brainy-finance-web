/**
 * Universal merchant PDP URL extraction from Google Shopping / SerpApi rows.
 * Not retailer-specific — unwraps Google redirects and strips tracking noise.
 */
import { scrubKnownNoiseParams } from "./affiliateUrl";
import { isBlockedUserFacingOutboundUrl } from "./productDetailUrl";
import { isGoogleShoppingOverlayUrl } from "./source/linkClassification";

const REDIRECT_PARAM_KEYS = [
  "url",
  "adurl",
  "q",
  "u",
  "target",
  "redirect",
  "r",
] as const;

const TRACKING_REDIRECT_HOSTS = new Set([
  "bit.ly",
  "j.mp",
  "goo.gl",
  "t.co",
  "tinyurl.com",
  "ow.ly",
  "buff.ly",
  "rebrand.ly",
  "cutt.ly",
  "is.gd",
  "adf.ly",
  "g.co",
  "amzn.to",
  "a.co",
  "click.linksynergy.com",
  "linksynergy.com",
  "anrdoezrs.net",
  "dpbolvw.net",
  "kqzyfj.com",
  "awin1.com",
  "shareasale.com",
]);

const MERCHANT_TRACKING_PARAM_PREFIXES = ["utm_"] as const;
const MERCHANT_TRACKING_PARAM_EXACT = new Set([
  "gclid",
  "clickid",
  "wmlspartner",
]);

function logMerchantUrlLine(
  tag:
    | "MERCHANT_URL_EXTRACT_INPUT"
    | "MERCHANT_URL_UNWRAPPED"
    | "PRODUCT_URL_SELECTED"
    | "PRODUCT_URL_FALLBACK_SEARCH_USED"
    | "MERCHANT_URL_REJECTED",
  fields: Record<string, string | null | undefined>,
): void {
  const parts = [
    `[${tag}]`,
    ...Object.entries(fields)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}=${v}`),
  ];
  console.log(parts.join(" "));
}

function normUnwrapHost(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

function hostIsTrackingRedirectDomain(host: string): boolean {
  const h = normUnwrapHost(host);
  if (TRACKING_REDIRECT_HOSTS.has(h)) return true;
  for (const blocked of TRACKING_REDIRECT_HOSTS) {
    if (h.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

function hostIsGoogleOrShoppingRedirect(host: string): boolean {
  const h = normUnwrapHost(host);
  if (h === "google.com" || h.endsWith(".google.com")) return true;
  if (h === "shopping.google.com" || h.endsWith(".shopping.google.com")) return true;
  return false;
}

function hostIsGoogleAdsOrTrackingRedirect(host: string): boolean {
  const h = normUnwrapHost(host);
  if (h === "googleadservices.com" || h.endsWith(".googleadservices.com")) return true;
  if (h === "googlesyndication.com" || h.endsWith(".googlesyndication.com")) return true;
  if (h.includes("doubleclick.net")) return true;
  return false;
}

function isObviousHomepageOnlyUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    const path = u.pathname.replace(/\/+$/, "");
    return path === "" || path === "/";
  } catch {
    return true;
  }
}

function isGoogleInternalOrShoppingRedirect(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed.startsWith("http")) return true;
  if (isGoogleShoppingOverlayUrl(trimmed)) return true;
  try {
    const host = normUnwrapHost(new URL(trimmed).hostname);
    return hostIsGoogleOrShoppingRedirect(host) || hostIsGoogleAdsOrTrackingRedirect(host);
  } catch {
    return true;
  }
}

function safeDecodeUrlParam(value: string): string {
  let s = value.trim();
  for (let i = 0; i < 3; i++) {
    if (!/%[0-9A-Fa-f]{2}/.test(s)) break;
    try {
      const next = decodeURIComponent(s);
      if (next === s) break;
      s = next;
    } catch {
      break;
    }
  }
  return s;
}

function pickNestedHttpTarget(u: URL): string | null {
  for (const key of REDIRECT_PARAM_KEYS) {
    const raw = u.searchParams.get(key);
    if (!raw?.trim()) continue;
    const decoded = safeDecodeUrlParam(raw);
    if (decoded.startsWith("http://") || decoded.startsWith("https://")) return decoded;
    if (decoded.startsWith("//")) return `https:${decoded}`;
  }
  return null;
}

/** Strip utm_*, gclid, ref, clickid, wmlspartner, and related noise from merchant PDP URLs. */
export function scrubMerchantUrlTrackingParams(url: string): string {
  try {
    const u = new URL(url);
    const toDelete: string[] = [];
    for (const key of u.searchParams.keys()) {
      const lower = key.toLowerCase();
      if (MERCHANT_TRACKING_PARAM_EXACT.has(lower)) {
        toDelete.push(key);
        continue;
      }
      for (const prefix of MERCHANT_TRACKING_PARAM_PREFIXES) {
        if (lower.startsWith(prefix)) {
          toDelete.push(key);
          break;
        }
      }
    }
    for (const key of toDelete) u.searchParams.delete(key);
    return u.toString();
  } catch {
    return url;
  }
}

function isAcceptableUnwrappedMerchantUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed.startsWith("http")) return false;
  if (isObviousHomepageOnlyUrl(trimmed)) return false;

  try {
    const host = normUnwrapHost(new URL(trimmed).hostname);
    if (hostIsGoogleOrShoppingRedirect(host) || hostIsGoogleAdsOrTrackingRedirect(host)) {
      return false;
    }
    if (host === "schema.org") return false;
    if (hostIsTrackingRedirectDomain(host)) return false;
    if (isBlockedUserFacingOutboundUrl(trimmed)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Unwrap nested Google / ad redirect URLs to a merchant PDP.
 * Tries `url`, `adurl`, `q`, `u`, `target`, `redirect`, and `r` params with safe nested decoding.
 */
export function unwrapMerchantUrl(raw: string, depth = 0): string | null {
  if (depth > 6) return null;
  const t = raw.trim();
  if (!t.startsWith("http")) return null;

  try {
    const u = new URL(t);
    const host = normUnwrapHost(u.hostname);
    const originalPreview = t.slice(0, 220);

    if (hostIsGoogleOrShoppingRedirect(host) || hostIsGoogleAdsOrTrackingRedirect(host)) {
      const nested = pickNestedHttpTarget(u);
      if (nested) {
        const unwrapped = unwrapMerchantUrl(nested, depth + 1);
        if (unwrapped) {
          logMerchantUrlLine("MERCHANT_URL_UNWRAPPED", {
            from: originalPreview,
            to: unwrapped.slice(0, 220),
          });
          return unwrapped;
        }
      }
      logMerchantUrlLine("MERCHANT_URL_REJECTED", {
        url: originalPreview,
        reason: u.pathname.includes("/shopping") ? "google_shopping_surface" : "google_redirect_no_target",
      });
      return null;
    }

    if (hostIsTrackingRedirectDomain(host)) {
      const nested = pickNestedHttpTarget(u);
      if (nested) {
        const unwrapped = unwrapMerchantUrl(nested, depth + 1);
        if (unwrapped) {
          logMerchantUrlLine("MERCHANT_URL_UNWRAPPED", {
            from: originalPreview,
            to: unwrapped.slice(0, 220),
          });
          return unwrapped;
        }
      }
      logMerchantUrlLine("MERCHANT_URL_REJECTED", {
        url: originalPreview,
        reason: "tracking_redirect_no_merchant_target",
      });
      return null;
    }

    if (host === "schema.org") {
      logMerchantUrlLine("MERCHANT_URL_REJECTED", {
        url: originalPreview,
        reason: "schema_org",
      });
      return null;
    }

    if (isObviousHomepageOnlyUrl(u.toString())) {
      logMerchantUrlLine("MERCHANT_URL_REJECTED", {
        url: originalPreview,
        reason: "homepage_only",
      });
      return null;
    }

    return scrubMerchantUrlTrackingParams(scrubKnownNoiseParams(u.toString()));
  } catch {
    logMerchantUrlLine("MERCHANT_URL_REJECTED", {
      url: t.slice(0, 220),
      reason: "malformed",
    });
    return null;
  }
}

function finalizeMerchantProductUrl(rawLink: string): string | null {
  const trimmed = rawLink.trim();
  if (!trimmed.startsWith("http")) {
    logMerchantUrlLine("MERCHANT_URL_REJECTED", {
      url: trimmed.slice(0, 220) || null,
      reason: "empty_or_non_http",
    });
    return null;
  }

  const resolved = unwrapMerchantUrl(trimmed);
  if (!resolved) return null;

  if (!isAcceptableUnwrappedMerchantUrl(resolved)) {
    logMerchantUrlLine("MERCHANT_URL_REJECTED", {
      url: resolved.slice(0, 220),
      reason: "invalid_after_unwrap",
    });
    return null;
  }

  return resolved;
}

function pushHttpUrl(out: string[], value: unknown): void {
  if (typeof value === "string" && value.trim().startsWith("http")) {
    out.push(value.trim());
  }
}

function collectRawMerchantUrlCandidates(result: Record<string, unknown>): string[] {
  const urls: string[] = [];

  pushHttpUrl(urls, result.product_link);
  pushHttpUrl(urls, result.adurl);
  pushHttpUrl(urls, result.merchantUrl);
  pushHttpUrl(urls, result.merchant_url);

  if (typeof result.link === "string" && result.link.trim().startsWith("http")) {
    const link = result.link.trim();
    if (!isGoogleInternalOrShoppingRedirect(link)) urls.push(link);
  }

  const nestedExtraKeys = [
    "offerPageUrl",
    "directUrl",
    "productUrl",
    "offer_page_url",
    "direct_url",
    "merchant_link",
    "direct_link",
    "product_link_cleaned",
    "offer_url",
    "source_link",
    "tracking_link",
    "url",
  ] as const;

  for (const k of nestedExtraKeys) {
    pushHttpUrl(urls, result[k]);
  }

  const bundle = result.shoppingResults ?? result.shopping_results;
  if (Array.isArray(bundle) && bundle.length > 0) {
    const first = bundle[0];
    if (first != null && typeof first === "object") {
      urls.push(...collectRawMerchantUrlCandidates(first as Record<string, unknown>));
    }
  }

  return urls;
}

/**
 * Pick the best direct merchant PDP URL from a Google Shopping / SerpApi result row.
 */
export function extractBestMerchantProductUrl(result: Record<string, unknown>): string | null {
  const candidates = collectRawMerchantUrlCandidates(result);
  const title =
    typeof result.title === "string"
      ? result.title
      : typeof result.name === "string"
        ? result.name
        : null;

  logMerchantUrlLine("MERCHANT_URL_EXTRACT_INPUT", {
    title: title?.slice(0, 120) ?? null,
    candidateCount: String(candidates.length),
    fieldsPreview: candidates
      .slice(0, 4)
      .map((u) => u.slice(0, 120))
      .join(" | ") || null,
  });

  const seen = new Set<string>();
  for (const raw of candidates) {
    const key = raw.slice(0, 900);
    if (seen.has(key)) continue;
    seen.add(key);

    const resolved = finalizeMerchantProductUrl(raw);
    if (!resolved) continue;
    if (isGoogleShoppingOverlayUrl(resolved)) continue;

    logMerchantUrlLine("PRODUCT_URL_SELECTED", {
      url: resolved.slice(0, 220),
      source: raw === resolved ? "direct" : "unwrapped",
    });
    return resolved;
  }

  return null;
}

/** @deprecated Use {@link extractBestMerchantProductUrl}. */
export function finalizeMerchantProductUrlExport(rawLink: string): string | null {
  return finalizeMerchantProductUrl(rawLink);
}

/**
 * Universal pasted-URL canonicalization: original → redirect resolve → canonical PDP URL.
 */
import { scrubKnownNoiseParams } from "./affiliateUrl";
import { unwrapMerchantUrl } from "./googleShoppingSearch";
import { detectStoreFromProductUrl } from "./normalize";
import { hostnameIsTrackingOrShortener } from "./outboundUrlValidation";
import {
  isAcceptableUniversalShoppingOutboundUrl,
  isBlockedUserFacingOutboundUrl,
  isProductLikeRetailerUrl,
  isStrictProductDetailUrl,
} from "./productDetailUrl";
import { probeFinalUrlViaFetch } from "./urlProductQuery";

const PRODUCT_PATH_RE =
  /\/(product|products|p|pd|item|items|sku|dp|ip|site)\//i;

export type CanonicalInputUrlResult = {
  originalInputUrl: string;
  resolvedFinalUrl: string | null;
  canonicalProductUrl: string;
  hostname: string;
};

function normalizeHostname(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

function canonHref(href: string): string | null {
  try {
    return new URL(href.trim()).href;
  } catch {
    return null;
  }
}

function stripFragment(href: string): string {
  return href.split("#")[0]?.trim() ?? href.trim();
}

function isAmazonShortHost(host: string): boolean {
  const h = normalizeHostname(host);
  return h === "a.co" || h === "amzn.to";
}

function urlHasRedirectShell(u: URL): boolean {
  const href = u.href.toLowerCase();
  const path = u.pathname.toLowerCase();
  if (href.includes("/gp/slredirect") || /slredirect/i.test(href)) return true;
  if (path.includes("/redirect") || /\/rd\//i.test(path)) return true;
  const host = normalizeHostname(u.hostname);
  if (host === "google.com" || host.endsWith(".google.com")) {
    if (path === "/url" || path.includes("/shopping")) return true;
  }
  return false;
}

function unknownStoreLooksLikePdp(url: string): boolean {
  if (!isAcceptableUniversalShoppingOutboundUrl(url)) return false;
  try {
    const u = new URL(url.trim());
    if (PRODUCT_PATH_RE.test(u.pathname)) return true;
    const leaf = u.pathname.split("/").filter(Boolean).pop() ?? "";
    if (/\.html?$/i.test(leaf) && leaf.length >= 8) return true;
    return u.pathname.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

function urlLooksLikeFinalRetailerPdp(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || isBlockedUserFacingOutboundUrl(trimmed)) return false;

  const store = detectStoreFromProductUrl(trimmed);
  if (store) {
    return (
      isStrictProductDetailUrl(store, trimmed) ||
      isProductLikeRetailerUrl(store, trimmed)
    );
  }

  return unknownStoreLooksLikePdp(trimmed);
}

function shouldProbeRedirects(url: string): boolean {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return false;
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") return false;

  const host = u.hostname;
  if (isAmazonShortHost(host)) return true;
  if (hostnameIsTrackingOrShortener(host)) return true;
  if (urlHasRedirectShell(u)) return true;
  if (urlLooksLikeFinalRetailerPdp(trimmed)) return false;

  return true;
}

async function followHttpRedirects(inputHref: string): Promise<string | null> {
  const normalized = canonHref(inputHref);
  if (!normalized) return null;

  const preview = inputHref.trim().slice(0, 200);
  const host = new URL(normalized).hostname;
  const isShort =
    isAmazonShortHost(host) || hostnameIsTrackingOrShortener(host);

  if (isShort) {
    console.log("[short_url_detected]", JSON.stringify({ preview }));
  }

  let resolvedHref = await probeFinalUrlViaFetch(normalized, "HEAD");
  if (resolvedHref == null || canonHref(resolvedHref) === normalized) {
    resolvedHref = await probeFinalUrlViaFetch(normalized, "GET");
  }

  if (resolvedHref == null) {
    if (isShort) {
      console.log(
        "[short_url_failed]",
        JSON.stringify({ preview, reason: "fetch_failed" })
      );
    }
    return null;
  }

  const outHref = stripFragment(resolvedHref);
  const outCanon = canonHref(outHref);
  if (!outCanon) {
    if (isShort) {
      console.log(
        "[short_url_failed]",
        JSON.stringify({ preview, reason: "invalid_final_url" })
      );
    }
    return null;
  }

  if (outCanon === normalized) {
    if (isShort) {
      console.log(
        "[short_url_failed]",
        JSON.stringify({ preview, reason: "no_expansion" })
      );
    }
    return null;
  }

  if (isShort) {
    console.log(
      "[short_url_resolved]",
      JSON.stringify({
        from: normalized.slice(0, 200),
        to: outCanon.slice(0, 200),
      })
    );
  }

  return outCanon;
}

function applyParamUnwrap(url: string): string {
  const unwrapped = unwrapMerchantUrl(url.trim());
  return unwrapped ? stripFragment(unwrapped) : stripFragment(url);
}

function toCanonicalProductUrl(href: string): string {
  return scrubKnownNoiseParams(stripFragment(href));
}

/**
 * Resolve a pasted HTTP(S) product link to the canonical retailer URL used by compare/scrape.
 */
export async function resolveCanonicalInputUrl(
  rawHttpUrl: string
): Promise<CanonicalInputUrlResult> {
  const trimmed = rawHttpUrl.trim();
  const originalInputUrl = stripFragment(trimmed);

  const working = applyParamUnwrap(originalInputUrl);

  let resolvedFinalUrl: string | null = null;

  if (shouldProbeRedirects(working)) {
    const probed = await followHttpRedirects(working);
    if (probed) {
      resolvedFinalUrl = applyParamUnwrap(probed);
      const unwrappedAfterProbe = unwrapMerchantUrl(resolvedFinalUrl);
      if (unwrappedAfterProbe) {
        resolvedFinalUrl = stripFragment(unwrappedAfterProbe);
      }
    }
  } else {
    const unwrapped = unwrapMerchantUrl(working);
    if (unwrapped && canonHref(unwrapped) !== canonHref(working)) {
      resolvedFinalUrl = stripFragment(unwrapped);
    }
  }

  const canonicalProductUrl = toCanonicalProductUrl(
    resolvedFinalUrl ?? working
  );

  let hostname = "";
  try {
    hostname = new URL(canonicalProductUrl).hostname;
  } catch {
    hostname = "";
  }

  console.log(
    "[CANONICAL_INPUT_URL]",
    JSON.stringify({
      originalInputUrl: originalInputUrl.slice(0, 220),
      resolvedFinalUrl: resolvedFinalUrl
        ? resolvedFinalUrl.slice(0, 220)
        : null,
      canonicalProductUrl: canonicalProductUrl.slice(0, 220),
      hostname,
    })
  );

  return {
    originalInputUrl,
    resolvedFinalUrl,
    canonicalProductUrl,
    hostname,
  };
}

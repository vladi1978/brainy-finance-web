/**
 * User-facing outbound navigation validation (/redirect hop, compare outbound checks).
 * Policy: ALLOW unless dangerous (malformed URL, disallowed scheme, Google leakage,
 * known shorteners/affiliate redirect hubs), with an explicit safe-retailer allowlist.
 */

/** Public suffixes for trusted retailer outbound links (subdomains allowed). */
export const safeRetailerDomains: readonly string[] = [
  "amazon.com",
  "amazon.co.uk",
  "amazon.de",
  "amazon.fr",
  "amazon.es",
  "amazon.it",
  "amazon.nl",
  "amazon.se",
  "amazon.pl",
  "amazon.com.au",
  "amazon.com.be",
  "amazon.com.br",
  "amazon.co.jp",
  "amazon.in",
  "amazon.ca",
  "amazon.com.mx",
  "amazon.sg",
  "amazon.ae",
  "amazon.sa",
  "amazon.eg",
  "walmart.com",
  "homedepot.com",
  "bestbuy.com",
  "target.com",
  "tractorsupply.com",
  "ebay.com",
  "wayfair.com",
  "costco.com",
  "lowes.com",
  "academy.com",
  "leslies.com",
  "macys.com",
  "kohls.com",
  "temu.com",
  "samsclub.com",
  "chewy.com",
  "overstock.com",
  "nike.com",
  "adidas.com",
  "adidas.us",
] as const;

const TRACKING_OR_SHORTENER_HOSTS = new Set([
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
  "youtu.be",
  "bity.ly",
  "rb.gy",
  "short.link",
  "click.linksynergy.com",
  "linksynergy.com",
  "anrdoezrs.net",
  "dpbolvw.net",
  "kqzyfj.com",
  "awin1.com",
  "shareasale.com",
  "pjtra.com",
  "pjatr.com",
  "pntra.com",
  "pntrac.com",
  "pntrs.com",
  "amzn.to",
]);

export type OutboundUrlValidationResult = {
  url: string;
  hostname: string;
  allowed: boolean;
  reason: string;
};

function normalizeHostname(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

function logUrlValidation(result: OutboundUrlValidationResult): void {
  console.log("[URL_VALIDATION]", {
    url: result.url,
    hostname: result.hostname,
    allowed: result.allowed,
    reason: result.reason,
  });
}

function isAmazonSlredirectUrl(u: URL): boolean {
  const href = u.href.toLowerCase();
  return href.includes("/gp/slredirect") || /slredirect/i.test(href);
}

/** True when hostname is a known retailer TLD or a subdomain of one (after stripping leading `www.`). */
export function hostnameIsSafeRetailer(hostname: string): boolean {
  const h = normalizeHostname(hostname);
  for (const d of safeRetailerDomains) {
    if (h === d || h.endsWith(`.${d}`)) return true;
  }
  // Any regional Amazon retail host: *.amazon.* (excludes non-retail AWS hosts)
  if (/(^|\.)amazon\./i.test(h)) return true;
  return false;
}

function hostIsTrackingOrShortener(host: string): boolean {
  const h = normalizeHostname(host);
  if (TRACKING_OR_SHORTENER_HOSTS.has(h)) return true;
  for (const blocked of TRACKING_OR_SHORTENER_HOSTS) {
    if (h.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

/** Whether the host is a known link shortener or affiliate tracking hop (needs redirect resolve). */
export function hostnameIsTrackingOrShortener(hostname: string): boolean {
  return hostIsTrackingOrShortener(hostname);
}

function hostHasGoogleLabel(host: string): boolean {
  const h = normalizeHostname(host);
  return h.split(".").includes("google");
}

/**
 * Google-owned / ad / syndication surfaces that must never receive shopper redirects.
 */
function hostIsGoogleOwnedOrAdsSurface(host: string): boolean {
  const h = normalizeHostname(host);
  if (h === "g.co" || h.endsWith(".g.co")) return true;
  if (h === "youtu.be" || h.endsWith(".youtu.be")) return true;
  if (h.endsWith(".googleusercontent.com") || h === "googleusercontent.com") return true;
  if (h.endsWith(".gstatic.com") || h === "gstatic.com") return true;
  if (h.endsWith(".googleapis.com") || h === "googleapis.com") return true;
  if (h.endsWith(".googleadservices.com") || h === "googleadservices.com") return true;
  if (h.endsWith(".googlesyndication.com") || h === "googlesyndication.com") return true;
  if (h.endsWith(".doubleclick.net") || h.includes("doubleclick.net")) return true;
  if (hostHasGoogleLabel(h)) return true;
  return false;
}

function hostLooksLikeFacebookRedirect(host: string): boolean {
  const h = normalizeHostname(host);
  return h === "l.facebook.com" || h === "lm.facebook.com" || h === "m.me";
}

/**
 * Returns a machine-readable block reason, or `null` when the URL is allowed.
 * Does not log (safe for hot paths like Google Shopping parsing).
 */
export function getOutboundUrlBlockReason(raw: string): string | null {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return "empty";
  if (/\s/.test(trimmed)) return "contains_whitespace";

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("file:") ||
    lower.startsWith("vbscript:")
  ) {
    return "dangerous_scheme";
  }

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return "malformed";
  }

  if (!/^https?:$/i.test(u.protocol)) return "invalid_protocol";

  const hostRaw = u.hostname.trim();
  if (!hostRaw) return "missing_host";

  const host = normalizeHostname(hostRaw);

  if (!host.includes(".") && host !== "localhost") return "non_public_host";

  if (hostIsGoogleOwnedOrAdsSurface(host)) return "google_owned_or_ads_surface";
  if (hostIsTrackingOrShortener(host)) return "tracking_or_shortener";
  if (hostLooksLikeFacebookRedirect(host)) return "facebook_redirect_shell";

  if (hostnameIsSafeRetailer(hostRaw)) {
    if (isAmazonSlredirectUrl(u)) return "amazon_slredirect";
    return null;
  }

  if (isAmazonSlredirectUrl(u)) return "amazon_slredirect";

  const segs = u.pathname.split("/").filter(Boolean);
  if (segs.some((s) => s.toLowerCase() === "redirect")) return "path_redirect_segment";

  return null;
}

function evaluateOutboundUrl(raw: string): OutboundUrlValidationResult {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  const reason = getOutboundUrlBlockReason(raw);
  let hostname = "";
  try {
    hostname = normalizeHostname(new URL(trimmed).hostname);
  } catch {
    hostname = "";
  }
  if (reason === null) {
    const okReason = hostnameIsSafeRetailer(hostname)
      ? "safe_retailer_allowlist"
      : "allowed_default_https";
    return { url: trimmed, hostname, allowed: true, reason: okReason };
  }
  return { url: trimmed, hostname, allowed: false, reason };
}

/**
 * `/redirect` target validation — permissive for HTTPS retailer links, strict on Google/tracking.
 */
export function isOutboundRedirectTargetValid(url: string): boolean {
  const result = evaluateOutboundUrl(url);
  const isDev = process.env.NODE_ENV === "development";
  if (!result.allowed || isDev) {
    logUrlValidation(result);
  }
  return result.allowed;
}

import { isBlockedUserFacingOutboundUrl } from "./productDetailUrl";

/**
 * Phase 1 outbound redirect gateway — builds internal `/redirect` URLs so every
 * visible retailer click can later be wrapped with affiliate programs without
 * changing compare UI call sites again.
 */

export type BuildBrainyRedirectUrlInput = {
  targetUrl: string;
  store: string;
  title?: string | null;
  source?: string | null;
};

/** Hostnames and suffixes that must never receive a shopper redirect hop. */
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

function hostIsTrackingOrShortener(host: string): boolean {
  const h = host.replace(/^www\./i, "").toLowerCase();
  if (TRACKING_OR_SHORTENER_HOSTS.has(h)) return true;
  for (const blocked of TRACKING_OR_SHORTENER_HOSTS) {
    if (h.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

function hostHasGoogleLabel(host: string): boolean {
  const h = host.replace(/^www\./i, "").toLowerCase();
  return h.split(".").includes("google");
}

/**
 * Google-owned surfaces that {@link isBlockedUserFacingOutboundUrl} may not
 * catch (e.g. regional Google hosts like google.de).
 */
function hostIsGoogleProperty(host: string): boolean {
  const h = host.replace(/^www\./i, "").toLowerCase();
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
  const h = host.replace(/^www\./i, "").toLowerCase();
  return h === "l.facebook.com" || h === "lm.facebook.com" || h === "m.me";
}

/**
 * Universal allow-list-free validation for outbound shopper targets.
 * Rejects missing/malformed URLs, non-http(s) schemes, empty hosts, Google /
 * Google Shopping / Ads surfaces, known shorteners and affiliate redirect hubs,
 * and anything already blocked for compare surfaces.
 */
export function isOutboundRedirectTargetValid(url: string): boolean {
  const trimmed = url.replace(/\s+/g, " ").trim();
  if (!trimmed) return false;

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return false;
  }

  if (!/^https?:$/i.test(u.protocol)) return false;

  const hostRaw = u.hostname.trim();
  if (!hostRaw) return false;

  const host = hostRaw.replace(/^www\./i, "").toLowerCase();

  // Reject bare scheme hosts and obvious junk; allow localhost for dev.
  if (!host.includes(".") && host !== "localhost") return false;

  if (isBlockedUserFacingOutboundUrl(trimmed)) return false;
  if (hostIsGoogleProperty(host)) return false;
  if (hostIsTrackingOrShortener(host)) return false;
  if (hostLooksLikeFacebookRedirect(host)) return false;
  return true;
}

/**
 * Internal hop URL consumed by `/redirect`. Always use this for visible
 * retailer buttons instead of raw `https://…` targets.
 */
export function buildBrainyRedirectUrl(input: BuildBrainyRedirectUrlInput): string {
  const targetUrl = input.targetUrl.replace(/\s+/g, " ").trim();
  const store = input.store.replace(/\s+/g, " ").trim();
  const q = new URLSearchParams();
  q.set("target", targetUrl);
  q.set("store", store);
  const title = input.title?.replace(/\s+/g, " ").trim();
  if (title) q.set("title", title);
  const source = input.source?.replace(/\s+/g, " ").trim();
  if (source) q.set("source", source);
  return `/redirect?${q.toString()}`;
}
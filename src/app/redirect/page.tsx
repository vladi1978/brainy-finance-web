"use client";

import { Suspense, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";

/*
 * TODO — Phase 2 affiliate program wrapping on validated targets (examples):
 * - Amazon Associates
 * - Walmart Affiliates
 * - Target / Impact
 * - Best Buy / CJ
 * - Any future retailer or network integration
 *
 * Phase 1 only logs and performs a plain retailer redirect.
 */

/** Hosts that must never receive shopper redirects (shorteners / affiliate hubs). */
const TRACKING_OR_REDIRECT_HOSTS = new Set([
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

function normalizeHostname(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

function hostIsTrackingOrRedirectHub(host: string): boolean {
  const h = normalizeHostname(host);
  if (TRACKING_OR_REDIRECT_HOSTS.has(h)) return true;
  for (const blocked of TRACKING_OR_REDIRECT_HOSTS) {
    if (h.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

function hostHasGoogleLabel(host: string): boolean {
  const h = normalizeHostname(host);
  return h.split(".").includes("google");
}

/** Google-owned / ad / syndication surfaces that must never receive shopper redirects. */
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

function decodeTargetParam(raw: string | null): string {
  if (raw == null) return "";
  let s = raw.replace(/\+/g, " ");
  for (let i = 0; i < 5; i++) {
    try {
      const next = decodeURIComponent(s);
      if (next === s) break;
      s = next;
    } catch {
      break;
    }
  }
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Parse absolute http(s) URL for redirect validation.
 * Accepts protocol-relative `//host/...` and bare `www.host/...` style strings.
 */
function parseRedirectTarget(trimmed: string): { url: URL } | { error: string } {
  if (!trimmed) return { error: "empty" };
  if (/\s/.test(trimmed)) return { error: "contains_whitespace" };

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("file:") ||
    lower.startsWith("vbscript:")
  ) {
    return { error: "dangerous_scheme" };
  }

  let candidate = trimmed;
  if (candidate.startsWith("//")) {
    candidate = `https:${candidate}`;
  }

  try {
    const u = new URL(candidate);
    return { url: u };
  } catch {
    // continue
  }

  if (!trimmed.includes("://")) {
    try {
      return { url: new URL(`https://${trimmed}`) };
    } catch {
      return { error: "malformed" };
    }
  }

  return { error: "malformed" };
}

type RedirectEval = { ok: true; href: string } | { ok: false; reason: string };

function evaluateRedirectTarget(decodedTarget: string): RedirectEval {
  const parsed = parseRedirectTarget(decodedTarget);
  if ("error" in parsed) return { ok: false, reason: parsed.error };

  const u = parsed.url;
  if (!/^https?:$/i.test(u.protocol)) return { ok: false, reason: "invalid_protocol" };

  const hostRaw = u.hostname.trim();
  if (!hostRaw) return { ok: false, reason: "missing_host" };

  const hostNorm = normalizeHostname(hostRaw);
  if (!hostNorm.includes(".") && hostNorm !== "localhost") {
    return { ok: false, reason: "non_public_host" };
  }

  if (hostIsGoogleOwnedOrAdsSurface(hostNorm)) {
    return { ok: false, reason: "google_or_ads_surface" };
  }
  if (hostIsTrackingOrRedirectHub(hostNorm)) {
    return { ok: false, reason: "tracking_or_redirect_hub" };
  }
  if (hostLooksLikeFacebookRedirect(hostNorm)) {
    return { ok: false, reason: "facebook_redirect_shell" };
  }

  return { ok: true, href: u.href };
}

function RedirectClient() {
  const searchParams = useSearchParams();
  const rawTarget = searchParams.get("target");
  const decodedTarget = useMemo(() => decodeTargetParam(rawTarget), [rawTarget]);
  const store = searchParams.get("store")?.trim() ?? "";
  const title = searchParams.get("title")?.trim() ?? "";
  const source = searchParams.get("source")?.trim() ?? "";

  const evalResult = useMemo(() => evaluateRedirectTarget(decodedTarget), [decodedTarget]);
  const invalid = !evalResult.ok;
  const rejectReason = evalResult.ok ? null : evalResult.reason;

  useEffect(() => {
    console.log("REDIRECT_TARGET_RAW", rawTarget);
    console.log("REDIRECT_TARGET_DECODED", decodedTarget);
    console.log("REDIRECT_REJECT_REASON", rejectReason);
  }, [rawTarget, decodedTarget, rejectReason]);

  useEffect(() => {
    if (!evalResult.ok) return;
    console.log("[OUTBOUND_CLICK]", { store, target: evalResult.href, title, source });
    window.location.replace(evalResult.href);
  }, [evalResult, store, title, source]);

  if (invalid) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-white px-6">
        <p className="text-center text-lg text-white/90 max-w-md">
          This product link could not be verified.
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-black text-white px-6">
      <p className="text-center text-sm text-white/55">Opening the retailer…</p>
    </main>
  );
}

export default function RedirectPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center bg-black text-white px-6">
          <p className="text-white/55 text-sm">Loading…</p>
        </main>
      }
    >
      <RedirectClient />
    </Suspense>
  );
}

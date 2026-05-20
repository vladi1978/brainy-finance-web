"use client";

import { Suspense, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { unwrapMerchantUrl } from "@/lib/product/googleShoppingSearch";
import { isOutboundRedirectTargetValid } from "@/lib/product/outboundUrlValidation";

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

type RedirectValidation =
  | { valid: true; href: string }
  | { valid: false; reason: string };

/**
 * Decode percent-escapes only when they remain after `useSearchParams` decoding.
 */
function safeDecodeTarget(raw: string | null): string {
  if (raw == null) return "";
  let s = raw.trim();
  if (!s) return "";

  if (/%[0-9A-Fa-f]{2}/.test(s)) {
    try {
      const decoded = decodeURIComponent(s);
      if (decoded !== s) s = decoded;
    } catch {
      /* keep raw */
    }
  }

  return s.trim();
}

function parseRedirectTarget(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("file:") ||
    lower.startsWith("vbscript:")
  ) {
    return null;
  }

  let candidate = trimmed;
  if (candidate.startsWith("//")) {
    candidate = `https:${candidate}`;
  }

  try {
    return new URL(candidate);
  } catch {
    if (!trimmed.includes("://")) {
      try {
        return new URL(`https://${trimmed}`);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function resolveRedirectHref(decodedTarget: string): string | null {
  const trimmed = decodedTarget.trim();
  if (!trimmed) return null;

  const unwrapped = unwrapMerchantUrl(trimmed);
  const candidate = (unwrapped ?? trimmed).trim();
  if (!candidate.startsWith("http")) return null;

  const parsed = parseRedirectTarget(candidate);
  if (!parsed) return null;

  return parsed.href;
}

function validateRedirectTarget(decodedTarget: string): RedirectValidation {
  const href = resolveRedirectHref(decodedTarget);
  if (!href) {
    return { valid: false, reason: decodedTarget.trim() ? "malformed" : "empty" };
  }

  if (!isOutboundRedirectTargetValid(href)) {
    return { valid: false, reason: "blocked_outbound" };
  }

  return { valid: true, href };
}

function RedirectClient() {
  const searchParams = useSearchParams();
  const rawTarget = searchParams.get("target");
  const decodedTarget = useMemo(() => safeDecodeTarget(rawTarget), [rawTarget]);
  const store = searchParams.get("store")?.trim() ?? "";
  const title = searchParams.get("title")?.trim() ?? "";
  const source = searchParams.get("source")?.trim() ?? "";
  const urlType = searchParams.get("urlType")?.trim() ?? "";

  const validation = useMemo(
    () => validateRedirectTarget(decodedTarget),
    [decodedTarget]
  );

  useEffect(() => {
    console.log("[redirect] raw target", rawTarget);
    console.log("[redirect] decoded target", decodedTarget);
    console.log("[redirect] validation result", validation);
  }, [rawTarget, decodedTarget, validation]);

  useEffect(() => {
    if (!validation.valid) return;
    console.log("[OUTBOUND_CLICK]", {
      store,
      target: validation.href,
      title,
      source,
      urlType: urlType || undefined,
    });
    window.location.replace(validation.href);
  }, [validation, store, title, source, urlType]);

  if (!validation.valid) {
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

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

function safeDecodeTarget(raw: string | null): string {
  return (raw ?? "").trim();
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
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith("//")) return null;

  const parsedInput = parseRedirectTarget(trimmed);
  if (!parsedInput) return null;

  const host = parsedInput.hostname.replace(/^www\./i, "").toLowerCase();
  const shouldUnwrap =
    host === "google.com" ||
    host.endsWith(".google.com") ||
    host === "shopping.google.com" ||
    host.endsWith(".shopping.google.com") ||
    host === "googleadservices.com" ||
    host.endsWith(".googleadservices.com") ||
    host === "googlesyndication.com" ||
    host.endsWith(".googlesyndication.com") ||
    host.includes("doubleclick.net");

  const candidate = shouldUnwrap
    ? (unwrapMerchantUrl(parsedInput.href) ?? parsedInput.href)
    : parsedInput.href;

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
  const params = searchParams ?? new URLSearchParams();
  const rawTarget = params.get("target");
  const decodedTarget = useMemo(() => safeDecodeTarget(rawTarget), [rawTarget]);
  const store = params.get("store")?.trim() ?? "";
  const title = params.get("title")?.trim() ?? "";
  const source = params.get("source")?.trim() ?? "";
  const urlType = params.get("urlType")?.trim() ?? "";

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

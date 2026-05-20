"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { isOutboundRedirectTargetValid } from "@/lib/product/outboundRedirect";

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

function decodeTargetParam(raw: string | null): string {
  if (raw == null) return "";
  try {
    return decodeURIComponent(raw.replace(/\+/g, " ")).trim();
  } catch {
    return "";
  }
}

function RedirectClient() {
  const searchParams = useSearchParams();
  const target = decodeTargetParam(searchParams.get("target"));
  const store = searchParams.get("store")?.trim() ?? "";
  const title = searchParams.get("title")?.trim() ?? "";
  const source = searchParams.get("source")?.trim() ?? "";

  const invalid = !isOutboundRedirectTargetValid(target);

  useEffect(() => {
    if (invalid) return;
    console.log("[OUTBOUND_CLICK]", { store, target, title, source });
    window.location.replace(target);
  }, [invalid, store, target, title, source]);

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

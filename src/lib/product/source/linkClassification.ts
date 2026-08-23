/** Classify raw shopping API links before treating them as merchant PDP hints. */

export type ShoppingRawLinkType =
  | "merchant_pdp"
  | "google_shopping_overlay"
  | "google_redirect"
  | "tracking_redirect"
  | "unknown";

function normHost(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

/** True when the URL is still a Google Shopping surface / overlay (not a retailer PDP). */
export function isGoogleShoppingOverlayUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    const host = normHost(u.hostname);
    if (host === "google.com" || host.endsWith(".google.com")) {
      const path = u.pathname.toLowerCase();
      if (path.includes("/shopping")) return true;
      if (path.includes("/aclk")) return true;
      if (path.includes("/url")) return true;
    }
    if (host === "shopping.google.com" || host.endsWith(".shopping.google.com")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function classifyShoppingRawLink(
  rawLink: string | null | undefined,
  unwrappedMerchantUrl: string | null | undefined,
): ShoppingRawLinkType {
  const raw = rawLink?.trim();
  if (!raw) return "unknown";
  if (unwrappedMerchantUrl?.trim()) return "merchant_pdp";
  if (isGoogleShoppingOverlayUrl(raw)) return "google_shopping_overlay";
  try {
    const host = normHost(new URL(raw).hostname);
    if (host === "google.com" || host.endsWith(".google.com")) return "google_redirect";
    if (
      host.includes("googleadservices") ||
      host.includes("googlesyndication") ||
      host.includes("doubleclick")
    ) {
      return "google_redirect";
    }
  } catch {
    return "unknown";
  }
  return "unknown";
}

/**
 * Product URL resolution helpers — outbound resolution lives in `./source/`.
 */
import type { ProductOutboundUrlKind } from "./source/types";
import type { CandidateProduct, UrlResolutionReason } from "./types";
import type { ResolvedCompareCandidateOutbound } from "./source/resolveOutboundUrl";

export {
  buildRetailerSearchUrlFromTitle,
  canonicalizeTractorSupplySearchUrl,
} from "./source/retailerSearchFallback";

export {
  resolveOutboundUrl,
  type ResolvedCompareCandidateOutbound,
} from "./source/resolveOutboundUrl";

export type { ResolvedOutboundUrl } from "./source/types";

export type ProductUrlConfidence = "high" | "medium" | "low";

export type ResolvedProductUrlMeta = {
  urlType: ProductOutboundUrlKind;
  urlConfidence: ProductUrlConfidence;
  urlResolutionReason: UrlResolutionReason;
  hasPdpUrl: boolean;
};

/**
 * Map a resolved outbound URL to API-facing metadata.
 * Never labels generated search as a merchant PDP.
 */
export function resolveProductUrlMeta(
  resolution: ResolvedCompareCandidateOutbound,
): ResolvedProductUrlMeta {
  const hasPdp = resolution.urlType === "product" && Boolean(resolution.resolvedProductUrl?.trim());
  if (hasPdp) {
    return {
      urlType: "product",
      urlConfidence: resolution.urlConfidence,
      urlResolutionReason:
        resolution.urlResolutionReason === "organic_pdp_discovery"
          ? "organic_pdp_discovery"
          : "merchant_product_url",
      hasPdpUrl: true,
    };
  }
  if (resolution.urlType === "search") {
    return {
      urlType: "search",
      urlConfidence: "low",
      urlResolutionReason: "generated_search_fallback_from_title",
      hasPdpUrl: false,
    };
  }
  return {
    urlType: "unknown",
    urlConfidence: "low",
    urlResolutionReason: "generated_search_fallback_from_title",
    hasPdpUrl: false,
  };
}

/** @deprecated Use {@link resolveOutboundUrl}. */
export async function resolveCompareCandidateOutbound(args: {
  store: import("./types").UniversalStoreId;
  listingProductUrl: string;
  title: string;
  sourceLabel?: string | null;
  merchantUrlUnwrapped?: boolean;
}): Promise<ResolvedCompareCandidateOutbound> {
  const { resolveOutboundUrl } = await import("./source/resolveOutboundUrl");
  return resolveOutboundUrl({
    store: args.store,
    title: args.title,
    storeLabel: args.sourceLabel,
    shoppingHintUrl: args.listingProductUrl,
  });
}

/** @deprecated Shopping rows no longer resolve outbound at ingestion. */
export function resolveShoppingRowProductUrl(args: {
  store: import("./types").UniversalStoreId;
  title: string;
  merchantUrl: string | null;
  merchantUrlUnwrapped?: boolean;
}): string | null {
  const hint = args.merchantUrl?.trim();
  return hint || null;
}

/** Whether ingestion preserved a merchant PDP hint (not a Google overlay). */
export function candidateHasMerchantPdpHint(c: CandidateProduct): boolean {
  return Boolean(c.shoppingHintUrl?.trim()) && c.rawLinkType !== "google_shopping_overlay";
}

export type { ProductOutboundUrlKind } from "./source/types";

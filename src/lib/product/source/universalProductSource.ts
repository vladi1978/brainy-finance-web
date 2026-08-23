/**
 * Universal Product Source Layer — resolves outbound URLs for compare candidates.
 *
 * Priority:
 * 1. Direct merchant PDP (shopping hint or future retailer API)
 * 2. Organic PDP discovery (Serper web search, not retailer HTML scrape)
 * 3. Generated retailer search from title
 *
 * Plug-in points for future APIs: Amazon PA, Walmart affiliate, eBay Browse, Best Buy, etc.
 */
import { isBlockedUserFacingOutboundUrl } from "../productDetailUrl";
import { getProductSourceAdapter } from "./adapters";
import { buildEnrichedTitleForOutbound } from "./enrichedTitle";
import { attemptSearchToPdpUpgrade } from "./searchToPdpUpgrade";
import type {
  OutboundResolveContext,
  ProductSourceAdapterTier,
  ResolvedOutboundUrl,
  UrlResolutionReason,
} from "./types";

function truncateForLog(value: string, max = 240): string {
  const t = value.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function logProductSourceCandidate(fields: Record<string, unknown>): void {
  console.log("[PRODUCT_SOURCE]", JSON.stringify(fields));
}

function emptyResolution(
  adapterId: string,
  detail: string,
): ResolvedOutboundUrl {
  logProductSourceCandidate({
    adapterId,
    tier: null,
    urlResolutionReason: null,
    urlType: "unknown",
    detail,
    hasPdpUrl: false,
    outboundPreview: null,
  });
  return {
    outboundUrlRaw: "",
    urlType: "unknown",
    urlConfidence: "low",
    adapterId: adapterId as ResolvedOutboundUrl["adapterId"],
    adapterTier: "search_fallback",
  };
}

function finalizeProduct(
  adapterId: string,
  tier: ProductSourceAdapterTier,
  reason: UrlResolutionReason,
  url: string,
  confidence: "high" | "medium" | "low",
  extra?: Record<string, unknown>,
): ResolvedOutboundUrl {
  logProductSourceCandidate({
    adapterId,
    tier,
    urlResolutionReason: reason,
    urlType: "product",
    urlConfidence: confidence,
    hasPdpUrl: true,
    outboundPreview: truncateForLog(url),
    ...extra,
  });
  return {
    outboundUrlRaw: url,
    resolvedProductUrl: url,
    urlType: "product",
    urlConfidence: confidence,
    urlResolutionReason: reason,
    adapterId: adapterId as ResolvedOutboundUrl["adapterId"],
    adapterTier: tier,
  };
}

function finalizeSearch(
  adapterId: string,
  url: string,
  extra?: Record<string, unknown>,
): ResolvedOutboundUrl {
  logProductSourceCandidate({
    adapterId,
    tier: "search_fallback",
    urlResolutionReason: "generated_search_fallback_from_title",
    urlType: "search",
    urlConfidence: "low",
    hasPdpUrl: false,
    outboundPreview: truncateForLog(url),
    ...extra,
  });
  return {
    outboundUrlRaw: url,
    urlType: "search",
    urlConfidence: "low",
    urlResolutionReason: "generated_search_fallback_from_title",
    adapterId: adapterId as ResolvedOutboundUrl["adapterId"],
    adapterTier: "search_fallback",
  };
}

/**
 * Resolve the shopper-facing outbound URL for one compare candidate.
 */
export async function resolveUniversalProductOutbound(
  ctx: OutboundResolveContext,
): Promise<ResolvedOutboundUrl> {
  const enrichedTitle =
    ctx.enrichedTitle?.trim() ||
    buildEnrichedTitleForOutbound({
      title: ctx.title,
      normalized: ctx.normalized,
    });

  const fullCtx: OutboundResolveContext = {
    ...ctx,
    enrichedTitle,
    brandHint:
      ctx.brandHint ??
      ctx.normalized?.brand ??
      ctx.normalized?.structured?.brand ??
      null,
  };

  const adapter = getProductSourceAdapter(fullCtx.store, {
    shoppingHintUrl: fullCtx.shoppingHintUrl,
    storeLabel: fullCtx.storeLabel,
  });

  if (!adapter) {
    return emptyResolution(fullCtx.store, "no_adapter_for_store");
  }

  const directUrl = await adapter.resolveDirectProductUrl(fullCtx);
  if (directUrl?.trim() && !isBlockedUserFacingOutboundUrl(directUrl)) {
    const confidence = adapter.isConfirmedPdp(directUrl) ? "high" : "medium";
    return finalizeProduct(
      adapter.id,
      "api",
      "merchant_product_url",
      directUrl.trim(),
      confidence,
    );
  }

  const organic = await adapter.resolveOrganicPdp(fullCtx);
  if (organic?.productUrl?.trim()) {
    const url = organic.productUrl.trim();
    if (!isBlockedUserFacingOutboundUrl(url)) {
      return finalizeProduct(
        adapter.id,
        "organic",
        "organic_pdp_discovery",
        url,
        organic.confidence,
      );
    }
  }

  const prebuiltSearchUrl = adapter.buildSearchFallback(fullCtx).trim();
  if (prebuiltSearchUrl && adapter.primaryDomain) {
    const upgraded = await attemptSearchToPdpUpgrade({
      store: fullCtx.store,
      title: fullCtx.title,
      normalized: fullCtx.normalized,
      retailerHost: adapter.primaryDomain,
      searchUrl: prebuiltSearchUrl,
    });
    if (upgraded?.productUrl?.trim() && !isBlockedUserFacingOutboundUrl(upgraded.productUrl)) {
      return finalizeProduct(
        adapter.id,
        "organic",
        "search_url_pdp_upgrade",
        upgraded.productUrl.trim(),
        upgraded.confidence,
        { matchScore: upgraded.matchScore },
      );
    }
  }

  const searchUrl = prebuiltSearchUrl;
  if (searchUrl && !isBlockedUserFacingOutboundUrl(searchUrl)) {
    return finalizeSearch(adapter.id, searchUrl);
  }

  return emptyResolution(adapter.id, "no_outbound_available");
}

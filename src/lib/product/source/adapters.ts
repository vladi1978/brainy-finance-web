import {
  isBlockedUserFacingOutboundUrl,
  isProductDetailStoreKey,
  isProductLikeRetailerUrl,
  isStrictProductDetailUrl,
  type ProductDetailStoreKey,
} from "../productDetailUrl";
import { isUniversalPdpCandidateUrl } from "../universalSearchToPdp";
import type { StoreId, UniversalStoreId } from "../types";
import { buildRetailerSearchUrlFromTitle } from "./retailerSearchFallback";
import { resolveOrganicPdpDiscovery } from "./organicDiscovery";
import { hostFromUrl, primaryDomainForStore } from "./storeDomains";
import type { OutboundResolveContext, ProductSourceAdapter } from "./types";

function hasUsableTitle(title: string): boolean {
  return title.replace(/\s+/g, " ").trim().length >= 2;
}

function confirmedPdpForKnownStore(store: ProductDetailStoreKey, url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || isBlockedUserFacingOutboundUrl(trimmed)) return false;
  return isStrictProductDetailUrl(store, trimmed) || isProductLikeRetailerUrl(store, trimmed);
}

function createKnownStoreAdapter(store: StoreId): ProductSourceAdapter {
  const primaryDomain = primaryDomainForStore(store);

  return {
    id: store,
    primaryDomain,

    async resolveDirectProductUrl(ctx: OutboundResolveContext): Promise<string | null> {
      const hint = ctx.shoppingHintUrl?.trim();
      if (!hint || isBlockedUserFacingOutboundUrl(hint)) return null;
      if (!confirmedPdpForKnownStore(store, hint)) return null;
      return hint;
    },

    async resolveOrganicPdp(ctx: OutboundResolveContext) {
      if (ctx.demoMode) return null;
      if (!process.env.SERPER_API_KEY?.trim()) return null;
      if (!hasUsableTitle(ctx.title)) return null;

      const enrichedTitle = ctx.enrichedTitle?.trim() || ctx.title.trim();
      const pick = await resolveOrganicPdpDiscovery({
        store,
        retailerHost: primaryDomain,
        candidateTitle: ctx.title,
        brandHint: ctx.brandHint,
        enrichedTitle,
      });
      if (!pick) return null;
      return {
        productUrl: pick.productUrl,
        confidence: pick.confidence,
        matchScore: pick.matchScore,
      };
    },

    buildSearchFallback(ctx: OutboundResolveContext): string {
      if (!hasUsableTitle(ctx.title)) return "";
      return buildRetailerSearchUrlFromTitle(store, ctx.title);
    },

    isConfirmedPdp(url: string): boolean {
      return confirmedPdpForKnownStore(store, url);
    },
  };
}

function createUniversalAdapter(retailerHost: string): ProductSourceAdapter {
  const host = retailerHost.replace(/^www\./i, "").toLowerCase();

  return {
    id: "other",
    primaryDomain: host,

    async resolveDirectProductUrl(ctx: OutboundResolveContext): Promise<string | null> {
      const hint = ctx.shoppingHintUrl?.trim();
      if (!hint || isBlockedUserFacingOutboundUrl(hint)) return null;
      const hintHost = hostFromUrl(hint);
      if (!hintHost || (hintHost !== host && !hintHost.endsWith(`.${host}`))) {
        return null;
      }
      if (!isUniversalPdpCandidateUrl(hint, { searchPageHost: host })) return null;
      return hint;
    },

    async resolveOrganicPdp(ctx: OutboundResolveContext) {
      if (ctx.demoMode) return null;
      if (!process.env.SERPER_API_KEY?.trim()) return null;
      if (!hasUsableTitle(ctx.title)) return null;

      const enrichedTitle = ctx.enrichedTitle?.trim() || ctx.title;
      const pick = await resolveOrganicPdpDiscovery({
        store: "other",
        retailerHost: host,
        candidateTitle: ctx.title,
        brandHint: ctx.brandHint,
        enrichedTitle,
      });
      if (!pick) return null;
      return {
        productUrl: pick.productUrl,
        confidence: pick.confidence,
        matchScore: pick.matchScore,
      };
    },

    buildSearchFallback(): string {
      return "";
    },

    isConfirmedPdp(url: string): boolean {
      if (isBlockedUserFacingOutboundUrl(url)) return false;
      return isUniversalPdpCandidateUrl(url, { searchPageHost: host });
    },
  };
}

const KNOWN_ADAPTERS = new Map<StoreId, ProductSourceAdapter>(
  (
    [
      "amazon",
      "walmart",
      "target",
      "temu",
      "bestbuy",
      "homedepot",
      "lowes",
      "costco",
      "samsclub",
      "ebay",
      "macys",
      "kohls",
      "wayfair",
      "overstock",
      "chewy",
      "academy",
      "tractorsupply",
      "nike",
      "adidas",
    ] as StoreId[]
  ).map((s) => [s, createKnownStoreAdapter(s)]),
);

function hostFromStoreLabel(label: string | null | undefined): string | null {
  if (!label?.trim()) return null;
  const t = label.trim();
  if (/^https?:\/\//i.test(t)) return hostFromUrl(t);
  const m = t.match(/(?:^|\s)([a-z0-9][-a-z0-9]*\.[a-z]{2,})(?:\s|$)/i);
  return m?.[1]?.toLowerCase() ?? null;
}

export function getProductSourceAdapter(
  store: UniversalStoreId,
  opts?: { shoppingHintUrl?: string | null; storeLabel?: string | null },
): ProductSourceAdapter | null {
  if (store !== "other" && isProductDetailStoreKey(store)) {
    return KNOWN_ADAPTERS.get(store) ?? null;
  }

  const hintHost = opts?.shoppingHintUrl ? hostFromUrl(opts.shoppingHintUrl) : null;
  if (hintHost) return createUniversalAdapter(hintHost);

  const labelHost = hostFromStoreLabel(opts?.storeLabel);
  if (labelHost) return createUniversalAdapter(labelHost);

  return null;
}

export { createKnownStoreAdapter, createUniversalAdapter };

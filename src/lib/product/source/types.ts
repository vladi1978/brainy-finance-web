import type { NormalizedProduct, StoreId, UniversalStoreId } from "../types";

/** Canonical outbound resolution reasons — one per adapter tier outcome. */
export type UrlResolutionReason =
  | "merchant_product_url"
  | "organic_pdp_discovery"
  | "search_url_pdp_upgrade"
  | "generated_search_fallback_from_title";

export type ProductOutboundUrlKind = "product" | "search" | "unknown";

export type ProductSourceAdapterTier = "api" | "organic" | "search_fallback";

export type ResolvedOutboundUrl = {
  /** Raw HTTPS URL opened for the shopper (before affiliate wrapping). */
  outboundUrlRaw: string;
  /** Present when outbound is a retailer PDP. */
  resolvedProductUrl?: string;
  urlType: ProductOutboundUrlKind;
  urlConfidence: "high" | "medium" | "low";
  urlResolutionReason?: UrlResolutionReason;
  adapterId: UniversalStoreId;
  adapterTier: ProductSourceAdapterTier;
};

export type OutboundResolveContext = {
  store: UniversalStoreId;
  title: string;
  storeLabel?: string | null;
  /** Untrusted Google Shopping merchant link — never opened without adapter PDP confirmation. */
  shoppingHintUrl?: string | null;
  brandHint?: string | null;
  enrichedTitle?: string;
  normalized?: NormalizedProduct;
  /** Skip Serper organic discovery (demo mode). */
  demoMode?: boolean;
};

export type ProductSourceAdapter = {
  id: UniversalStoreId;
  primaryDomain: string;

  /** Tier 1 — official/affiliate API or validated direct merchant PDP hint. */
  resolveDirectProductUrl(ctx: OutboundResolveContext): Promise<string | null>;

  /** Tier 2 — `site:{primaryDomain} "{title}"` organic PDP discovery. */
  resolveOrganicPdp(
    ctx: OutboundResolveContext
  ): Promise<{ productUrl: string; confidence: "medium" | "high"; matchScore: number } | null>;

  /** Tier 3 — retailer search URL from listing title. */
  buildSearchFallback(ctx: OutboundResolveContext): string;

  isConfirmedPdp(url: string): boolean;
};

export type KnownStoreId = StoreId;

export {
  buildRetailerSearchUrlFromTitle,
  buildRetailerSearchFallback,
  canonicalizeTractorSupplySearchUrl,
} from "./retailerSearchFallback";
export { buildEnrichedTitleForOutbound, enrichedTitleFromCandidate } from "./enrichedTitle";
export {
  buildOrganicPdpSerpQuery,
  resolveOrganicPdpDiscovery,
} from "./organicDiscovery";
export { getProductSourceAdapter } from "./adapters";
export {
  classifyShoppingRawLink,
  isGoogleShoppingOverlayUrl,
  type ShoppingRawLinkType,
} from "./linkClassification";
export { fetchSerperShoppingJson, type ShoppingApiJsonOk } from "./serperSource";
export { fetchSerpApiShoppingJson } from "./serpapiSource";
export {
  hostFromUrl,
  primaryDomainForStore,
  STORE_PRIMARY_DOMAINS,
  storeIdFromHost,
} from "./storeDomains";
export {
  logProductSourceCandidate,
  resolveUniversalProductOutbound,
  resolveUniversalProductOutbound as resolveOutboundUrl,
} from "./universalProductSource";
export { isServerRetailScrapeBlocked } from "./serverScrapePolicy";
export type {
  OutboundResolveContext,
  ProductSourceAdapter,
  ProductSourceAdapterTier,
  ResolvedOutboundUrl,
  UrlResolutionReason,
} from "./types";

/** @deprecated Use {@link ResolvedOutboundUrl}. */
export type { ResolvedOutboundUrl as ResolvedCompareCandidateOutbound } from "./types";

/**
 * @deprecated PDP resolution lives in `./source/organicDiscovery` via `resolveOutboundUrl`.
 * Heavy imports removed — compile-safe stubs until PDP is re-enabled.
 */
import type { CompareApiCandidate, StoreId, UniversalStoreId } from "./types";

export type PdpResolveFromSearchResult = {
  productUrl: string;
  confidence: "medium" | "high";
  matchedTitle: string;
  similarity: number;
};

export type UniversalSearchPdpPick = {
  productUrl: string;
  anchorText: string;
  matchScore: number;
  confidence: "medium" | "high";
};

/** @deprecated Disabled — use `./source/organicDiscovery`. */
export function buildSecondPassPdpSerpQuery(_args: {
  retailerHost: string;
  candidateTitle: string;
}): string {
  return "";
}

/** @deprecated Disabled — use `./source/enrichedTitle`. */
export function buildEnrichedTitleForPdpSearch(ctx: { title: string }): string {
  return ctx.title.replace(/\s+/g, " ").trim();
}

/** @deprecated Disabled — use `./source/organicDiscovery`. */
export async function resolvePdpViaSerperSiteSearch(_args: {
  store: UniversalStoreId;
  searchUrl: string;
  candidateTitle: string;
  brandHint?: string | null;
  enrichedTitle?: string;
}): Promise<UniversalSearchPdpPick | null> {
  return null;
}

/** @deprecated Disabled — use `./source/resolveOutboundUrl`. */
export async function resolveDisplayedSearchPdps(
  apis: CompareApiCandidate[],
  _demoMode?: boolean,
): Promise<CompareApiCandidate[]> {
  return apis;
}

/** @deprecated Disabled — use `./source/organicDiscovery`. */
export async function resolvePdpFromUniversalSearchSerp(
  _args: Parameters<typeof resolvePdpViaSerperSiteSearch>[0],
): Promise<UniversalSearchPdpPick | null> {
  return null;
}

/** @deprecated Disabled — use `./source/organicDiscovery`. */
export async function resolvePdpFromStoreSearchSerp(_args: {
  store: StoreId;
  searchUrl: string;
  candidateTitle: string;
}): Promise<PdpResolveFromSearchResult | null> {
  return null;
}

/** @deprecated Disabled — use `./source/organicDiscovery`. */
export async function resolveOrganicPdpDiscovery(_args: {
  store: UniversalStoreId;
  retailerHost: string;
  candidateTitle: string;
  brandHint?: string | null;
  enrichedTitle?: string;
}): Promise<UniversalSearchPdpPick | null> {
  return null;
}

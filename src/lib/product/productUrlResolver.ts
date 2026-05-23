/**
 * @deprecated Outbound URLs are resolved by `./source/resolveOutboundUrl`.
 * Re-exports kept for backward compatibility.
 */
import type { ResolvedCompareCandidateOutbound } from "./source/resolveOutboundUrl";

export {
  buildRetailerSearchUrlFromTitle,
  canonicalizeTractorSupplySearchUrl,
} from "./source/buildSearchUrl";

export {
  resolveOutboundUrl,
  type ResolvedCompareCandidateOutbound,
} from "./source/resolveOutboundUrl";

export type { ResolvedOutboundUrl } from "./source/types";

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

export type ProductOutboundUrlKind = import("./source/types").ProductOutboundUrlKind;
export type ProductUrlConfidence = "high" | "medium" | "low";

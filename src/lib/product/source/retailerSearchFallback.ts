/**
 * Tier-3 retailer search URLs when no PDP is available.
 * Future direct APIs (Amazon PA, Walmart affiliate, eBay Browse, etc.) plug in above this layer.
 */
import type { StoreId, UniversalStoreId } from "../types";
import {
  buildRetailerSearchUrlFromTitle,
  canonicalizeTractorSupplySearchUrl,
} from "./buildSearchUrl";

export { buildRetailerSearchUrlFromTitle, canonicalizeTractorSupplySearchUrl };

export function buildRetailerSearchFallback(
  store: UniversalStoreId,
  title: string,
): string {
  if (store === "other") return "";
  return buildRetailerSearchUrlFromTitle(store as StoreId, title);
}

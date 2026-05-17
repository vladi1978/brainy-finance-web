import type { StoreId } from "@/lib/product/types";

const STORE_DOMAIN: Record<StoreId, string> = {
  amazon: "amazon.com",
  walmart: "walmart.com",
  target: "target.com",
  temu: "temu.com",
  bestbuy: "bestbuy.com",
  homedepot: "homedepot.com",
  lowes: "lowes.com",
};

const LABEL: Record<StoreId, string> = {
  amazon: "Amazon",
  walmart: "Walmart",
  target: "Target",
  temu: "Temu",
  bestbuy: "Best Buy",
  homedepot: "Home Depot",
  lowes: "Lowe's",
};

export function storeBrandDomain(store: string): string | null {
  if (store in STORE_DOMAIN) return STORE_DOMAIN[store as StoreId];
  return null;
}

export function storeDisplayLabel(store: string): string {
  if (store in LABEL) return LABEL[store as StoreId];
  return store.replace(/_/g, " ");
}

/** Brand icon via Clearbit Logo API — swap for first-party assets if needed. */
export function storeLogoUrl(store: string): string | null {
  const domain = storeBrandDomain(store);
  if (!domain) return null;
  return `https://logo.clearbit.com/${domain}`;
}

import type { StoreId } from "../types";

/** Primary retailer domain for `site:` organic PDP discovery queries. */
export const STORE_PRIMARY_DOMAINS: Record<StoreId, string> = {
  amazon: "amazon.com",
  walmart: "walmart.com",
  target: "target.com",
  temu: "temu.com",
  bestbuy: "bestbuy.com",
  homedepot: "homedepot.com",
  lowes: "lowes.com",
  costco: "costco.com",
  samsclub: "samsclub.com",
  ebay: "ebay.com",
  macys: "macys.com",
  kohls: "kohls.com",
  wayfair: "wayfair.com",
  overstock: "overstock.com",
  chewy: "chewy.com",
  academy: "academy.com",
  tractorsupply: "tractorsupply.com",
  nike: "nike.com",
  adidas: "adidas.com",
};

export function primaryDomainForStore(store: StoreId): string {
  return STORE_PRIMARY_DOMAINS[store];
}

function normHost(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

/** Extract hostname from URL for universal / unknown retailers. */
export function hostFromUrl(url: string): string | null {
  try {
    return normHost(new URL(url.trim()).hostname);
  } catch {
    return null;
  }
}

/** Map a retailer hostname to a known store id when possible. */
export function storeIdFromHost(host: string): StoreId | null {
  const h = normHost(host);
  for (const [store, domain] of Object.entries(STORE_PRIMARY_DOMAINS) as [StoreId, string][]) {
    if (h === domain || h.endsWith(`.${domain}`)) return store;
  }
  return null;
}

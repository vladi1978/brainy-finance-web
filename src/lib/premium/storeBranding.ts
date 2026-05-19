import type { StoreId } from "@/lib/product/types";

const STORE_DOMAIN: Record<StoreId, string> = {
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

const LABEL: Record<StoreId, string> = {
  amazon: "Amazon",
  walmart: "Walmart",
  target: "Target",
  temu: "Temu",
  bestbuy: "Best Buy",
  homedepot: "Home Depot",
  lowes: "Lowe's",
  costco: "Costco",
  samsclub: "Sam's Club",
  ebay: "eBay",
  macys: "Macy's",
  kohls: "Kohl's",
  wayfair: "Wayfair",
  overstock: "Overstock",
  chewy: "Chewy",
  academy: "Academy Sports",
  tractorsupply: "Tractor Supply",
  nike: "Nike",
  adidas: "Adidas",
};

export function storeBrandDomain(store: string): string | null {
  if (store in STORE_DOMAIN) return STORE_DOMAIN[store as StoreId];
  return null;
}

export function storeDisplayLabel(store: string): string {
  if (store === "other") return "Tienda externa";
  if (store in LABEL) return LABEL[store as StoreId];
  return store.replace(/_/g, " ");
}

/** Brand icon via Clearbit Logo API — swap for first-party assets if needed. */
export function storeLogoUrl(store: string): string | null {
  const domain = storeBrandDomain(store);
  if (!domain) return null;
  return `https://logo.clearbit.com/${domain}`;
}

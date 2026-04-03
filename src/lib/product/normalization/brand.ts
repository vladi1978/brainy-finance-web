import {
  GENDER_KIDS,
  GENDER_MEN,
  GENDER_WOMEN,
  LEADING_SKIP_BRAND,
} from "./constants";
import { normalizeText } from "./text";

/**
 * Canonical keys for common brand spellings / store suffixes.
 * Extend when adding retailers or house brands.
 */
const BRAND_ALIASES: Record<string, string> = {
  // Tech / CE
  samsung: "samsung",
  lg: "lg",
  sony: "sony",
  hisense: "hisense",
  tcl: "tcl",
  apple: "apple",
  beats: "beats",
  google: "google",
  amazon: "amazon",
  basics: "amazonbasics",
  amazonbasics: "amazonbasics",
  onn: "onn",
  vizio: "vizio",
  // Athletic / apparel
  nike: "nike",
  adidas: "adidas",
  reebok: "reebok",
  puma: "puma",
  underarmour: "underarmour",
  "under armour": "underarmour",
  newbalance: "newbalance",
  "new balance": "newbalance",
  // Home
  mainstays: "mainstays",
  greatvalue: "greatvalue",
  "great value": "greatvalue",
};

export function normalizeBrandKey(raw: string | null | undefined): string | null {
  if (raw == null || !String(raw).trim()) return null;
  const compact = normalizeText(String(raw)).replace(/\s+/g, "");
  if (BRAND_ALIASES[compact]) return BRAND_ALIASES[compact];
  const spaced = normalizeText(String(raw)).replace(/\s+/g, " ").trim();
  if (BRAND_ALIASES[spaced]) return BRAND_ALIASES[spaced];
  return compact.length >= 2 ? compact : null;
}

export function extractBrandGuess(
  title: string,
  explicit?: string | null
): string | null {
  if (explicit?.trim()) {
    return normalizeBrandKey(explicit);
  }
  const n = normalizeText(title);
  const tokens = n.split(/\s+/);
  for (const raw of tokens) {
    const t = raw.replace(/-/g, "");
    if (t.length < 2) continue;
    if (/^\d+$/.test(t)) continue;
    if (LEADING_SKIP_BRAND.has(t)) continue;
    if (GENDER_WOMEN.has(t) || GENDER_MEN.has(t) || GENDER_KIDS.has(t))
      continue;
    if (t === "unisex") continue;
    return normalizeBrandKey(t);
  }
  return null;
}

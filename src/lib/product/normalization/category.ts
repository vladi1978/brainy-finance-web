import { normalizeText } from "./text";

export type ProductCategory =
  | "tv"
  | "footwear"
  | "apparel"
  | "home"
  | "electronics"
  | "grocery"
  | "general";

const FOOTWEAR = /\b(shoe|shoes|sneaker|sneakers|boot|boots|sandal|sandals|loafer|loafers|cleat|cleats|trainer|trainers|slide|slides)\b/i;
const APPAREL = /\b(shirt|shirts|pants|jean|jeans|dress|dresses|jacket|jackets|hoodie|hoodies|sock|socks|underwear|bra|bras|shorts|top|tops)\b/i;
const HOME = /\b(bedding|sheet|sheets|pillow|pillows|towel|towels|curtain|curtains|mattress|furniture|vacuum|cookware|pan|pans)\b/i;
const GROCERY = /\b(organic|oz\b|fl oz|gallon|lb\b|food|snack|coffee|tea|cereal)\b/i;
const ELECTRONICS = /\b(laptop|tablet|phone|earbud|earbuds|headphone|headphones|speaker|speakers|charger|cable|usb|monitor|keyboard|mouse)\b/i;

/**
 * Coarse category for compatibility checks and query shaping.
 */
export function inferProductCategory(
  title: string,
  isTv: boolean
): ProductCategory {
  if (isTv) return "tv";
  const n = normalizeText(title);
  if (FOOTWEAR.test(n)) return "footwear";
  if (APPAREL.test(n)) return "apparel";
  if (HOME.test(n)) return "home";
  if (GROCERY.test(n)) return "grocery";
  if (ELECTRONICS.test(n)) return "electronics";
  return "general";
}

export function categoriesCompatible(
  a: ProductCategory,
  b: ProductCategory
): boolean {
  if (a === b) return true;
  if (a === "general" || b === "general") return true;
  return false;
}

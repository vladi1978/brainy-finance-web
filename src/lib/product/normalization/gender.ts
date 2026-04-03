import { GENDER_KIDS, GENDER_MEN, GENDER_WOMEN } from "./constants";
import { normalizeText } from "./text";

export type GenderBucket = "women" | "men" | "kids" | "unisex" | null;

export function extractGenderBucket(text: string): GenderBucket {
  const n = normalizeText(text);
  const tokens = n.split(/\s+/);
  for (const t of tokens) {
    if (GENDER_WOMEN.has(t)) return "women";
  }
  for (const t of tokens) {
    if (GENDER_MEN.has(t)) return "men";
  }
  for (const t of tokens) {
    if (GENDER_KIDS.has(t)) return "kids";
  }
  if (/\bunisex\b/i.test(n)) return "unisex";
  return null;
}

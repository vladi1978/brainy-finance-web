import { looksLikeAmazonAsinToken } from "./urlProductQuery";

/** Substrings typical of challenge pages — safe to match loosely. */
const BOT_WALL_SUBSTRINGS = ["just a moment", "access denied", "robot check"];

const ASIN_TOKEN_IN_TITLE_RE = /\b([A-Z0-9]{10})\b/i;

function normalizeForCheck(title: string): string {
  return title.replace(/\s+/g, " ").trim().toLowerCase();
}

function mentionsShortHttpErrorTitle(low: string): boolean {
  if (low.length > 35) return false;
  if (/^403\b/.test(low) || /^429\b/.test(low)) return true;
  if (low === "403" || low === "429") return true;
  if (/\b403\s+forbidden\b/.test(low)) return true;
  if (/\b429\s+too\s+many\b/.test(low)) return true;
  return false;
}

/** Strip ASIN / Amazon boilerplate and return remaining descriptive text. */
function descriptiveTextWithoutAsinBoilerplate(title: string): string {
  return title
    .replace(/\bASIN\b/gi, " ")
    .replace(/\bAmazon\b/gi, " ")
    .replace(ASIN_TOKEN_IN_TITLE_RE, " ")
    .replace(/[—–\-:,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the title is only an Amazon ASIN placeholder (not a real product name).
 * Accepts slug + ASIN combos when descriptive slug text remains.
 */
export function isAsinPlaceholderTitle(title: string): boolean {
  const t = title.replace(/\s+/g, " ").trim();
  if (!t) return false;

  const collapsed = t.replace(/\s+/g, "");
  if (looksLikeAmazonAsinToken(collapsed)) return true;

  const low = normalizeForCheck(t);
  if (low === "amazon product") return true;

  if (/^asin\s+[a-z0-9]{10}$/i.test(t)) return true;
  if (/^amazon\s+[a-z0-9]{10}$/i.test(t)) return true;

  if (!ASIN_TOKEN_IN_TITLE_RE.test(t)) return false;

  const remainder = descriptiveTextWithoutAsinBoilerplate(t);
  if (remainder.length === 0) return true;

  return false;
}

/** Under 20 chars: allow only if it still looks like a real product line (model, multi-token, etc.). */
function shortTitleLooksLikeProductName(title: string): boolean {
  const t = title.replace(/\s+/g, " ").trim();
  if (t.length < 4) return false;
  if (isAsinPlaceholderTitle(t)) return false;
  /** Typical SKU / model mix */
  if (/[a-z]/i.test(t) && /\d/.test(t)) return true;
  const words = t.split(/\s+/).filter((w) => w.replace(/[^a-z0-9]/gi, "").length >= 2);
  if (words.length >= 2) return true;
  if (t.includes("-") && t.length >= 12) return true;
  return false;
}

/**
 * True when a scraped PDP title is trustworthy enough to drive normalization / search.
 * False for bot walls, HTTP error pages, ASIN-only placeholders, or very short generic titles.
 */
export function isUsablePdpTitle(title: string): boolean {
  const t = title.replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (isAsinPlaceholderTitle(t)) return false;

  const low = normalizeForCheck(t);
  /** Bare storefront title only — do not use substring (real listings mention amazon.com). */
  if (low === "amazon.com" || low === "amazon com") return false;
  for (const phrase of BOT_WALL_SUBSTRINGS) {
    if (low.includes(phrase)) return false;
  }
  if (mentionsShortHttpErrorTitle(low)) return false;

  if (t.length >= 20) return true;

  return shortTitleLooksLikeProductName(t);
}

/** Block ASIN placeholder strings from retailer / shopping search queries. */
export function isBlockedAsinSearchQuery(query: string): boolean {
  const t = query.replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (isAsinPlaceholderTitle(t)) return true;
  if (looksLikeAmazonAsinToken(t.replace(/\s+/g, ""))) return true;
  return false;
}

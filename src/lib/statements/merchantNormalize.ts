/**
 * Merchant display tokens and clustering keys — strips statement noise tokens.
 */
import type { SubscriptionCategory } from "./types";
import { merchantTextSignals } from "./subscriptionSignals";

function titleCaseTokens(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/gu)
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Collapse whitespace; NFKC for consistent matching across statements */
export function normalizeMerchantText(description: string): string {
  return description
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

const NOISE_RE = /\b(PURCHASE|CHECKCARD|CHK\s*CARD|POS|DEBIT|CREDIT|AUTHORIZATION|PUR\s+AUTH|MOTO|\bCARD\b|E\s*-?\s*COMMERCE|MERC\s+H|\bATM\b|ELECTRONIC|ACH\s+DEBIT|ACH\s+PAY|ELECT\b|WWW\.?\s*WWW)\b/giu;

/** Narrow rails-only noise for clustering keys (avoid eating "APPLE PAY"). */
const RAIL_PAY_RE =
  /\b(VENMO|PAYPAL|MONEY\s+FWD|MERC\s+H|ZELLE\s+(SEND|RECV|PAY))\b/giu;

const SOFT_PAYMENT_NOISE_FOR_LABEL =
  /\b(PAYMENT\s+AUTHORIZED|AUTHORIZED|PAYPAL)\b/giu;

/** Collapse URL-style noise: slashes, trailing .COM tokens — still pattern-driven, not a fixed roster. */
function normalizeDescriptorTokens(desc: string): string {
  let s = normalizeMerchantText(desc);
  s = s.replace(/[/\\]+/gu, " ");
  s = s.replace(/\b([A-Za-z][A-Za-z0-9+&]*)\s*\.\s*(COM|NET|ORG)\b/gu, "$1");
  s = s.replace(/\s+/gu, " ").trim();
  return s;
}

/** Human-readable names from ubiquitous billing descriptors (pattern-based). */
function patternBasedMerchant(blob: string): string | null {
  const upper = blob.toUpperCase();
  if (
    /\bZELLE\b/u.test(upper) &&
    /\b(PAYMENT|PAY|P2P|SEND|RECV|RECVD|TRANSFER|TRANSF)\b/u.test(upper)
  ) {
    return "Zelle Transfer";
  }
  if (/\b(AT\s*&\s*T|A\s*T\s*T)\b/u.test(blob) || /\bATT\b/u.test(upper)) {
    return "AT&T";
  }
  if (/\bOPEN\s*AI\b|\bOPENAI\b|\bCHAT\s*GPT\b|\bCHATGPT\b/ui.test(blob)) {
    return "OpenAI ChatGPT";
  }
  if (/\bSTATE\s+FARM\b/ui.test(blob)) {
    return "State Farm";
  }
  if (/\bPEACOCK\b/ui.test(blob)) {
    return "Peacock";
  }
  if (/\bDOOR\s*DASH\b|\bDOORDASH\b/ui.test(blob)) {
    return "DoorDash";
  }
  if (/\bCIRCLE\s*K\b|\bCIRCLEK\b/ui.test(blob)) {
    return "Circle K";
  }
  if (/\bDOLLAR\s+GENERAL\b|\bDOLLAR\s*GEN\b/ui.test(blob)) {
    return "Dollar General";
  }
  if (/\bSHELL\b/.test(upper) || /\bSHELL\s+(GAS|OIL|MOTOR)/ui.test(blob)) {
    return "Shell";
  }
  if (/\bAPPLE\.COM\b|\bAPPLE\b.*\b(BILL|MUSIC|PAY)\b|\bAPP\s+STORE\b|\bITUNES\b|\bICLOUD\b/u.test(blob)) {
    return "Apple";
  }
  if (
    /\bGOOGLE\b|\bGOOGLE\s*ONE\b|\bGOOGLE\s*PLAY\b|\bYOUTUBE\b|\bGCP\b|\bANDROID\b/ui.test(blob)
  ) {
    return "Google";
  }
  if (
    /\bMICROSOFT\b|\bMSFT\b|\bXBOX\b|\bMS\s*BILL\b|\bOFF\s*(ICE)?\s*365\b|\bWINDOWS\b|\bMICRO\s*365\b/ui.test(
      blob
    )
  ) {
    return "Microsoft";
  }
  if (/\bADBE\b|\bADOBE\b|\bADOBE\b.*\bCREATIVE\b/ui.test(blob)) {
    return "Adobe";
  }
  if (/\bCANVA\b/ui.test(blob)) {
    return "Canva";
  }
  if (/\bNETFLIX\b/ui.test(blob)) {
    return "Netflix";
  }
  if (/\bSPOTIFY\b/ui.test(blob)) {
    return "Spotify";
  }
  if (/\bDISNEY\b|\bDISNEY\+\b/ui.test(blob)) {
    return "Disney";
  }
  if (/\bHULU\b/ui.test(blob)) {
    return "Hulu";
  }
  if (/\bDROPBOX\b/ui.test(blob)) {
    return "Dropbox";
  }
  if (
    /\bAWS\b|P\.?\s*AWS\b|AMAZON\s+WEB|\*\.AWS\b|AWS\.AMAZON|\bamazonaws\b|\.AWS\./iu.test(blob)
  ) {
    return "Amazon Web Services";
  }
  // Amazon split: Prime / digital subscription vs storefront
  if (
    /\bAMAZON\s+(PRIME|VIDEO|DIGITAL|MUSIC|MKTPL|DIGITAL\s*SERV|WEB\s*SERV)\b/ui.test(blob) ||
    /\bPRIME\s+VIDEO\b|\bAMAZON\s+PR\b/ui.test(blob)
  ) {
    return "Amazon Prime";
  }
  if (/AMAZON.*\bDIGITAL\b|AMZN\s*BILL|MKTPLC/ui.test(blob)) {
    return "Amazon Digital";
  }
  return null;
}

/** Category for known patterns (software/digital vs streaming etc.). */
function patternCategory(blob: string, hint: SubscriptionCategory | null): SubscriptionCategory {
  const branded = patternBasedMerchant(blob);
  if (branded === "OpenAI ChatGPT") {
    return "ai_tools";
  }
  if (hint) return hint;

  if (
    branded === "Apple" || branded === "Google" || branded === "Microsoft"
  ) {
    return "software";
  }
  if (branded === "Netflix" || branded === "Hulu" || branded === "Disney" || branded === "Amazon Prime") {
    return "streaming";
  }
  if (branded === "Spotify") return "music";
  if (
    branded === "Dropbox" ||
    branded === "Amazon Web Services"
  ) {
    return "cloud_storage";
  }
  if (
    branded === "Adobe" ||
    branded === "Canva" ||
    /** "Amazon Digital" remains software-ish storefront billing */
    branded === "Amazon Digital"
  ) {
    return "software";
  }

  const { categoryHint } = merchantTextSignals(blob, "");
  return categoryHint ?? "other";
}

/**
 * Normalize description into a clustering key — removes prefixes, PAN masks,
 * and long numeric noise so APPLE.COM variants group together.
 */
export function clusteringMerchantKey(description: string): string {
  let s = normalizeMerchantText(description).toUpperCase();

  for (let i = 0; i < 3; i++) {
    s = s.replace(NOISE_RE, " ");
    s = s.replace(RAIL_PAY_RE, " ");
  }

  // Masked PAN / asterisk tails
  s = s.replace(/\*+\s*\d{2,}\b/gu, " ");
  // Long reference / phone blobs
  s = s.replace(/\b\d{9,}\b/gu, " ");
  // 6+ consecutive digits mid-string (omit short MMDD / rare years in description)
  s = s.replace(/\b\d{6,}\b/gu, " ");
  // 4-digit blobs that look like BIN / auth ref (often alone)
  s = s.replace(/\b\d{4}\s+\d{4}\s+\d{4}\s+\d{4}\b/gu, " ");

  // Trailing USPS-style state abbreviation (drops leading numbers first)
  s = s.replace(/\s+[A-Z]{2}\s*$/gu, " ");

  // Store / terminal suffixes (e.g. KAFENELEAS D02-0, LOC #123)
  s = s.replace(/\b(?:STORE|ST|LOC|UNIT)\s*#?\s*\d+\b/giu, " ");
  s = s.replace(/\b[A-Z]?\d{1,3}[-\s]\d{1,4}\b/gu, " ");

  s = s
    .replace(/\*|#/gu, " ")
    .replace(/\bID\s+|\bSEQ\s+|REF\s+R?O?|\bTRAN\s+I?D\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 64);

  if (s.length < 4) {
    const fallback = applyInlineMerchantAliases(description)
      .replace(/\d+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 64);
    return fallback.length >= 4 ? fallback : fallback + "UNK";
  }
  return s;
}

/** Uppercase keyed fragment (legacy callers) */
export function applyInlineMerchantAliases(text: string): string {
  return normalizeMerchantText(text).toUpperCase();
}

/** Always null — kept for callers */
export function canonicalConsumerBrandFromDescription(
  _description?: string
): null {
  return null;
}

export function deriveMerchantPresentation(args: {
  primaryDescription: string;
  clusterKeyUpper: string;
}): {
  merchant: string;
  normalizedName: string;
  category: SubscriptionCategory;
} {
  const raw = normalizeDescriptorTokens(args.primaryDescription);
  const blob = `${raw} ${args.clusterKeyUpper}`;

  const { categoryHint } = merchantTextSignals(raw, args.clusterKeyUpper);

  const branded = patternBasedMerchant(blob);
  if (branded) {
    return {
      merchant: branded,
      normalizedName: branded,
      category:
        branded === "Amazon Prime"
          ? "streaming"
          : patternCategory(blob, categoryHint),
    };
  }

  let cat = categoryHint ?? patternCategory(blob, null);

  const trimmed =
    normalizeMerchantText(raw.replace(NOISE_RE, " ").replace(SOFT_PAYMENT_NOISE_FOR_LABEL, " "))
      .split(/\s+/u)
      .filter((w) => w.length && !/^\d+$/.test(w))
      .slice(0, 8)
      .join(" ");

  const readable = trimmed.length >= 3 ? titleCaseTokens(trimmed).slice(0, 72) : titleCaseTokens(args.clusterKeyUpper.slice(0, 56));

  const displayName = /^[.,\d\s]+$/.test(readable) ? titleCaseTokens(args.clusterKeyUpper.slice(0, 48)) : readable;

  if (cat === "other" && displayName) {
    const { subscriptionLike } = merchantTextSignals(raw, args.clusterKeyUpper);
    const { categoryHint: h2 } = merchantTextSignals(displayName + " " + args.clusterKeyUpper, args.clusterKeyUpper);
    if (subscriptionLike && h2) cat = h2;
  }

  return {
    merchant: displayName.slice(0, 80),
    normalizedName: displayName.slice(0, 80),
    category: cat,
  };
}

/** Friendly subscription label shown in rows */
export function friendlyMerchantSubscriptionLabel(args: {
  primaryDescription: string;
  clusterKeyUpper: string;
}): string {
  return deriveMerchantPresentation(args).normalizedName;
}

/**
 * Deterministic bill service subtype + provider grouping helpers.
 * Presentation-only grouping — never collapses distinct transactions.
 */

export type BillServiceKind =
  | "phone"
  | "internet"
  | "utility"
  | "waste"
  | "insurance"
  | "housing"
  | "unknown";

const ATT_PROVIDER =
  /\b(?:AT\s*&\s*T|A\s*T\s*&\s*T|\bATT\b|ATT\*)/iu;

export function isAttProviderText(text: string): boolean {
  return ATT_PROVIDER.test(text);
}

/**
 * Classify household bill service subtype from statement descriptor evidence.
 * Unknown when the provider is clear but subtype is not.
 */
export function classifyBillServiceKind(text: string): BillServiceKind {
  const u = text.toUpperCase();

  if (
    /\b(MORTGAGE|HOME\s+LOAN|MORT\s+PMT|MORTG\s+PMT|ESCROW|\bMTG\b|MTGPYMENT)\b/u.test(
      u
    ) ||
    (/\bUS\s*BANK\b/u.test(u) && /\b(MORT|MTG|HOME|ESCROW|LOAN)\b/u.test(u))
  ) {
    return "housing";
  }

  if (
    /\b(STATE\s+FARM|GEICO|ALLSTATE|PROGRESSIVE|USAA|FARMERS\b|LIBERTY\s+MUTUAL|INSURANCE|INS\s+PREM|PREMIUM)\b/u.test(
      u
    )
  ) {
    return "insurance";
  }

  if (
    /\b(REPUBLIC\s*SERVICES|REPUBLICSERVICES|RSIBILLPAY|WASTE\s+MGMT|WASTE\s+MANAGEMENT|RECYCLING)\b/u.test(
      u
    )
  ) {
    return "waste";
  }

  if (
    /\b(ELECTRIC|POWER|WATER|GAS\s+CO|UTILITY|UTILITIES)\b/u.test(u) &&
    !ATT_PROVIDER.test(text)
  ) {
    return "utility";
  }

  // Internet evidence (checked before generic ATT phone fallback)
  if (
    /\b(INTERNET|FIBER|BROADBAND|U-?VERSE|UVERSE|DSL|WIFI|WI-FI|XFINITY|COMCAST|SPECTRUM|COX\s+CABLE)\b/u.test(
      u
    ) ||
    /\bATT\*BILL(?:\s*PAYMENT)?\b/u.test(u)
  ) {
    return "internet";
  }

  // Phone evidence — never bare MOBILE alone (gas/POS "Mobile" descriptors).
  if (
    /\b(WIRELESS|CELLULAR|CELL\s*PHONE|PHONE\s+BILL|MOBILE\s+PHONE|MOBILE\s+(?:BILL|PAYMENT|SERVICE)|\bEPAYP\b|T[-\s]*MOBILE|VERIZON|SPRINT)\b/u.test(
      u
    )
  ) {
    return "phone";
  }

  // Plain ATT DES:PAYMENT ACH without internet markers → phone (wireless ACH)
  if (ATT_PROVIDER.test(text) && /\bDES:PAYMENT\b/u.test(u)) {
    return "phone";
  }

  if (ATT_PROVIDER.test(text)) {
    return "unknown";
  }

  if (/\b(VERIZON|T[-\s]*MOBILE|SPRINT)\b/u.test(u)) {
    return "phone";
  }

  return "unknown";
}

export function billServiceLabel(
  providerName: string,
  kind: BillServiceKind
): string {
  const provider = providerName.trim() || "Provider";
  switch (kind) {
    case "phone":
      return `${provider} — Phone`;
    case "internet":
      return `${provider} — Internet`;
    case "utility":
      return `${provider} — Utility`;
    case "waste":
      return `${provider} — Waste service`;
    case "insurance":
      return `${provider} — Insurance`;
    case "housing":
      return `${provider} — Housing`;
    case "unknown":
      return `${provider} — Service type not confirmed`;
  }
}

/** Map service kind onto legacy bill-card kind (waste folds into utility). */
export function billKindFromServiceKind(
  kind: BillServiceKind
): "phone" | "internet" | "utility" | "insurance" | "housing" | "other" {
  if (kind === "waste") return "utility";
  if (kind === "unknown") return "other";
  return kind;
}

export function billProviderKey(text: string): string {
  const u = text.toUpperCase();
  if (ATT_PROVIDER.test(text)) return "att";
  if (/\bREPUBLIC\s*SERVICES|REPUBLICSERVICES|RSIBILLPAY\b/u.test(u)) {
    return "republic_services";
  }
  if (/\bSTATE\s+FARM\b/u.test(u)) return "state_farm";
  if (/\bUS\s*BANK\b/u.test(u) && /\b(MORT|MTG|HOME|ESCROW)\b/u.test(u)) {
    return "us_bank_mortgage";
  }
  if (/\bVERIZON\b/u.test(u)) return "verizon";
  if (/\bT[-\s]*MOBILE\b/u.test(u)) return "tmobile";
  if (/\bCOMCAST|XFINITY\b/u.test(u)) return "comcast";
  if (/\bSPECTRUM\b/u.test(u)) return "spectrum";
  // Fallback: first meaningful token run
  const cleaned = u
    .replace(/\b(DES:|INDN:|CO\s+ID:|ID:|WEB|PPD|CCD|PURCHASE|CHECKCARD)\b/gu, " ")
    .replace(/[^A-Z0-9&\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const tokens = cleaned.split(" ").filter((t) => t.length >= 2).slice(0, 3);
  return tokens.join("_").toLowerCase() || "unknown_provider";
}

export function billProviderDisplayName(text: string, fallback: string): string {
  if (ATT_PROVIDER.test(text)) return "AT&T";
  if (/\bREPUBLIC/i.test(text) || /\bRSIBILLPAY/i.test(text)) {
    return "Republic Services";
  }
  if (/\bSTATE\s+FARM/i.test(text)) return "State Farm";
  if (/\bUS\s*BANK/i.test(text) && /\b(MORT|MTG|HOME)/i.test(text)) {
    return "US Bank Home Mortgage";
  }
  return fallback.trim() || "Provider";
}

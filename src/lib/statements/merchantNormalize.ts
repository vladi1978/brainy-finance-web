/**
 * Generic merchant display and clustering helpers — no brand-specific rules.
 */

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

/** Uppercase keyed fragment for stable clustering (no merchant allowlist). */
export function applyInlineMerchantAliases(text: string): string {
  return normalizeMerchantText(text).toUpperCase();
}

/** Always null — use friendlyMerchantSubscriptionLabel / cluster text instead */
export function canonicalConsumerBrandFromDescription(
  _description?: string
): null {
  return null;
}

/** Friendly label shown for a cluster-backed subscription row */
export function friendlyMerchantSubscriptionLabel(args: {
  primaryDescription: string;
  clusterKeyUpper: string;
}): string {
  const raw = normalizeMerchantText(args.primaryDescription);
  if (raw.length <= 80 && raw.length >= 2) {
    const head = raw.split(/\s+/u).slice(0, 8).join(" ");
    return titleCaseTokens(head).slice(0, 80);
  }

  const k = args.clusterKeyUpper.trim();
  const head =
    k
      .split(/\s+/u)
      .find((p) => p.length >= 3 && /[A-Za-z]/u.test(p)) ?? k.slice(0, 48);
  return titleCaseTokens(head).slice(0, 80);
}

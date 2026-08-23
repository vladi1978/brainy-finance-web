/**
 * Honest price-difference labels for Compare candidates.
 * Verified Exact Match may say "Save"; alternatives and search URLs must not.
 */
import { isIncompleteOrPartsListingTitle } from "./commercialListingClassifier";
import {
  isStrictSearchFallbackOutbound,
  type MatchConfidenceBand,
} from "./matching/confidenceBands";
import type { ProductIdentityMatchType } from "./types";

export type PriceDifferenceKind =
  | "verified_save"
  | "alternative_lower"
  | "search_listed_lower";

export type PriceDifferenceClaimInput = {
  /** Positive USD amount cheaper than reference (reference − candidate). */
  amount: number | null | undefined;
  confidenceBand?: MatchConfidenceBand | null;
  matchType?: ProductIdentityMatchType | null;
  title?: string | null;
  commercialListingLabel?: string | null;
  store?: string;
  outboundUrl?: string | null;
  affiliateUrl?: string | null;
  productUrl?: string | null;
  urlType?: "product" | "search" | "unknown" | null;
  outboundIsStoreSearch?: boolean;
};

export type PriceDifferenceClaim = {
  kind: PriceDifferenceKind;
  amount: number;
  /** Full user-facing label including the formatted money amount. */
  label: string;
};

function formatUsdAmount(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/**
 * Resolve how (or whether) to present a favorable price difference.
 * Incomplete/parts and non-positive amounts yield null (no claim).
 */
export function resolvePriceDifferenceClaim(
  input: PriceDifferenceClaimInput,
  formatAmount: (n: number) => string = formatUsdAmount
): PriceDifferenceClaim | null {
  const amount = input.amount;
  if (amount == null || !(amount > 0) || !Number.isFinite(amount)) {
    return null;
  }
  if (isIncompleteOrPartsListingTitle(input.title)) {
    return null;
  }
  if (
    input.commercialListingLabel &&
    /incomplete|parts listing|non-purchase|rental|lease|payment plan|deposit/i.test(
      input.commercialListingLabel
    )
  ) {
    return null;
  }

  const money = formatAmount(amount);

  if (
    isStrictSearchFallbackOutbound({
      store: input.store,
      outboundUrl: input.outboundUrl,
      affiliateUrl: input.affiliateUrl,
      productUrl: input.productUrl,
      urlType: input.urlType ?? undefined,
      outboundIsStoreSearch: input.outboundIsStoreSearch,
    })
  ) {
    return {
      kind: "search_listed_lower",
      amount,
      label: `Listed ${money} lower — verify product`,
    };
  }

  const verifiedExact =
    input.confidenceBand === "exact_match" &&
    (input.matchType == null || input.matchType === "exact_match");

  if (verifiedExact) {
    return {
      kind: "verified_save",
      amount,
      label: `Save ${money}`,
    };
  }

  return {
    kind: "alternative_lower",
    amount,
    label: `${money} lower — different or unconfirmed model`,
  };
}

/** True when a claim is verified Exact Match savings (may use the word Save). */
export function isVerifiedSaveClaim(
  claim: PriceDifferenceClaim | null
): boolean {
  return claim?.kind === "verified_save";
}

/**
 * Expected household bills (phone, utility, insurance) — exclusive of subscription counts.
 */
import type { SpendingInsight, SubscriptionInsight } from "./types";

const EXPECTED_BILL_SUB_CATEGORIES = new Set(["utilities", "insurance"]);

export function isUtilityLikeMerchantText(text: string): boolean {
  const blob = text.toUpperCase();
  return /\b(UTILITY|UTILITIES|ELECTRIC|POWER|WATER|GAS\s+CO|INTERNET|PHONE|MOBILE|WIRELESS|VERIZON|AT&T|ATT\b|T-MOBILE|COMCAST|SPECTRUM|INSURANCE|GEICO|STATE\s+FARM|PROGRESSIVE|ALLSTATE)\b/u.test(
    blob
  );
}

export function isExpectedBillSubscription(
  sub: Pick<SubscriptionInsight, "category" | "merchant" | "normalizedName">
): boolean {
  if (EXPECTED_BILL_SUB_CATEGORIES.has(sub.category)) return true;
  return isUtilityLikeMerchantText(
    `${sub.category} ${sub.normalizedName} ${sub.merchant}`
  );
}

export function isUtilityLikeSpending(
  row: Pick<SpendingInsight, "categoryLabel" | "normalizedName" | "merchant">
): boolean {
  return isUtilityLikeMerchantText(
    `${row.categoryLabel} ${row.normalizedName} ${row.merchant}`
  );
}

/**
 * Expected household bills (phone, utility, insurance) — exclusive of subscription counts.
 */
import type { SpendingInsight, SubscriptionInsight } from "./types";
import { isInsuranceRelatedText } from "./insuranceClassify";

const EXPECTED_BILL_SUB_CATEGORIES = new Set(["utilities", "insurance"]);

export function isUtilityLikeMerchantText(text: string): boolean {
  const blob = text.toUpperCase();
  if (isInsuranceRelatedText(blob)) return true;
  // Never treat bare MOBILE/PHONE as utility evidence — BoA POS lines often
  // include "Mobile" (e.g. Marathon Mobile) which is not a telecom bill.
  // T-Mobile / mobile phone / wireless / cellular remain valid phone evidence.
  return /\b(UTILITY|UTILITIES|ELECTRIC|POWER|WATER|GAS\s+CO|INTERNET|WIRELESS|CELLULAR|CELL\s*PHONE|PHONE\s+BILL|MOBILE\s+PHONE|MOBILE\s+(?:BILL|PAYMENT|SERVICE)|VERIZON|AT&T|ATT\b|T[-\s]*MOBILE|COMCAST|SPECTRUM|REPUBLIC\s*SERVICES|REPUBLICSERVICES|RSIBILLPAY|WASTE\s+MGMT|WASTE\s+MANAGEMENT|RECYCLING)\b/u.test(
    blob
  );
}

export function isHousingPaymentText(text: string): boolean {
  const u = text.toUpperCase();
  if (
    /\b(MORTGAGE|HOME\s+LOAN|MORT\s+PMT|MORTG\s+PMT|ESCROW|\bMTG\b)\b/u.test(u)
  ) {
    return true;
  }
  return (
    /\bUS\s*BANK\b/u.test(u) &&
    /\b(MORT|MTG|HOME|ESCROW|LOAN)\b/u.test(u)
  );
}

export function isDebtFinancingText(text: string): boolean {
  const u = text.toUpperCase();
  return /\b(SYNCHRONY|AFFIRM|COMENITY|KLARNA|AFTERPAY|CAPITAL\s+ONE|CITI\s+CARD|CHASE\s+CARD|CREDIT\s+CARD\s+PAYMENT|CARD\s+PAYMENT|LOAN\s+PAYMENT|FINANCE\s+CHARGE|INSTALLMENT)\b/u.test(
    u
  );
}

export function isExpectedBillSubscription(
  sub: Pick<SubscriptionInsight, "category" | "merchant" | "normalizedName">
): boolean {
  if (EXPECTED_BILL_SUB_CATEGORIES.has(sub.category)) return true;
  const blob = `${sub.category} ${sub.normalizedName} ${sub.merchant}`;
  // Debt/financing is never an "expected bill" or subscription target.
  if (isDebtFinancingText(blob)) return false;
  if (isHousingPaymentText(blob)) return true;
  return isUtilityLikeMerchantText(blob);
}

export function isUtilityLikeSpending(
  row: Pick<SpendingInsight, "categoryLabel" | "normalizedName" | "merchant">
): boolean {
  return isUtilityLikeMerchantText(
    `${row.categoryLabel} ${row.normalizedName} ${row.merchant}`
  );
}

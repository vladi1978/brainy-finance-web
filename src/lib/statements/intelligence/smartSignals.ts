import type { MerchantCluster, SpendingInsight } from "../types";
import { hasGenuineDuplicateCharges } from "../evidenceGuarded";

function clusterBlob(cluster: MerchantCluster): string {
  return `${cluster.descriptions.join(" ")} ${cluster.key}`.toUpperCase();
}

function isDeliveryMerchant(blob: string): boolean {
  return /\b(DOORDASH|UBER\s*EATS|GRUBHUB|POSTMATES|INSTACART)\b/u.test(blob);
}

function isRideshareMerchant(blob: string): boolean {
  return /\b(UBER|LYFT)\b/u.test(blob) && !/\bUBER\s*EATS\b/u.test(blob);
}

function isOverdraftFee(blob: string): boolean {
  return /\b(OVERDRAFT|OVERDR\.?|OD\s+F(?:EE|E)|NSF\b|NON[-\s]*SUF|INSUFFICIENT\s+FUNDS)\b/u.test(
    blob
  );
}

function isAiToolsMerchant(blob: string): boolean {
  return /\b(OPEN\s*AI|OPENAI|CHAT\s*GPT|CHATGPT|ANTHROPIC|CLAUDE|MIDJOURNEY|CURSOR\b|GITHUB\s+COPILOT)\b/u.test(
    blob
  );
}

/**
 * Dynamic, pattern-based signal copy for a spending row.
 */
export function deriveSmartSignal(
  cluster: MerchantCluster,
  row: SpendingInsight
): string {
  const debits = cluster.charges.filter((c) => c.type === "debit");
  const n = debits.length;
  const blob = clusterBlob(cluster);

  if (row.kind === "fee" || row.categoryKey === "fees") {
    if (isOverdraftFee(blob)) {
      return n >= 2
        ? "Repeated overdraft fees detected"
        : "Overdraft fee detected";
    }
    return n >= 2 ? "Bank fees detected" : "Bank fee detected";
  }

  if (row.categoryKey === "transfers" && n >= 2) {
    return "Recurring transfer pattern";
  }

  if (hasGenuineDuplicateCharges(cluster.charges)) {
    return "Possible duplicate charge";
  }

  if (isRideshareMerchant(blob) && n >= 2) {
    return "Repeated activity to review";
  }

  if (isDeliveryMerchant(blob) && n >= 2) {
    return "Repeated activity to review";
  }

  if (isAiToolsMerchant(blob)) {
    return n >= 2
      ? "AI tools recurring spend"
      : "AI tools charge — recurrence not confirmed";
  }

  if (row.categoryKey === "convenience" && n >= 3) {
    return "Repeated convenience purchases";
  }

  if (
    (row.categoryKey === "restaurants" || row.categoryKey === "cafes") &&
    n >= 3
  ) {
    if (isDeliveryMerchant(blob)) return "Repeated food delivery purchases";
    return "Repeated dining purchases";
  }

  if (row.categoryKey === "retail" && n >= 2) {
    return "Repeated retail purchases";
  }

  if (row.kind === "frequent_spending" && n >= 4) {
    return "Repeated weekly purchases";
  }

  if (
    row.kind === "possible_recurring_expense" &&
    row.recommendation === "Possible savings opportunity"
  ) {
    return "Possible savings opportunity — review if useful";
  }

  if (n >= 3 && row.recurringExpenseScore >= 0.55) {
    return "Merchant appears often in this window";
  }

  if (row.kind === "frequent_spending") {
    return n >= 2
      ? "Repeated discretionary spending"
      : "Discretionary spending to review";
  }

  if (row.kind === "possible_recurring_expense") {
    return n >= 2
      ? "Recurring pattern detected"
      : "Possible recurring expense — recurrence not confirmed";
  }

  if (row.kind === "needs_review") {
    return "Review this activity";
  }

  return row.recommendation;
}

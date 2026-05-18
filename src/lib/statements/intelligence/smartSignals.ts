import type { MerchantCluster, SpendingInsight } from "../types";
import { debitAmountsSimilar } from "../heuristics";

function clusterBlob(cluster: MerchantCluster): string {
  return `${cluster.descriptions.join(" ")} ${cluster.key}`.toUpperCase();
}

function isDeliveryMerchant(blob: string): boolean {
  return /\b(DOORDASH|UBER\s*EATS|GRUBHUB|POSTMATES|INSTACART)\b/u.test(blob);
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

function possibleDuplicateCharge(cluster: MerchantCluster): boolean {
  const debits = cluster.charges.filter((c) => c.type === "debit");
  if (debits.length < 2) return false;
  const amounts = debits.map((d) => d.amount);
  if (!debitAmountsSimilar(amounts)) return false;
  const dates = debits.map((d) => d.date).sort();
  for (let i = 1; i < dates.length; i++) {
    const t0 = Date.parse(dates[i - 1] + "T00:00:00Z");
    const t1 = Date.parse(dates[i] + "T00:00:00Z");
    if (Number.isFinite(t0) && Number.isFinite(t1)) {
      const days = Math.abs(t1 - t0) / 86400000;
      if (days <= 5) return true;
    }
  }
  return false;
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
    if (isOverdraftFee(blob)) return "Repeated overdraft fees detected";
    return "Bank fee detected";
  }

  if (row.categoryKey === "transfers" && n >= 2) {
    return "Recurring transfer pattern";
  }

  if (possibleDuplicateCharge(cluster)) {
    return "Possible duplicate charge";
  }

  if (isAiToolsMerchant(blob)) {
    return "AI tools recurring spend";
  }

  if (row.categoryKey === "convenience" && n >= 3) {
    return "Frequent convenience spending";
  }

  if (
    (row.categoryKey === "restaurants" || row.categoryKey === "cafes") &&
    n >= 3
  ) {
    if (isDeliveryMerchant(blob)) return "Frequent food delivery activity";
    return "Dining spending trend";
  }

  if (row.categoryKey === "retail" && n >= 2) {
    return "Retail spending trend";
  }

  if (row.kind === "frequent_spending" && n >= 4) {
    return "Weekly spending pattern";
  }

  if (
    row.kind === "possible_recurring_expense" &&
    row.recommendation === "Possible savings opportunity"
  ) {
    return "Possible savings opportunity";
  }

  if (n >= 3 && row.recurringExpenseScore >= 0.55) {
    return "Merchant frequency increasing";
  }

  if (row.kind === "frequent_spending") {
    return "Frequent spending";
  }

  if (row.kind === "possible_recurring_expense") {
    return "Recurring pattern detected";
  }

  if (row.kind === "needs_review") {
    return "Unusual activity — review";
  }

  return row.recommendation;
}

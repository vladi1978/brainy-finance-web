/**
 * Deterministic debit categorization and reconciliation for statement overview.
 * Every accepted debit belongs to exactly one presentation category.
 */
import { clusterMerchantPresentation } from "../merchantNormalization";
import type { MerchantNormalizationResult } from "../merchantNormalization";
import { normalizeMerchantKey } from "../clusters";
import { classifyInsurancePayment } from "../insuranceClassify";
import { isUtilityLikeMerchantText } from "../expectedBills";
import {
  hasRecurrenceEvidence,
  canPresentMonthlyCadence,
} from "../recurrenceEvidence";
import { inferSpendingInsightCategory } from "../spendingSignals";
import { isRideshareOrDeliveryMerchant } from "./presentationGroups";
import type {
  MerchantCluster,
  StatementPeriod,
  SubscriptionInsight,
  Transaction,
} from "../types";

export type StatementDebitCategoryId =
  | "bills"
  | "insurance"
  | "subscriptions"
  | "shopping"
  | "food_delivery_rideshare"
  | "fees"
  | "transfers_payments"
  | "other";

export type StatementActivityTransaction = {
  id: string;
  date: string;
  amount: number;
  currency: string;
  merchant: string;
  normalizedName: string;
  clusterId: string;
  categoryId: StatementDebitCategoryId;
};

export type StatementActivityCategory = {
  id: StatementDebitCategoryId;
  label: string;
  total: number;
  transactionCount: number;
  percentOfDebits: number;
  topMerchants: Array<{ name: string; total: number; count: number }>;
  transactions: StatementActivityTransaction[];
};

export type StatementBillCard = {
  id: string;
  merchant: string;
  normalizedName: string;
  observedAmount: number;
  chargeCount: number;
  currency: string;
  dateRange: { start: string; end: string } | null;
  cadenceLabel: string | null;
  billKind: "phone" | "internet" | "utility" | "insurance" | "other";
  insuranceSubtype: string | null;
};

export type StatementSubscriptionCard = {
  id: string;
  merchant: string;
  normalizedName: string;
  status: "confirmed" | "possible";
  chargeCount: number;
  periodTotal: number;
  latestCharge: number;
  currency: string;
  cadenceLabel: string | null;
};

export type StatementAttentionItem = {
  id: string;
  title: string;
  detail: string;
  tone: "fee" | "subscription" | "review" | "bill";
};

export type StatementActivitySummary = {
  currency: string;
  moneyIn: number;
  moneyOut: number;
  netCashFlow: number;
  transactionCount: number;
  debitCount: number;
  creditCount: number;
  categories: StatementActivityCategory[];
  billCards: StatementBillCard[];
  subscriptionCards: StatementSubscriptionCard[];
  attentionItems: StatementAttentionItem[];
  uncategorized: StatementActivityTransaction[];
  reconciliation: {
    ok: boolean;
    categorySum: number;
    acceptedDebitTotal: number;
    delta: number;
    duplicateDebitKeys: number;
  };
};

const CATEGORY_LABELS: Record<StatementDebitCategoryId, string> = {
  bills: "Bills",
  insurance: "Insurance",
  subscriptions: "Subscriptions",
  shopping: "Shopping",
  food_delivery_rideshare: "Food / delivery / rideshare",
  fees: "Fees",
  transfers_payments: "Transfers / payments",
  other: "Other",
};

function txnKey(t: Transaction): string {
  return `${t.date}|${t.description}|${t.amount}|${t.type}|${t.currency}`;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function billKindFromText(text: string): StatementBillCard["billKind"] {
  const u = text.toUpperCase();
  if (classifyInsurancePayment(u).isInsurance) return "insurance";
  if (/\b(VERIZON|AT\s*&\s*T|\bATT\b|T[-\s]*MOBILE|SPRINT|MOBILE|WIRELESS|PHONE)\b/u.test(u)) {
    return "phone";
  }
  if (/\b(COMCAST|XFINITY|SPECTRUM|INTERNET|FIBER|COX\s+CABLE)\b/u.test(u)) {
    return "internet";
  }
  if (/\b(ELECTRIC|POWER|WATER|GAS\s+CO|UTILITY|UTILITIES)\b/u.test(u)) {
    return "utility";
  }
  return "other";
}

function isFeeText(text: string): boolean {
  return /\b(OVERDRAFT|OVERDR\.?|OD\s+F(?:EE|E)|MAINT(?:ENANCE)?\s+FEE|SERVICE\s+FEE|MONTHLY\s+FEE|ACCOUNT\s+FEE|NSF\b|NON[-\s]*SUF|INSUFFICIENT\s+FUNDS|TOTAL\s+OVERDRAFT\s+FEES|TOTAL\s+SERVICE\s+FEES)\b/u.test(
    text.toUpperCase()
  );
}

function isTransferText(text: string): boolean {
  const u = text.toUpperCase();
  if (isUtilityLikeMerchantText(u) || classifyInsurancePayment(u).isInsurance) {
    return false;
  }
  return (
    /\b(ZELLE|VENMO|CASH\s*APP|PAYPAL|WIRE\s+TRANSFER|ACH\s+TRANSFER)\b/u.test(
      u
    ) ||
    (/\b(TRANSFER\b|PMNT\s+RCVD|PAYMENT\s+FROM|PAYMENT\s+TO)\b/u.test(u) &&
      !/\b(DES:PAYMENT|UTILITY|ELECTRIC|POWER|INSURANCE|PREM)\b/u.test(u))
  );
}

function isShoppingText(text: string): boolean {
  return /\b(SAMS(?:'?S|\s)CLUB|SAMSCLUB|TARGET\b|WAL\s*-?\s*MART|WALMART|COSTCO|BEST\s+BUY|HOME\s+DEPOT|LOWE'?S\b|AMAZON\b|RETAIL|PURCHASE)\b/ui.test(
    text
  );
}

function isMembershipCharge(text: string): boolean {
  return /\b(MEMBERSHIP|MEMBER\s+FEE|ANNUAL\s+FEE|CLUB\s+FEE|RENEWAL)\b/ui.test(
    text
  );
}

function classifyDebit(args: {
  txn: Transaction;
  cluster: MerchantCluster;
  normalizedName: string;
  subscriptionByCluster: Map<string, SubscriptionInsight>;
}): StatementDebitCategoryId {
  const blob = `${args.txn.description} ${args.cluster.key} ${args.normalizedName}`;
  const spendCat = inferSpendingInsightCategory(args.cluster);

  if (isFeeText(blob) || spendCat === "fees") return "fees";
  if (isTransferText(blob) || spendCat === "transfers") return "transfers_payments";

  const insurance = classifyInsurancePayment(blob);
  if (insurance.isInsurance) return "insurance";

  if (
    isUtilityLikeMerchantText(blob) &&
    !isShoppingText(blob) &&
    billKindFromText(blob) !== "insurance"
  ) {
    return "bills";
  }

  if (isShoppingText(blob) || spendCat === "retail") {
    if (!isMembershipCharge(blob)) return "shopping";
  }

  const sub = args.subscriptionByCluster.get(args.cluster.id);
  if (sub) {
    const chargeCount = args.cluster.charges.filter((c) => c.type === "debit").length;
    const confirmed =
      sub.flags.confirmed &&
      hasRecurrenceEvidence(chargeCount) &&
      canPresentMonthlyCadence({ frequency: sub.frequency, chargeCount });
    const possible =
      !confirmed &&
      chargeCount >= 1 &&
      !isShoppingText(blob) &&
      !isMembershipCharge(blob);
    if (confirmed || possible) return "subscriptions";
  }

  if (
    isRideshareOrDeliveryMerchant(blob) ||
    spendCat === "restaurants" ||
    spendCat === "cafes" ||
    spendCat === "convenience" ||
    spendCat === "groceries"
  ) {
    return "food_delivery_rideshare";
  }

  return "other";
}

export function buildStatementActivitySummary(input: {
  transactions: Transaction[];
  clusters: MerchantCluster[];
  subscriptions: SubscriptionInsight[];
  statementPeriod: StatementPeriod | null;
  merchantNormByClusterId?: Map<string, MerchantNormalizationResult>;
}): StatementActivitySummary {
  const debits = input.transactions.filter((t) => t.type === "debit");
  const credits = input.transactions.filter((t) => t.type === "credit");
  const currency =
    debits[0]?.currency ?? credits[0]?.currency ?? "USD";

  const clusterByKey = new Map(input.clusters.map((c) => [c.key, c]));

  const subscriptionByCluster = new Map(
    input.subscriptions.map((s) => [s.clusterId, s])
  );

  function clusterForDebit(txn: Transaction): MerchantCluster | undefined {
    const key = normalizeMerchantKey(txn.description);
    const cluster = clusterByKey.get(key);
    if (!cluster) return undefined;
    const matched = cluster.charges.some(
      (c) =>
        c.date === txn.date &&
        c.type === txn.type &&
        Math.abs(c.amount - txn.amount) < 0.011
    );
    return matched ? cluster : undefined;
  }

  const classified: StatementActivityTransaction[] = [];
  const seenKeys = new Set<string>();
  let duplicateDebitKeys = 0;

  for (const txn of debits) {
    const key = txnKey(txn);
    if (seenKeys.has(key)) {
      duplicateDebitKeys++;
      continue;
    }
    seenKeys.add(key);

    const cluster = clusterForDebit(txn);
    if (!cluster) continue;

    const presentation = clusterMerchantPresentation(
      cluster,
      input.merchantNormByClusterId?.get(cluster.id)
    );

    classified.push({
      id: key,
      date: txn.date,
      amount: txn.amount,
      currency: txn.currency,
      merchant: presentation.merchant,
      normalizedName: presentation.normalizedName,
      clusterId: cluster.id,
      categoryId: classifyDebit({
        txn,
        cluster,
        normalizedName: presentation.normalizedName,
        subscriptionByCluster,
      }),
    });
  }

  const moneyOut = roundMoney(classified.reduce((s, t) => s + t.amount, 0));
  const moneyIn = roundMoney(credits.reduce((s, t) => s + t.amount, 0));

  const categoryMap = new Map<StatementDebitCategoryId, StatementActivityTransaction[]>();
  for (const id of Object.keys(CATEGORY_LABELS) as StatementDebitCategoryId[]) {
    categoryMap.set(id, []);
  }
  for (const row of classified) {
    categoryMap.get(row.categoryId)!.push(row);
  }

  const categories: StatementActivityCategory[] = (
    Object.keys(CATEGORY_LABELS) as StatementDebitCategoryId[]
  ).map((id) => {
    const rows = categoryMap.get(id)!;
    const total = roundMoney(rows.reduce((s, r) => s + r.amount, 0));
    const merchantTotals = new Map<string, { total: number; count: number }>();
    for (const row of rows) {
      const name = row.normalizedName || row.merchant;
      const prev = merchantTotals.get(name) ?? { total: 0, count: 0 };
      merchantTotals.set(name, {
        total: prev.total + row.amount,
        count: prev.count + 1,
      });
    }
    const topMerchants = [...merchantTotals.entries()]
      .map(([name, v]) => ({ name, ...v, total: roundMoney(v.total) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    return {
      id,
      label: CATEGORY_LABELS[id],
      total,
      transactionCount: rows.length,
      percentOfDebits: moneyOut > 0 ? roundMoney((total / moneyOut) * 100) : 0,
      topMerchants,
      transactions: rows.sort((a, b) => a.date.localeCompare(b.date)),
    };
  });

  const billCards: StatementBillCard[] = [];
  const billClusterIds = new Set<string>();
  for (const row of [...categoryMap.get("bills")!, ...categoryMap.get("insurance")!]) {
    if (billClusterIds.has(row.clusterId)) continue;
    billClusterIds.add(row.clusterId);
    const cluster = input.clusters.find((c) => c.id === row.clusterId);
    if (!cluster) continue;
    const clusterDebits = cluster.charges.filter((c) => c.type === "debit");
    const dates = clusterDebits.map((c) => c.date).sort();
    const chargeCount = clusterDebits.length;
    const insurance = classifyInsurancePayment(
      `${row.normalizedName} ${row.merchant} ${cluster.key}`
    );
    const kind = billKindFromText(`${row.normalizedName} ${cluster.key}`);
    const sub = subscriptionByCluster.get(row.clusterId);
    billCards.push({
      id: `bill:${row.clusterId}`,
      merchant: row.merchant,
      normalizedName: row.normalizedName,
      observedAmount: roundMoney(
        clusterDebits.reduce((s, c) => s + c.amount, 0)
      ),
      chargeCount,
      currency: row.currency,
      dateRange:
        dates.length > 0
          ? { start: dates[0]!, end: dates[dates.length - 1]! }
          : null,
      cadenceLabel:
        sub &&
        hasRecurrenceEvidence(chargeCount) &&
        canPresentMonthlyCadence({ frequency: sub.frequency, chargeCount })
          ? sub.frequency === "monthly"
            ? "Monthly"
            : sub.frequency === "annual"
              ? "Annual"
              : sub.frequency === "weekly"
                ? "Weekly"
                : null
          : null,
      billKind: kind,
      insuranceSubtype: insurance.isInsurance
        ? insurance.type === "unknown"
          ? "Insurance — type not confirmed"
          : insurance.type
        : null,
    });
  }

  const subscriptionCards: StatementSubscriptionCard[] = input.subscriptions
    .filter((sub) => {
      const blob = `${sub.normalizedName} ${sub.merchant} ${sub.category}`;
      if (isShoppingText(blob) && !isMembershipCharge(blob)) return false;
      if (classifyInsurancePayment(blob).isInsurance) return false;
      return true;
    })
    .map((sub) => {
      const cluster = input.clusters.find((c) => c.id === sub.clusterId);
      const chargeCount =
        cluster?.charges.filter((c) => c.type === "debit").length ?? 1;
      const confirmed =
        sub.flags.confirmed &&
        hasRecurrenceEvidence(chargeCount) &&
        canPresentMonthlyCadence({ frequency: sub.frequency, chargeCount });
      return {
        id: `sub:${sub.clusterId}`,
        merchant: sub.merchant,
        normalizedName: sub.normalizedName,
        status: confirmed ? "confirmed" : "possible",
        chargeCount,
        periodTotal: sub.totalSpentInPeriod,
        latestCharge: sub.amount,
        currency: sub.currency,
        cadenceLabel: confirmed
          ? sub.frequency === "monthly"
            ? "Monthly"
            : sub.frequency === "annual"
              ? "Annual"
              : sub.frequency === "weekly"
                ? "Weekly"
                : null
          : null,
      };
    });

  const attentionItems: StatementAttentionItem[] = [];
  for (const cat of categories.filter((c) => c.id === "fees" && c.total > 0)) {
    attentionItems.push({
      id: "fees",
      title: "Observed bank fees",
      detail: `${cat.transactionCount} fee line${cat.transactionCount === 1 ? "" : "s"} totaling ${cat.total.toFixed(2)} ${currency} on this statement.`,
      tone: "fee",
    });
  }
  for (const sub of subscriptionCards.filter((s) => s.status === "possible")) {
    attentionItems.push({
      id: `possible-sub:${sub.id}`,
      title: `Possible subscription: ${sub.normalizedName}`,
      detail: `${sub.chargeCount} charge${sub.chargeCount === 1 ? "" : "s"} detected · recurrence not confirmed.`,
      tone: "subscription",
    });
  }
  for (const row of categoryMap.get("other")!.slice(0, 2)) {
    attentionItems.push({
      id: `other:${row.id}`,
      title: `Review: ${row.normalizedName}`,
      detail: `Observed ${row.amount.toFixed(2)} ${row.currency} — categorized as other activity.`,
      tone: "review",
    });
  }

  const categorySum = roundMoney(
    categories.reduce((s, c) => s + c.total, 0)
  );
  const uncategorized = categoryMap.get("other")!;

  return {
    currency,
    moneyIn,
    moneyOut,
    netCashFlow: roundMoney(moneyIn - moneyOut),
    transactionCount: input.transactions.length,
    debitCount: debits.length,
    creditCount: credits.length,
    categories,
    billCards,
    subscriptionCards,
    attentionItems: attentionItems.slice(0, 5),
    uncategorized,
    reconciliation: {
      ok: Math.abs(categorySum - moneyOut) < 0.01,
      categorySum,
      acceptedDebitTotal: moneyOut,
      delta: roundMoney(categorySum - moneyOut),
      duplicateDebitKeys,
    },
  };
}

export function reconcileStatementActivity(
  summary: StatementActivitySummary
): StatementActivitySummary["reconciliation"] {
  return summary.reconciliation;
}

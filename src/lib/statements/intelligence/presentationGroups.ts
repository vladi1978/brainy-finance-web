/**
 * Presentation-only grouping of existing statement analysis rows.
 * Does not change detection — only how results are labeled and summarized.
 */
import type {
  MerchantCluster,
  SpendingInsight,
  SubscriptionFrequency,
  SubscriptionInsight,
} from "../types";
import type { EnrichedSpendingRow } from "./types";

export type ActivityPresentationGroupId =
  | "expected_recurring_bills"
  | "subscriptions"
  | "repeated_discretionary"
  | "unusual_recurring";

export type ActivityPresentationStatus =
  | "confirmed"
  | "possible"
  | "expected"
  | "unusual";

export type ActivityPresentationCard = {
  id: string;
  clusterId: string;
  groupId: ActivityPresentationGroupId;
  status: ActivityPresentationStatus;
  merchant: string;
  normalizedName: string;
  categoryLabel: string;
  currency: string;
  chargeCount: number;
  periodTotal: number;
  averageCharge: number;
  latestCharge: number;
  dateRange: { start: string; end: string } | null;
  estimatedCadence: string | null;
  confidence: number | null;
  reason: string;
  /** Neutral activity line — never invents a monthly bill from the latest charge. */
  summaryLine: string;
  showMonthlyEstimate: boolean;
  monthlyEstimate: number | null;
  source: "subscription" | "spending";
  subscription?: SubscriptionInsight;
  spending?: EnrichedSpendingRow | SpendingInsight;
};

export type ActivityPresentationGroups = {
  expectedRecurringBills: ActivityPresentationCard[];
  subscriptions: ActivityPresentationCard[];
  repeatedDiscretionary: ActivityPresentationCard[];
  unusualRecurring: ActivityPresentationCard[];
};

const CADENCE_LABEL: Record<SubscriptionFrequency, string | null> = {
  monthly: "Monthly",
  weekly: "Weekly",
  annual: "Annual",
  unknown: null,
};

const EXPECTED_BILL_SUB_CATEGORIES = new Set([
  "utilities",
  "insurance",
]);

const SUBSCRIPTION_SERVICE_CATEGORIES = new Set([
  "streaming",
  "music",
  "fitness",
  "software",
  "cloud_storage",
  "ai_tools",
  "shopping",
  "other",
]);

const DISCRETIONARY_CATEGORY_KEYS = new Set([
  "restaurants",
  "cafes",
  "convenience",
  "groceries",
  "liquor",
  "retail",
  "gas",
]);

function formatMoneyPlain(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.length === 3 ? currency : "USD",
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

/** Monthly/weekly claims need enough dated charges — never invent from one latest debit. */
export function supportsMonthlyCadencePresentation(
  frequency: SubscriptionFrequency | string,
  chargeCount: number
): boolean {
  if (frequency === "monthly") return chargeCount >= 2;
  if (frequency === "weekly") return chargeCount >= 3;
  if (frequency === "annual") return chargeCount >= 1;
  return false;
}

/**
 * Uncertain / sparse patterns use this exact style:
 * `2 charges detected · $21.29 total · latest charge $9.31`
 */
export function formatUncertainActivitySummary(args: {
  chargeCount: number;
  periodTotal: number;
  latestCharge: number;
  currency: string;
  formatMoney?: (n: number, currency: string) => string;
}): string {
  const fmt = args.formatMoney ?? formatMoneyPlain;
  const n = Math.max(0, Math.round(args.chargeCount));
  const chargeWord = n === 1 ? "charge" : "charges";
  return `${n} ${chargeWord} detected · ${fmt(args.periodTotal, args.currency)} total · latest charge ${fmt(args.latestCharge, args.currency)}`;
}

export function isExpectedBillSubscription(
  sub: Pick<SubscriptionInsight, "category">
): boolean {
  return EXPECTED_BILL_SUB_CATEGORIES.has(sub.category);
}

export function isRideshareOrDeliveryMerchant(text: string): boolean {
  const u = text.toUpperCase();
  return /\b(UBER|LYFT|DOORDASH|GRUBHUB|POSTMATES|UBER\s*EATS|INSTACART)\b/u.test(
    u
  );
}

export function isUtilityLikeSpending(row: Pick<SpendingInsight, "categoryLabel" | "normalizedName" | "merchant">): boolean {
  const blob = `${row.categoryLabel} ${row.normalizedName} ${row.merchant}`.toUpperCase();
  return /\b(UTILITY|UTILITIES|ELECTRIC|POWER|WATER|GAS\s+CO|INTERNET|PHONE|MOBILE|WIRELESS|VERIZON|AT&T|T-MOBILE|COMCAST|SPECTRUM|INSURANCE)\b/u.test(
    blob
  );
}

function debitMeta(cluster: MerchantCluster | undefined): {
  chargeCount: number;
  dateRange: { start: string; end: string } | null;
  averageCharge: number;
} {
  const debits = (cluster?.charges ?? []).filter((c) => c.type === "debit");
  const dates = debits.map((d) => d.date).filter(Boolean).sort();
  const amounts = debits.map((d) => d.amount);
  const chargeCount = debits.length;
  const averageCharge =
    chargeCount > 0
      ? amounts.reduce((s, a) => s + a, 0) / chargeCount
      : 0;
  return {
    chargeCount,
    averageCharge,
    dateRange:
      dates.length > 0
        ? { start: dates[0]!, end: dates[dates.length - 1]! }
        : null,
  };
}

function cadenceLabel(
  frequency: SubscriptionFrequency | string,
  chargeCount: number
): string | null {
  if (!supportsMonthlyCadencePresentation(frequency, chargeCount)) return null;
  return CADENCE_LABEL[frequency as SubscriptionFrequency] ?? null;
}

function unusualReason(
  spending: EnrichedSpendingRow | SpendingInsight | undefined,
  sub: SubscriptionInsight | undefined
): string {
  if (sub?.flags.suspicious) {
    return "Review this activity — the charge pattern looks unusual.";
  }
  if (sub?.flags.duplicate) {
    return "Review this activity — similar charges appear close together.";
  }
  if (spending?.kind === "needs_review") {
    return "Review this activity — the pattern is unclear from this statement alone.";
  }
  if (spending && "smartSignal" in spending && spending.smartSignal) {
    const signal = spending.smartSignal;
    if (/unusual|duplicate|review/i.test(signal)) {
      return signal.replace(/Confirmed subscription/gi, "Review this activity");
    }
  }
  return "Review this activity — repeated charges deserve a closer look.";
}

function expectedBillReason(
  sub: SubscriptionInsight | undefined,
  spending: EnrichedSpendingRow | SpendingInsight | undefined,
  chargeCount: number
): string {
  if (sub?.flags.priceIncreased) {
    return "Expected bill — amount changed vs earlier charges in this window.";
  }
  if (chargeCount >= 3 && sub?.frequency === "monthly") {
    return "Expected recurring bill — appears regularly in this statement window.";
  }
  if (spending) {
    return "Expected recurring bill — utility or necessary service pattern.";
  }
  return "Expected recurring bill — phone, internet, utility, or insurance-style charge.";
}

function subscriptionReason(sub: SubscriptionInsight): string {
  if (sub.flags.confirmed) {
    return "Confirmed subscription — recurring service with a strong billing pattern.";
  }
  if (sub.flags.reviewSuggested) {
    return "Possible subscription — pattern is suggestive but not fully confirmed.";
  }
  return "Possible subscription — recurring service candidate from this statement.";
}

function discretionaryReason(
  spending: EnrichedSpendingRow | SpendingInsight,
  chargeCount: number
): string {
  const blob = `${spending.normalizedName} ${spending.merchant}`;
  if (isRideshareOrDeliveryMerchant(blob)) {
    return `${chargeCount} rideshare or delivery charges in this window — shown for awareness, not judgment.`;
  }
  if (
    spending.categoryKey === "restaurants" ||
    spending.categoryKey === "cafes"
  ) {
    return "Repeated food purchases in this statement window.";
  }
  if (spending.categoryKey === "convenience") {
    return "Repeated convenience purchases in this statement window.";
  }
  return "Repeated discretionary spending at this merchant.";
}

function buildSummaryLine(args: {
  chargeCount: number;
  periodTotal: number;
  latestCharge: number;
  currency: string;
  frequency: SubscriptionFrequency | string;
}): string {
  // Prefer the uncertain plain-language line whenever monthly cadence is unsupported.
  if (!supportsMonthlyCadencePresentation(args.frequency, args.chargeCount)) {
    return formatUncertainActivitySummary(args);
  }
  return formatUncertainActivitySummary(args);
}

function cardFromSubscription(
  sub: SubscriptionInsight,
  cluster: MerchantCluster | undefined,
  groupId: ActivityPresentationGroupId,
  status: ActivityPresentationStatus,
  reason: string
): ActivityPresentationCard {
  const meta = debitMeta(cluster);
  const chargeCount = Math.max(meta.chargeCount, 1);
  const averageCharge =
    meta.chargeCount > 0 ? meta.averageCharge : sub.amount;
  const showMonthly = supportsMonthlyCadencePresentation(
    sub.frequency,
    chargeCount
  );
  return {
    id: `sub:${sub.clusterId}`,
    clusterId: sub.clusterId,
    groupId,
    status,
    merchant: sub.merchant,
    normalizedName: sub.normalizedName,
    categoryLabel: sub.category,
    currency: sub.currency,
    chargeCount,
    periodTotal: sub.totalSpentInPeriod,
    averageCharge,
    latestCharge: sub.amount,
    dateRange: meta.dateRange,
    estimatedCadence: cadenceLabel(sub.frequency, chargeCount),
    confidence: sub.confidence,
    reason,
    summaryLine: buildSummaryLine({
      chargeCount,
      periodTotal: sub.totalSpentInPeriod,
      latestCharge: sub.amount,
      currency: sub.currency,
      frequency: sub.frequency,
    }),
    showMonthlyEstimate: showMonthly && sub.monthlyEquivalent > 0,
    monthlyEstimate: showMonthly ? sub.monthlyEquivalent : null,
    source: "subscription",
    subscription: sub,
  };
}

function cardFromSpending(
  row: EnrichedSpendingRow | SpendingInsight,
  cluster: MerchantCluster | undefined,
  groupId: ActivityPresentationGroupId,
  status: ActivityPresentationStatus,
  reason: string
): ActivityPresentationCard {
  const meta = debitMeta(cluster);
  const chargeCount = Math.max(meta.chargeCount, 1);
  const averageCharge =
    meta.chargeCount > 0
      ? meta.averageCharge
      : row.totalSpentInPeriod / chargeCount;
  const confidence =
    "rowConfidence" in row ? row.rowConfidence : row.recurringExpenseScore;
  return {
    id: `spend:${row.clusterId}`,
    clusterId: row.clusterId,
    groupId,
    status,
    merchant: row.merchant,
    normalizedName: row.normalizedName,
    categoryLabel: row.categoryLabel,
    currency: row.currency,
    chargeCount,
    periodTotal: row.totalSpentInPeriod,
    averageCharge,
    latestCharge: row.amount,
    dateRange: meta.dateRange,
    estimatedCadence: cadenceLabel(row.frequency, chargeCount),
    confidence,
    reason,
    summaryLine: buildSummaryLine({
      chargeCount,
      periodTotal: row.totalSpentInPeriod,
      latestCharge: row.amount,
      currency: row.currency,
      frequency: row.frequency,
    }),
    showMonthlyEstimate: false,
    monthlyEstimate: null,
    source: "spending",
    spending: row,
  };
}

function isUnusualSubscription(sub: SubscriptionInsight): boolean {
  return (
    sub.flags.suspicious ||
    (sub.flags.duplicate && !sub.flags.confirmed) ||
    (sub.flags.reviewSuggested && sub.confidence < 0.8 && !sub.flags.confirmed)
  );
}

function isUnusualSpending(row: EnrichedSpendingRow | SpendingInsight): boolean {
  if (row.kind === "needs_review" || row.kind === "fee") return true;
  if ("smartSignal" in row && /unusual|duplicate/i.test(row.smartSignal ?? "")) {
    return true;
  }
  return false;
}

function isDiscretionarySpending(
  row: EnrichedSpendingRow | SpendingInsight
): boolean {
  if (isRideshareOrDeliveryMerchant(`${row.normalizedName} ${row.merchant}`)) {
    return true;
  }
  if (DISCRETIONARY_CATEGORY_KEYS.has(row.categoryKey)) return true;
  return (
    row.kind === "frequent_spending" ||
    row.recommendation === "Frequent spending"
  );
}

/**
 * Partition existing analysis into consumer-facing presentation groups.
 * Each cluster appears in at most one group.
 */
export function buildActivityPresentationGroups(input: {
  subscriptions: SubscriptionInsight[];
  visibleRecurring: Array<EnrichedSpendingRow | SpendingInsight>;
  visibleInsights: Array<EnrichedSpendingRow | SpendingInsight>;
  clusters: MerchantCluster[];
}): ActivityPresentationGroups {
  const clusterById = new Map(input.clusters.map((c) => [c.id, c]));
  const used = new Set<string>();

  const expectedRecurringBills: ActivityPresentationCard[] = [];
  const subscriptions: ActivityPresentationCard[] = [];
  const repeatedDiscretionary: ActivityPresentationCard[] = [];
  const unusualRecurring: ActivityPresentationCard[] = [];

  for (const sub of input.subscriptions) {
    if (used.has(sub.clusterId)) continue;
    used.add(sub.clusterId);
    const cluster = clusterById.get(sub.clusterId);

    if (isUnusualSubscription(sub) && !isExpectedBillSubscription(sub)) {
      unusualRecurring.push(
        cardFromSubscription(
          sub,
          cluster,
          "unusual_recurring",
          "unusual",
          unusualReason(undefined, sub)
        )
      );
      continue;
    }

    if (isExpectedBillSubscription(sub)) {
      expectedRecurringBills.push(
        cardFromSubscription(
          sub,
          cluster,
          "expected_recurring_bills",
          "expected",
          expectedBillReason(sub, undefined, Math.max(debitMeta(cluster).chargeCount, 1))
        )
      );
      continue;
    }

    if (SUBSCRIPTION_SERVICE_CATEGORIES.has(sub.category)) {
      const status: ActivityPresentationStatus = sub.flags.confirmed
        ? "confirmed"
        : "possible";
      subscriptions.push(
        cardFromSubscription(
          sub,
          cluster,
          "subscriptions",
          status,
          subscriptionReason(sub)
        )
      );
    } else {
      expectedRecurringBills.push(
        cardFromSubscription(
          sub,
          cluster,
          "expected_recurring_bills",
          "expected",
          expectedBillReason(sub, undefined, Math.max(debitMeta(cluster).chargeCount, 1))
        )
      );
    }
  }

  const spendRows = [...input.visibleRecurring, ...input.visibleInsights];
  for (const row of spendRows) {
    if (used.has(row.clusterId)) continue;
    used.add(row.clusterId);
    const cluster = clusterById.get(row.clusterId);

    if (isUnusualSpending(row)) {
      unusualRecurring.push(
        cardFromSpending(
          row,
          cluster,
          "unusual_recurring",
          "unusual",
          unusualReason(row, undefined)
        )
      );
      continue;
    }

    if (isUtilityLikeSpending(row)) {
      expectedRecurringBills.push(
        cardFromSpending(
          row,
          cluster,
          "expected_recurring_bills",
          "expected",
          expectedBillReason(undefined, row, Math.max(debitMeta(cluster).chargeCount, 1))
        )
      );
      continue;
    }

    if (isDiscretionarySpending(row)) {
      repeatedDiscretionary.push(
        cardFromSpending(
          row,
          cluster,
          "repeated_discretionary",
          "possible",
          discretionaryReason(row, Math.max(debitMeta(cluster).chargeCount, 1))
        )
      );
      continue;
    }

    // Leftover recurring patterns — treat as unusual review, not confirmed subscriptions.
    unusualRecurring.push(
      cardFromSpending(
        row,
        cluster,
        "unusual_recurring",
        "unusual",
        unusualReason(row, undefined)
      )
    );
  }

  const byTotal = (a: ActivityPresentationCard, b: ActivityPresentationCard) =>
    b.periodTotal - a.periodTotal;

  return {
    expectedRecurringBills: expectedRecurringBills.sort(byTotal),
    subscriptions: subscriptions.sort(byTotal),
    repeatedDiscretionary: repeatedDiscretionary.sort(byTotal),
    unusualRecurring: unusualRecurring.sort(byTotal),
  };
}

export const PRESENTATION_GROUP_COPY: Record<
  ActivityPresentationGroupId,
  { title: string; description: string }
> = {
  expected_recurring_bills: {
    title: "Expected recurring bills",
    description:
      "Utilities, phone, internet, insurance, and similar necessities. These are expected household costs — not waste or cancellation targets. Material changes are noted when the statement supports them.",
  },
  subscriptions: {
    title: "Subscriptions",
    description:
      "Streaming, software, memberships, and similar recurring services. Confirmed means a strong billing pattern; possible means the pattern is suggestive but not fully verified.",
  },
  repeated_discretionary: {
    title: "Repeated discretionary spending",
    description:
      "Rideshare, food delivery, dining, convenience purchases, and similar activity. Shown so you can see patterns — not to tell you how to spend.",
  },
  unusual_recurring: {
    title: "Unusual recurring activity",
    description:
      "Repeated merchants or charges that deserve a closer look. These are not labeled as confirmed subscriptions.",
  },
};

/**
 * Presentation-only grouping of existing statement analysis rows.
 * Does not change detection — only how results are labeled and summarized.
 */
import {
  canPresentMonthlyCadence,
  hasRecurrenceEvidence,
  resolveChargeCount,
} from "../recurrenceEvidence";
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
  | "unusual_recurring"
  | "one_time_review";

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
  oneTimeReview: ActivityPresentationCard[];
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

/** Monthly/weekly/annual cadence claims need enough dated charges. */
export function supportsMonthlyCadencePresentation(
  frequency: SubscriptionFrequency | string,
  chargeCount: number
): boolean {
  return canPresentMonthlyCadence({ frequency, chargeCount });
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
  sub: Pick<SubscriptionInsight, "category" | "merchant" | "normalizedName">
): boolean {
  if (EXPECTED_BILL_SUB_CATEGORIES.has(sub.category)) return true;
  return isUtilityLikeSpending({
    categoryLabel: sub.category,
    normalizedName: sub.normalizedName,
    merchant: sub.merchant,
  });
}

export function isRideshareOrDeliveryMerchant(text: string): boolean {
  const u = text.toUpperCase();
  return /\b(UBER|LYFT|DOORDASH|GRUBHUB|POSTMATES|UBER\s*EATS|INSTACART)\b/u.test(
    u
  );
}

export function isUtilityLikeSpending(row: Pick<SpendingInsight, "categoryLabel" | "normalizedName" | "merchant">): boolean {
  const blob = `${row.categoryLabel} ${row.normalizedName} ${row.merchant}`.toUpperCase();
  return /\b(UTILITY|UTILITIES|ELECTRIC|POWER|WATER|GAS\s+CO|INTERNET|PHONE|MOBILE|WIRELESS|VERIZON|AT&T|T-MOBILE|COMCAST|SPECTRUM|INSURANCE|GEICO|STATE\s+FARM|PROGRESSIVE|ALLSTATE)\b/u.test(
    blob
  );
}

function isTransferLikeSpending(
  row: Pick<SpendingInsight, "categoryKey" | "kind" | "normalizedName" | "merchant">
): boolean {
  if (row.categoryKey === "transfers" || row.kind === "income_transfer") {
    return true;
  }
  const blob = `${row.normalizedName} ${row.merchant}`.toUpperCase();
  return /\b(ZELLE|VENMO|CASH\s*APP|CASHAPP|WIRE\s+TRANSFER|ACH\s+TRANSFER|PAYMENT\s+TO|PAYMENT\s+FROM)\b/u.test(
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

function chargeCountFor(
  cluster: MerchantCluster | undefined,
  periodTotal: number,
  latestCharge: number
): number {
  return resolveChargeCount({ cluster, periodTotal, latestCharge });
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
  sub: SubscriptionInsight | undefined,
  chargeCount: number
): string {
  if (!hasRecurrenceEvidence(chargeCount)) {
    return "Review this activity — a single charge was flagged for attention.";
  }
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
  if (!hasRecurrenceEvidence(chargeCount)) {
    return "Expected bill category · recurrence not yet confirmed";
  }
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

function subscriptionReason(
  sub: SubscriptionInsight,
  chargeCount: number
): string {
  const canConfirm =
    hasRecurrenceEvidence(chargeCount) &&
    supportsMonthlyCadencePresentation(sub.frequency, chargeCount) &&
    sub.flags.confirmed;
  if (canConfirm) {
    return "Confirmed subscription — recurring service with a strong billing pattern.";
  }
  if (!hasRecurrenceEvidence(chargeCount)) {
    return "Possible subscription · recurrence not confirmed";
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

function oneTimeReviewReason(
  spending: EnrichedSpendingRow | SpendingInsight | undefined,
  sub: SubscriptionInsight | undefined
): string {
  if (spending?.kind === "fee" || spending?.categoryKey === "fees") {
    return "One-time fee activity to review — not treated as a recurring pattern.";
  }
  if (sub?.flags.suspicious || spending?.kind === "needs_review") {
    return "One-time activity to review — not enough charges to call this recurring.";
  }
  return "One-time activity to review — shown once without recurring claims.";
}

function buildSummaryLine(args: {
  chargeCount: number;
  periodTotal: number;
  latestCharge: number;
  currency: string;
  frequency: SubscriptionFrequency | string;
}): string {
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
  const chargeCount = chargeCountFor(
    cluster,
    sub.totalSpentInPeriod,
    sub.amount
  );
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
  const chargeCount = chargeCountFor(
    cluster,
    row.totalSpentInPeriod,
    row.amount
  );
  const averageCharge =
    meta.chargeCount > 0
      ? meta.averageCharge
      : row.totalSpentInPeriod / Math.max(chargeCount, 1);
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

function hasReviewWorthyRisk(
  spending: EnrichedSpendingRow | SpendingInsight | undefined,
  sub: SubscriptionInsight | undefined
): boolean {
  if (sub?.flags.suspicious || sub?.flags.duplicate) return true;
  if (!spending) return false;
  if (spending.kind === "fee" || spending.kind === "needs_review") return true;
  if (spending.categoryKey === "fees") return true;
  if ("smartSignal" in spending && /unusual|duplicate|fee|overdraft/i.test(spending.smartSignal ?? "")) {
    return true;
  }
  return false;
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
  const oneTimeReview: ActivityPresentationCard[] = [];

  for (const sub of input.subscriptions) {
    if (used.has(sub.clusterId)) continue;
    used.add(sub.clusterId);
    const cluster = clusterById.get(sub.clusterId);
    const chargeCount = chargeCountFor(
      cluster,
      sub.totalSpentInPeriod,
      sub.amount
    );
    const recurring = hasRecurrenceEvidence(chargeCount);

    if (isExpectedBillSubscription(sub)) {
      expectedRecurringBills.push(
        cardFromSubscription(
          sub,
          cluster,
          "expected_recurring_bills",
          "expected",
          expectedBillReason(sub, undefined, chargeCount)
        )
      );
      continue;
    }

    if (isUnusualSubscription(sub) && !isExpectedBillSubscription(sub)) {
      if (!recurring) {
        if (hasReviewWorthyRisk(undefined, sub)) {
          oneTimeReview.push(
            cardFromSubscription(
              sub,
              cluster,
              "one_time_review",
              "unusual",
              oneTimeReviewReason(undefined, sub)
            )
          );
        }
        // No risk + single charge: omit rather than claim recurring unusual.
        continue;
      }
      unusualRecurring.push(
        cardFromSubscription(
          sub,
          cluster,
          "unusual_recurring",
          "unusual",
          unusualReason(undefined, sub, chargeCount)
        )
      );
      continue;
    }

    if (SUBSCRIPTION_SERVICE_CATEGORIES.has(sub.category)) {
      const canConfirm =
        recurring &&
        supportsMonthlyCadencePresentation(sub.frequency, chargeCount) &&
        sub.flags.confirmed;
      const status: ActivityPresentationStatus = canConfirm
        ? "confirmed"
        : "possible";
      subscriptions.push(
        cardFromSubscription(
          sub,
          cluster,
          "subscriptions",
          status,
          subscriptionReason(sub, chargeCount)
        )
      );
    } else {
      expectedRecurringBills.push(
        cardFromSubscription(
          sub,
          cluster,
          "expected_recurring_bills",
          "expected",
          expectedBillReason(sub, undefined, chargeCount)
        )
      );
    }
  }

  const spendRows = [...input.visibleRecurring, ...input.visibleInsights];
  for (const row of spendRows) {
    if (used.has(row.clusterId)) continue;
    used.add(row.clusterId);
    const cluster = clusterById.get(row.clusterId);
    const chargeCount = chargeCountFor(
      cluster,
      row.totalSpentInPeriod,
      row.amount
    );
    const recurring = hasRecurrenceEvidence(chargeCount);

    if (isTransferLikeSpending(row)) {
      // Transfers stay out of recurring presentation groups.
      continue;
    }

    if (isUtilityLikeSpending(row)) {
      expectedRecurringBills.push(
        cardFromSpending(
          row,
          cluster,
          "expected_recurring_bills",
          "expected",
          expectedBillReason(undefined, row, chargeCount)
        )
      );
      continue;
    }

    if (!recurring) {
      if (hasReviewWorthyRisk(row, undefined)) {
        oneTimeReview.push(
          cardFromSpending(
            row,
            cluster,
            "one_time_review",
            "unusual",
            oneTimeReviewReason(row, undefined)
          )
        );
      }
      // Ordinary one-charge spend: omit — never call it recurring.
      continue;
    }

    if (isUnusualSpending(row)) {
      unusualRecurring.push(
        cardFromSpending(
          row,
          cluster,
          "unusual_recurring",
          "unusual",
          unusualReason(row, undefined, chargeCount)
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
          discretionaryReason(row, chargeCount)
        )
      );
      continue;
    }

    // Leftover multi-charge patterns — unusual review, not confirmed subscriptions.
    unusualRecurring.push(
      cardFromSpending(
        row,
        cluster,
        "unusual_recurring",
        "unusual",
        unusualReason(row, undefined, chargeCount)
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
    oneTimeReview: oneTimeReview.sort(byTotal),
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
      "Streaming, software, memberships, and similar recurring services. Confirmed means dated recurrence evidence; possible means the merchant or pattern is suggestive but cadence is not fully verified.",
  },
  repeated_discretionary: {
    title: "Repeated discretionary spending",
    description:
      "Rideshare, food delivery, dining, convenience purchases, and similar activity. Shown so you can see patterns — not to tell you how to spend.",
  },
  unusual_recurring: {
    title: "Unusual recurring activity",
    description:
      "Merchants with at least two charges that deserve a closer look. These are not labeled as confirmed subscriptions.",
  },
  one_time_review: {
    title: "One-time activity to review",
    description:
      "Single charges flagged for attention. Shown without recurring or annualized savings claims.",
  },
};

import { deriveMerchantPresentation } from "./merchantNormalize";
import {
  inferSpendingInsightCategory,
  spendingCategoryDisplay,
} from "./spendingSignals";
import {
  clusterLooksSubscriptionMerchant,
  unmistakableSubscriptionBillingMerchant,
} from "./subscriptionSignals";
import type {
  MerchantCluster,
  SpendingInsight,
  SpendingInsightCategory,
  SpendingInsightKind,
  SpendingInsightRecommendation,
  StatementPeriod,
  SubscriptionCategory,
  SubscriptionFlags,
  SubscriptionFrequency,
  SubscriptionInsight,
} from "./types";

/** Strict gate vs legacy permissive subscription classifier */
export const SUBSCRIPTION_CONFIDENCE_MIN = 0.72;

function clusterBlobUpper(cluster: MerchantCluster): string {
  return `${cluster.descriptions.join(" ")} ${cluster.key}`.toUpperCase();
}

function discretionarySpendCategory(cat: SpendingInsightCategory): boolean {
  return (
    cat === "groceries" ||
    cat === "liquor" ||
    cat === "restaurants" ||
    cat === "cafes" ||
    cat === "retail" ||
    cat === "gas"
  );
}

function classifySpendingInsightMeta(args: {
  categoryKey: SpendingInsightCategory;
  debitCount: number;
  similarAmts: boolean;
  looseAmts: boolean;
  freq: SubscriptionFrequency;
}): { kind: SpendingInsightKind; recommendation: SpendingInsightRecommendation } {
  const { categoryKey, debitCount, similarAmts, looseAmts, freq } = args;

  if (categoryKey === "payroll") {
    return { kind: "income_transfer", recommendation: "Not a subscription" };
  }
  if (categoryKey === "transfers") {
    return { kind: "income_transfer", recommendation: "Not a subscription" };
  }
  if (categoryKey === "fees") {
    return { kind: "fee", recommendation: "Review this expense" };
  }

  if (debitCount >= 3 && discretionarySpendCategory(categoryKey)) {
    return {
      kind: "frequent_spending",
      recommendation: "Possible savings opportunity",
    };
  }
  if (debitCount >= 3) {
    return { kind: "frequent_spending", recommendation: "Frequent spending" };
  }

  if (
    debitCount === 2 &&
    similarAmts &&
    (freq !== "unknown" || looseAmts)
  ) {
    return {
      kind: "possible_recurring_expense",
      recommendation: "Possible savings opportunity",
    };
  }
  if (debitCount === 2 && similarAmts) {
    return {
      kind: "possible_recurring_expense",
      recommendation: "Possible savings opportunity",
    };
  }
  if (debitCount === 2) {
    return { kind: "needs_review", recommendation: "Review this expense" };
  }

  return { kind: "one_time_expense", recommendation: "Review this expense" };
}

/** Parsing noise / non-purchase rails — excluded from Spending Insights only */
export function excludeClusterFromSpendingInsights(
  cluster: MerchantCluster
): boolean {
  const blob = clusterBlobUpper(cluster);

  if (
    /\b(BEGINNING|OPENING|STARTING)\s+BALANCE\b|\b(ENDING|CLOSING|FINAL)\s+BALANCE\b|\bAVAILABLE\s+BALANCE\b|\bMINIMUM\s+PAYMENT\s+DUE\b|\bTOTAL\s+PAYMENTS?\s+THIS\s+(PERIOD|CYCLE)|\bTOTAL\s+PURCHASES\b|\bACCOUNT\s+SUMMARY\b/u.test(
      blob
    )
  ) {
    return true;
  }

  if (
    /\b(CHECK|CHK|CHEQUE|CHEQ)\b.*\b(#|NO\.?\s*\d)\b/u.test(blob) ||
    /\b(RTND|RETURNED|RTRND|DEVUELTO)\b.*\b(CHK|CHEQUE|CHECK|ITEM)\b/u.test(
      blob
    )
  ) {
    return true;
  }

  if (/\bATM\s+(W\/D|WITHDR|WITHDRAW|RETIRO)|CASH\s+WITHDRAW|\bCAJERO\b/u.test(blob)) {
    return true;
  }

  if (
    /\b(IRS|TAX\s+PAY|TREAS|HMRC|SAT\b|RENTAS|TAX\s+PAYMENT|PROPERTY\s+TAX)\b/u.test(
      blob
    )
  ) {
    return true;
  }

  if (
    /\bDEPOSITS?\s+(ATM|BK|DEP|REMOTE|MOBILE|BRANCH)|(DEPOSITO|DEP\s+SUELDO)\b|\bDIRECT\s+DEP\b.*\b(EMPLOY|SALARY|WAGE)|(ACH\s+(CREDIT|DEP|DEPOS)|REVERSAL|REFUND|CHARGEBACK|CRE\s+VCHR|ATM\s+RVRSL|ATM\s+RFD)\b|PAYMENT\s+FROM\s+DDA|\bWIRE\s+(IN(?:COMING)?|DEP|CR|CRE)\b|\bATM\s+RVRSL\b/ui.test(
      blob
    )
  ) {
    return true;
  }

  if (
    /\b(PMT\s+MADE\s+TO|AUTO\s+PAY\s+MADE\s+PAY|PAYMENTS?\s+TO\s+(YOUR\s+)?CARD|PAYMENTS?\s+TO\s+VISA|CARD\s+PAYMENTS?\s+SERV)\b/ui.test(blob) &&
    !/\b(DISNEY|NETFLIX|SPOTIFY|APPLE|ADOBE|MICROSOFT|GOOGLE|AMAZON|PRIME\b|CLOUD|SAA|SUBSCR|MUSIC\b|VIDEO\b)/u.test(blob)
  ) {
    return true;
  }

  return false;
}

export function passesTrueSubscriptionGate(
  cluster: MerchantCluster,
  row: SubscriptionInsight
): boolean {
  const debits = cluster.charges.filter((c) => c.type === "debit");
  if (debits.length < 1) return false;

  const amounts = debits.map((d) => d.amount);
  const similar = debitAmountsSimilar(amounts);
  const loose = debitAmountsLooselySimilar(amounts);
  const freq = coerceFrequency(
    inferFrequencyFromCharges(debits.map((d) => d.date))
  );
  const knownBill = clusterLooksSubscriptionMerchant(cluster);

  const unmistakableSingle =
    debits.length === 1 && unmistakableSubscriptionBillingMerchant(cluster);

  const strongRecurrence =
    debits.length >= 2 && (similar || (freq !== "unknown" && loose));

  if (unmistakableSingle) return true;

  /** Single unmistakable utility/SaaS/gym rails (handled by subscriptionSignals). */
  if (debits.length === 1 && knownBill) return true;

  if (!strongRecurrence) return false;

  const subscriptionCategories: SubscriptionCategory[] = [
    "streaming",
    "music",
    "software",
    "utilities",
    "insurance",
    "fitness",
  ];

  if (knownBill) return true;

  if (subscriptionCategories.includes(row.category)) return true;

  return false;
}

export function buildSpendingInsightsFromClusters(args: {
  clusters: MerchantCluster[];
  subscriptionClusterIds: Set<string>;
  /** Prefer excluding clusters already surfaced as subscriptions */
  maxInsights?: number;
}): SpendingInsight[] {
  const max = args.maxInsights ?? 60;
  const out: SpendingInsight[] = [];

  for (const cluster of args.clusters) {
    if (args.subscriptionClusterIds.has(cluster.id)) continue;
    if (excludeClusterFromSpendingInsights(cluster)) continue;

    const debits = cluster.charges.filter((c) => c.type === "debit");
    if (debits.length < 1) continue;

    const description = cluster.descriptions[0] ?? cluster.key;
    const presentation = deriveMerchantPresentation({
      primaryDescription: description,
      clusterKeyUpper: cluster.key,
    });

    let categoryKey = inferSpendingInsightCategory(cluster);

    const amounts = debits.map((d) => d.amount);
    const similarAmts = debitAmountsSimilar(amounts);
    const looseAmts = debitAmountsLooselySimilar(amounts);
    const freq = coerceFrequency(
      inferFrequencyFromCharges(debits.map((d) => d.date))
    );

    let { kind, recommendation } = classifySpendingInsightMeta({
      categoryKey,
      debitCount: debits.length,
      similarAmts,
      looseAmts,
      freq,
    });

    const blob = clusterBlobUpper(cluster);
    if (
      /\b(MORTGAGE|HOME\s+LOAN|MORT\s+PMT|MORTG\s+PMT)\b/ui.test(blob) &&
      debits.length >= 2
    ) {
      kind = "possible_recurring_expense";
      recommendation = "Possible savings opportunity";
    }

    const last = debits[debits.length - 1];
    const totalSpentInPeriod = debits.reduce((s, d) => s + d.amount, 0);

    out.push({
      clusterId: cluster.id,
      merchant: presentation.merchant,
      normalizedName: presentation.normalizedName,
      categoryLabel: spendingCategoryDisplay(categoryKey),
      categoryKey,
      kind,
      recommendation,
      amount: last.amount,
      currency: last.currency || "USD",
      frequency: freq,
      totalSpentInPeriod,
      lastCharged: last.date,
    });
  }

  return out
    .sort((a, b) => b.totalSpentInPeriod - a.totalSpentInPeriod)
    .slice(0, max);
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function dayDiff(a: string, b: string): number {
  const t0 = Date.UTC(
    Number(a.slice(0, 4)),
    Number(a.slice(5, 7)) - 1,
    Number(a.slice(8, 10))
  );
  const t1 = Date.UTC(
    Number(b.slice(0, 4)),
    Number(b.slice(5, 7)) - 1,
    Number(b.slice(8, 10))
  );
  return Math.round((t1 - t0) / 86400000);
}

/** Two+ charges roughly the same nominal amount (handles small rounding drift). */
export function debitAmountsSimilar(amounts: number[]): boolean {
  if (amounts.length < 2) return false;
  const med = median(amounts);
  if (!(med > 0)) return false;
  const tol = Math.max(2, med * 0.14);
  return amounts.every((a) => Math.abs(a - med) <= tol);
}

/** Adjacent tiers for telecom/utilities bills that creep month to month */
export function debitAmountsLooselySimilar(amounts: number[]): boolean {
  if (amounts.length < 2) return false;
  const med = median(amounts);
  if (!(med > 0)) return false;
  const tol = Math.max(6, med * 0.32);
  return amounts.every((a) => Math.abs(a - med) <= tol);
}

export function inferFrequencyFromCharges(
  dates: string[]
): SubscriptionFrequency {
  if (dates.length < 2) return "unknown";
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push(dayDiff(dates[i - 1], dates[i]));
  }
  const m = median(gaps);
  if (m >= 6 && m <= 9) return "weekly";
  if (m >= 25 && m <= 35) return "monthly";
  if (m >= 330 && m <= 400) return "annual";
  return "unknown";
}

/** Fix invalid frequency from typo in inference */
export function coerceFrequency(f: string): SubscriptionFrequency {
  if (
    f === "weekly" ||
    f === "monthly" ||
    f === "annual" ||
    f === "unknown"
  ) {
    return f;
  }
  return "unknown";
}

export function equivalentsForFrequency(
  amount: number,
  frequency: SubscriptionFrequency
): { monthlyEquivalent: number; annualEquivalent: number } {
  switch (frequency) {
    case "weekly":
      return {
        monthlyEquivalent: (amount * 52) / 12,
        annualEquivalent: amount * 52,
      };
    case "monthly":
      return { monthlyEquivalent: amount, annualEquivalent: amount * 12 };
    case "annual":
      return {
        monthlyEquivalent: amount / 12,
        annualEquivalent: amount,
      };
    default:
      return { monthlyEquivalent: amount, annualEquivalent: amount * 12 };
  }
}

export function computeHeuristicFlags(args: {
  cluster: MerchantCluster;
  statementPeriod: StatementPeriod | null;
  referenceDate: string;
}): SubscriptionFlags {
  const { cluster, referenceDate } = args;
  const charges = cluster.charges.filter((c) => c.type === "debit");
  const amounts = charges.map((c) => c.amount);
  const dates = charges.map((c) => c.date);
  const last = dates[dates.length - 1];
  const daysSince = last ? dayDiff(last, referenceDate) : 0;

  const amtMedian = median(amounts);
  const priceSpread =
    amtMedian > 0
      ? Math.max(...amounts.map((a) => Math.abs(a - amtMedian) / amtMedian))
      : 0;

  const dupWindow = charges.some((c, i) => {
    for (let j = i + 1; j < charges.length; j++) {
      if (
        charges[j].amount === c.amount &&
        dayDiff(c.date, charges[j].date) <= 3
      ) {
        return true;
      }
    }
    return false;
  });

  const desc = cluster.descriptions.join(" ").toUpperCase();
  const trialHints =
    /\b(TRIAL|INTRO|INTRODUCTORY|PROMO)\b/u.test(desc) && priceSpread > 0.12;

  const suspicious =
    /\b(TEST|UNKNOWN|TEMP |TMP )\b/u.test(desc) ||
    (charges.length >= 4 && amtMedian > 0 && priceSpread > 0.45);

  const forgotten =
    daysSince > 62 &&
    inferFrequencyFromCharges(dates) === "monthly" &&
    charges.length >= 2;

  return {
    forgotten,
    duplicate: dupWindow,
    priceIncreased: priceSpread > 0.15 && charges.length >= 2,
    trialConverted: trialHints,
    suspicious,
  };
}

/** Exclude non-subscription clusters (prefer false negatives). */
export function excludeClusterFromSubscriptions(
  cluster: MerchantCluster,
  recurringFrequency?: SubscriptionFrequency
): boolean {
  void recurringFrequency;
  const blob =
    `${cluster.descriptions.join(" ")} ${cluster.key}`.toUpperCase();

  if (
    /\b(PAYROLL|NÓMINA|NOMINA|NET\s+PAY|GROSS\s+PAY|SALARY|HOURLY\s+PAY|WAGE)\b/u.test(
      blob
    )
  ) {
    return true;
  }

  if (
    /\b(DIRECT\s+DEP|DIR\s+DEP)\b/u.test(blob) &&
    !/\b(SUBSCR|MEMBERSHIP|RECURRING\s+PAY)\b/u.test(blob)
  ) {
    return true;
  }

  if (
    /\b(VENMO|ZELLE|PAYPAL|WISE|REVOLUT|CASH\s*APP)\b.*\b(SEND|RECV|TRANSFER|TRANSF|PAGO|SENT)\b/u.test(
      blob
    ) ||
    /\b(TRANSFER|TRANSF|XFER|TRF|IFT|INT\s+PAY|SPEI|IBAN\s+PAY|\bWIRE\s+TRANS\b|\bOUTGOING\s+WIRE\b|\bINCOMING\s+WIRE\b|\bWIRE\s+XFER\b)\b/u.test(
      blob
    )
  ) {
    return true;
  }

  if (
    /\b(CHECK|CHK|CHEQUE|CHEQ)\b.*\b(#|NO\.?\s*\d)\b/u.test(blob) ||
    /\b(RTND|RETURNED|RTRND|DEVUELTO)\b.*\b(CHK|CHEQUE|CHECK|ITEM)\b/u.test(
      blob
    )
  ) {
    return true;
  }

  if (
    /\b(OVERDRAFT|OVERDR\.?|OD\s+F(?:EE|E)|OD\s+PAY|Maintenance\s+fee|SERVICE\s+FEE\s+CHARGE|MONTHLY\s+FEE|ACCOUNT\s+FEE)\b/u.test(
      blob
    ) ||
    /\bNSF\b|NON[-\s]*SUF|INSUFFICIENT\s+FUNDS/u.test(blob)
  ) {
    return true;
  }

  if (/\bATM\s+(W\/D|WITHDR|WITHDRAW|RETIRO)|CASH\s+WITHDRAW|\bCAJERO\b/u.test(blob)) {
    return true;
  }

  if (
    /\b(IRS|TAX\s+PAY|TREAS|HMRC|SAT\b|RENTAS|TAX\s+PAYMENT|PROPERTY\s+TAX)\b/u.test(
      blob
    )
  ) {
    return true;
  }

  if (
    /\b(MORTGAGE|HOME\s+LOAN|AUTO\s+LOAN|STUDENT\s+LOAN|PERSONAL\s+LOAN|LOAN\s+PAY|PRESTAMO|HIPOTECA)\b/u.test(
      blob
    ) &&
    !/\b(SUBSCR|MEMBERSHIP|SAAS|SOFTWARE\s+SUB)\b/u.test(blob)
  ) {
    return true;
  }

  /** Summary / balance lines that sometimes leak into parsers */
  if (
    /\b(BEGINNING|OPENING|STARTING)\s+BALANCE\b|\b(ENDING|CLOSING|FINAL)\s+BALANCE\b|\bAVAILABLE\s+BALANCE\b|\bMINIMUM\s+PAYMENT\s+DUE\b|\bTOTAL\s+PAYMENTS?\s+THIS\s+(PERIOD|CYCLE)|\bTOTAL\s+PURCHASES\b|\bACCOUNT\s+SUMMARY\b/u.test(
      blob
    )
  ) {
    return true;
  }

  /** Deposits, refunds & explicit credits typed as withdrawals in noisy PDFs */
  if (
    /\bDEPOSITS?\s+(ATM|BK|DEP|REMOTE|MOBILE|BRANCH)|(DEPOSITO|DEP\s+SUELDO)\b|\bDIRECT\s+DEP\b.*\b(EMPLOY|SALARY|WAGE)|(ACH\s+(CREDIT|DEP|DEPOS)|REVERSAL|REFUND|CHARGEBACK|CRE\s+VCHR|ATM\s+RVRSL|ATM\s+RFD)\b|PAYMENT\s+FROM\s+DDA|\bWIRE\s+(IN(?:COMING)?|DEP|CR|CRE)\b|\bATM\s+RVRSL\b/ui.test(
      blob
    )
  ) {
    return true;
  }

  /** Generic card payoff / ACH card payment rails (distinct from SaaS billed to the card). */
  if (
    /\b(PMT\s+MADE\s+TO|AUTO\s+PAY\s+MADE\s+PAY|PAYMENTS?\s+TO\s+(YOUR\s+)?CARD|PAYMENTS?\s+TO\s+VISA|MORTG\s+PMT|MORT\s+PMT|CARD\s+PAYMENTS?\s+SERV)\b/ui.test(blob) &&
    !/\b(DISNEY|NETFLIX|SPOTIFY|APPLE|ADOBE|MICROSOFT|GOOGLE|AMAZON|PRIME\b|CLOUD|SAA|SUBSCR|MUSIC\b|VIDEO\b)/u.test(blob)
  ) {
    return true;
  }

  return false;
}

/**
 * Offline subscription-ish rows (also used to supplement conservative OpenAI output).
 */
export function heuristicSubscriptionsFromClusters(
  clusters: MerchantCluster[],
  statementPeriod: StatementPeriod | null,
  heuristicRefDate: string,
  displayRefDate: string
): SubscriptionInsight[] {
  const out: SubscriptionInsight[] = [];

  for (const cluster of clusters) {
    if (excludeClusterFromSubscriptions(cluster)) continue;

    const debits = cluster.charges.filter((c) => c.type === "debit");
    if (debits.length < 1) continue;

    const description = cluster.descriptions[0] ?? cluster.key;

    const subStyle = clusterLooksSubscriptionMerchant(cluster);
    const freq = coerceFrequency(inferFrequencyFromCharges(debits.map((d) => d.date)));

    const amounts = debits.map((d) => d.amount);
    const similarAmts = debitAmountsSimilar(amounts);
    const looseAmts = debitAmountsLooselySimilar(amounts);

    const include =
      (debits.length >= 2 && similarAmts && subStyle) ||
      (debits.length >= 2 && subStyle && looseAmts) ||
      (debits.length === 1 && subStyle);

    if (!include) continue;

    /** Confidence tuned for downstream SUBSCRIPTION_CONFIDENCE_MIN gate */
    let confidence = 0.62;
    if (debits.length >= 2 && similarAmts && subStyle) {
      confidence = freq === "unknown" ? 0.85 : 0.93;
    } else if (debits.length >= 2 && looseAmts && subStyle) {
      confidence = 0.78;
    } else if (debits.length === 1 && subStyle) {
      confidence = unmistakableSubscriptionBillingMerchant(cluster)
        ? 0.84
        : 0.74;
    }

    const lastAmt = amounts[amounts.length - 1];
    const inferredFreq =
      freq === "unknown" && similarAmts && debits.length >= 2 ? "monthly" : freq;
    const { monthlyEquivalent, annualEquivalent } = equivalentsForFrequency(
      lastAmt,
      inferredFreq
    );

    const flags = computeHeuristicFlags({
      cluster,
      statementPeriod,
      referenceDate: heuristicRefDate,
    });

    const { merchant, normalizedName, category } = deriveMerchantPresentation({
      primaryDescription: description,
      clusterKeyUpper: cluster.key,
    });

    const totalSpentInPeriod = debits.reduce((s, d) => s + d.amount, 0);
    const lastCharged = debits[debits.length - 1].date;
    const daysSinceLastCharge = lastCharged
      ? dayDiff(lastCharged, displayRefDate)
      : null;

    const currency =
      debits[debits.length - 1]?.currency || debits[0]?.currency || "USD";

    out.push({
      merchant,
      normalizedName,
      category,
      amount: lastAmt,
      currency,
      frequency: coerceFrequency(inferredFreq),
      lastCharged,
      monthlyEquivalent,
      annualEquivalent,
      confidence: Math.min(0.96, confidence),
      flags,
      clusterId: cluster.id,
      totalSpentInPeriod,
      daysSinceLastCharge,
    });
  }

  return out.sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);
}


export type SubscriptionEligibilitySnapshot = {
  clusterId: string;
  debitCount: number;
  excluded: boolean;
  eligibleCandidate: boolean;
  reason?: string;
};

/**
 * Mirrors `heuristicSubscriptionsFromClusters` gating — used only for telemetry.
 */
export function snapshotSubscriptionCandidate(
  cluster: MerchantCluster
): SubscriptionEligibilitySnapshot {
  const debits = cluster.charges.filter((c) => c.type === "debit");

  const base: SubscriptionEligibilitySnapshot = {
    clusterId: cluster.id,
    debitCount: debits.length,
    excluded: false,
    eligibleCandidate: false,
  };

  if (debits.length < 1) {
    return base;
  }

  if (excludeClusterFromSubscriptions(cluster)) {
    return { ...base, excluded: true };
  }

  const subStyle = clusterLooksSubscriptionMerchant(cluster);
  const amounts = debits.map((d) => d.amount);
  const similarAmts = debitAmountsSimilar(amounts);
  const looseAmts = debitAmountsLooselySimilar(amounts);

  const include =
    (debits.length >= 2 && similarAmts && subStyle) ||
    (debits.length >= 2 && subStyle && looseAmts) ||
    (debits.length === 1 && subStyle);

  let reason = "";
  if (!include) {
    reason =
      "Needs recognizable subscription/billing merchant plus recurrence (or unmistakable single bill).";
  } else if (debits.length >= 2 && similarAmts && subStyle) {
    const freqLabel = coerceFrequency(inferFrequencyFromCharges(debits.map((d) => d.date)));
    reason = `${debits.length} similar debits (${freqLabel} cadence hint).`;
  } else if (debits.length >= 2 && subStyle && looseAmts) {
    reason = `${debits.length} variable debits paired with SaaS/utility-style keywords.`;
  } else if (debits.length === 1 && subStyle) {
    reason = "Single debit keyed to recognizable subscription rails.";
  }

  return {
    clusterId: cluster.id,
    debitCount: debits.length,
    excluded: false,
    eligibleCandidate: include,
    reason,
  };
}

export function mergeFlags(
  ai: SubscriptionFlags,
  heur: SubscriptionFlags
): SubscriptionFlags {
  return {
    forgotten: ai.forgotten || heur.forgotten,
    duplicate: ai.duplicate || heur.duplicate,
    priceIncreased: ai.priceIncreased || heur.priceIncreased,
    trialConverted: ai.trialConverted || heur.trialConverted,
    suspicious: ai.suspicious || heur.suspicious,
  };
}

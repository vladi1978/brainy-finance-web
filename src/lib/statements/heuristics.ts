import { friendlyMerchantSubscriptionLabel } from "./merchantNormalize";
import type {
  MerchantCluster,
  StatementPeriod,
  SubscriptionCategory,
  SubscriptionFlags,
  SubscriptionFrequency,
  SubscriptionInsight,
} from "./types";

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
    /\b(TRANSFER|TRANSF|XFER|TRF|IFT|INT\s+PAY|WIRE|SPEI|IBAN\s+PAY)\b/u.test(
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

  return false;
}

export function heuristicSubscriptionsFromClusters(
  clusters: MerchantCluster[],
  statementPeriod: StatementPeriod | null,
  heuristicRefDate: string,
  displayRefDate: string
): SubscriptionInsight[] {
  const out: SubscriptionInsight[] = [];
  for (const cluster of clusters) {
    const debits = cluster.charges.filter((c) => c.type === "debit");
    if (debits.length < 2) continue;

    const freq = coerceFrequency(inferFrequencyFromCharges(debits.map((d) => d.date)));
    if (freq === "unknown" && debits.length < 3) continue;

    if (excludeClusterFromSubscriptions(cluster, freq)) continue;

    const amounts = debits.map((d) => d.amount);
    const lastAmt = amounts[amounts.length - 1];
    const { monthlyEquivalent, annualEquivalent } = equivalentsForFrequency(
      lastAmt,
      freq
    );

    const flags = computeHeuristicFlags({
      cluster,
      statementPeriod,
      referenceDate: heuristicRefDate,
    });

    const merchant = cluster.descriptions[0] ?? cluster.key;
    const normalizedName = friendlyMerchantSubscriptionLabel({
      primaryDescription: merchant,
      clusterKeyUpper: cluster.key,
    });
    const totalSpentInPeriod = debits.reduce((s, d) => s + d.amount, 0);
    const lastCharged = debits[debits.length - 1].date;
    const daysSinceLastCharge = lastCharged
      ? dayDiff(lastCharged, displayRefDate)
      : null;
    const currency =
      debits[debits.length - 1]?.currency ||
      debits[0]?.currency ||
      "USD";

    out.push({
      merchant,
      normalizedName,
      category: guessCategory(merchant),
      amount: lastAmt,
      currency,
      frequency: freq,
      lastCharged,
      monthlyEquivalent,
      annualEquivalent,
      confidence: 0.45,
      flags,
      clusterId: cluster.id,
      totalSpentInPeriod,
      daysSinceLastCharge,
    });
  }
  return out.sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);
}

function guessCategory(_merchant: string): SubscriptionCategory {
  return "other";
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

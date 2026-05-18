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
      normalizedName: merchant.slice(0, 80),
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

function guessCategory(merchant: string): SubscriptionCategory {
  const m = merchant.toUpperCase();
  if (/\b(NETFLIX|HULU|DISNEY|HBO|MAX|PRIME VIDEO|PEACOCK)\b/u.test(m)) {
    return "streaming";
  }
  if (/\b(SPOTIFY|APPLE MUSIC|TIDAL|YOUTUBE MUSIC|PANDORA)\b/u.test(m)) {
    return "music";
  }
  if (/\b(PELOTON|PLANET FITNESS|GYM|FITNESS)\b/u.test(m)) return "fitness";
  if (/\b(STATE FARM|GEICO|ALLSTATE|INSURANCE)\b/u.test(m)) {
    return "insurance";
  }
  if (
    /\b(MICROSOFT|ADOBE|DROPBOX|NOTION|SLACK|ZOOM|OPENAI|GITHUB)\b/u.test(m)
  ) {
    return "software";
  }
  if (/\b(AMAZON PRIME|WALMART\+|TARGET)\b/u.test(m)) return "shopping";
  if (/\b(ELECTRIC|WATER|GAS UTIL|INTERNET|COMCAST|ATT|VERIZON)\b/u.test(m)) {
    return "utilities";
  }
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

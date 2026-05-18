import { buildMerchantClusters } from "./clusters";
import { extractPdfText } from "./extractPdfText";
import {
  SUBSCRIPTION_CONFIDENCE_MIN,
  buildSpendingInsightsFromClusters,
  coerceFrequency,
  computeHeuristicFlags,
  equivalentsForFrequency,
  excludeClusterFromSubscriptions,
  heuristicSubscriptionsFromClusters,
  inferFrequencyFromCharges,
  mergeFlags,
  debitAmountsSimilar,
  passesTrueSubscriptionGate,
  snapshotSubscriptionCandidate,
} from "./heuristics";
import { deriveMerchantPresentation } from "./merchantNormalize";
import { clusterLooksSubscriptionMerchant } from "./subscriptionSignals";
import { analyzeClustersWithOpenAI } from "./openaiAnalyze";
import { deriveStatementPeriod, parseTransactionsFromText } from "./parseTransactions";
import type {
  AnalyzeStatementResult,
  MerchantCluster,
  SubscriptionCategory,
  SubscriptionInsight,
} from "./types";

function subscriptionCategory(raw: string): SubscriptionCategory {
  const allowed: SubscriptionCategory[] = [
    "streaming",
    "music",
    "fitness",
    "insurance",
    "software",
    "shopping",
    "utilities",
    "other",
  ];
  return allowed.includes(raw as SubscriptionCategory)
    ? (raw as SubscriptionCategory)
    : "other";
}

function isoTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function heuristicReferenceDate(
  statementPeriod: AnalyzeStatementResult["statementPeriod"]
): string {
  return statementPeriod?.end ?? isoTodayUtc();
}

function enrichAiSubscription(args: {
  raw: {
    clusterId: string;
    merchant: string;
    normalizedName: string;
    category: string;
    amount: number;
    currency: string;
    frequency: string;
    lastCharged: string;
    monthlyEquivalent: number;
    annualEquivalent: number;
    confidence: number;
    flags: SubscriptionInsight["flags"];
  };
  clusterById: Map<string, MerchantCluster>;
  statementPeriod: AnalyzeStatementResult["statementPeriod"];
  heuristicRefDate: string;
  displayRefDate: string;
}): SubscriptionInsight | null {
  const {
    raw,
    clusterById,
    statementPeriod,
    heuristicRefDate,
    displayRefDate,
  } = args;
  const cluster = clusterById.get(raw.clusterId);
  if (!cluster) return null;

  const sampleMerchant = (cluster.descriptions[0] ?? raw.merchant).trim();

  const presentation = deriveMerchantPresentation({
    primaryDescription: sampleMerchant || raw.merchant,
    clusterKeyUpper: cluster.key,
  });

  const heurFlags = computeHeuristicFlags({
    cluster,
    statementPeriod,
    referenceDate: heuristicRefDate,
  });
  const flags = mergeFlags(raw.flags, heurFlags);

  const debits = cluster.charges.filter((c) => c.type === "debit");
  const totalSpentInPeriod = debits.reduce((s, c) => s + c.amount, 0);

  const amtList = debits.map((d) => d.amount);

  let confidence = Math.min(1, Math.max(0, raw.confidence));
  if (!excludeClusterFromSubscriptions(cluster)) {
    if (debitAmountsSimilar(amtList) && debits.length >= 2) {
      confidence = Math.max(confidence, 0.9);
      if (!clusterLooksSubscriptionMerchant(cluster)) {
        confidence = Math.min(confidence, SUBSCRIPTION_CONFIDENCE_MIN - 0.05);
      }
    } else if (clusterLooksSubscriptionMerchant(cluster)) {
      confidence = Math.max(
        confidence,
        debits.length >= 2 ? 0.82 : SUBSCRIPTION_CONFIDENCE_MIN
      );
    }
  }

  const freq = coerceFrequency(raw.frequency);
  const eq = equivalentsForFrequency(raw.amount, freq);

  const lastFromData =
    debits.length > 0 ? debits[debits.length - 1].date : raw.lastCharged;
  const lastCharged =
    lastFromData && raw.lastCharged && raw.lastCharged > lastFromData
      ? raw.lastCharged
      : lastFromData || raw.lastCharged;

  const ref = displayRefDate;
  let daysSinceLastCharge: number | null = null;
  if (lastCharged && ref) {
    const t0 = Date.UTC(
      Number(lastCharged.slice(0, 4)),
      Number(lastCharged.slice(5, 7)) - 1,
      Number(lastCharged.slice(8, 10))
    );
    const t1 = Date.UTC(
      Number(ref.slice(0, 4)),
      Number(ref.slice(5, 7)) - 1,
      Number(ref.slice(8, 10))
    );
    daysSinceLastCharge = Math.max(
      0,
      Math.round((t1 - t0) / 86400000)
    );
  }

  const aiCat = subscriptionCategory(raw.category);
  const category = aiCat !== "other" ? aiCat : presentation.category;

  return {
    merchant: presentation.merchant,
    normalizedName: presentation.normalizedName,
    category,
    amount: raw.amount,
    currency:
      raw.currency?.trim() ||
      debits[debits.length - 1]?.currency ||
      "USD",
    frequency: freq,
    lastCharged,
    monthlyEquivalent: Number.isFinite(raw.monthlyEquivalent)
      ? raw.monthlyEquivalent
      : eq.monthlyEquivalent,
    annualEquivalent: Number.isFinite(raw.annualEquivalent)
      ? raw.annualEquivalent
      : eq.annualEquivalent,
    confidence,
    flags,
    clusterId: raw.clusterId,
    totalSpentInPeriod,
    daysSinceLastCharge,
  };
}

function buildSummary(
  subs: SubscriptionInsight[],
  spendingInsightsTotal: number
): AnalyzeStatementResult["summary"] {
  const monthlySpend = subs.reduce((s, x) => s + x.monthlyEquivalent, 0);
  const annualSpend = subs.reduce((s, x) => s + x.annualEquivalent, 0);
  const subscriptionCount = subs.length;
  const flagged = subs.filter(
    (x) =>
      x.flags.forgotten ||
      x.flags.duplicate ||
      x.flags.suspicious ||
      x.flags.priceIncreased
  );
  const estimatedSavings = flagged.reduce(
    (s, x) => s + x.monthlyEquivalent,
    0
  );
  return {
    monthlySpend,
    annualSpend,
    subscriptionCount,
    estimatedSavings,
    spendingInsightsTotal,
  };
}

function passesSubscriptionConfidenceGate(s: SubscriptionInsight): boolean {
  return s.confidence >= SUBSCRIPTION_CONFIDENCE_MIN;
}

/** Higher confidence wins for overlapping cluster ids coming from LM + offline rules. */
function mergeByClusterPreferHigherConfidence(
  lists: SubscriptionInsight[][]
): SubscriptionInsight[] {
  const merged = new Map<string, SubscriptionInsight>();
  for (const list of lists) {
    for (const row of list) {
      const prev = merged.get(row.clusterId);
      if (!prev || prev.confidence < row.confidence) merged.set(row.clusterId, row);
    }
  }
  return [...merged.values()];
}

function emitSubscriptionInferenceDebug(opts: {
  transactionCount: number;
  clusters: MerchantCluster[];
  heuristicRows: SubscriptionInsight[];
  gatedSubscriptions: SubscriptionInsight[];
  spendingInsightCount: number;
}) {
  const snaps = opts.clusters.map(snapshotSubscriptionCandidate);
  const excludedDebitClustersMarkedNonSubscription = snaps.filter(
    (s) => s.debitCount > 0 && s.excluded
  ).length;
  const candidateMerchantCount = snaps.filter((s) => s.eligibleCandidate).length;
  const firstTenEligible = snaps
    .filter((s) => s.eligibleCandidate)
    .slice(0, 10)
    .map((snap) => {
      const lab =
        opts.heuristicRows.find((h) => h.clusterId === snap.clusterId)
          ?.normalizedName ??
        opts.clusters.find((c) => c.id === snap.clusterId)?.key ??
        "?";
      return { merchantHint: lab, clusterId: snap.clusterId, reason: snap.reason };
    });

  console.log("[statements/subscriptions] totals", {
    transactionsAnalyzed: opts.transactionCount,
    excludedDebitClustersMarkedNonSubscription,
    candidateRecurringOrServiceMerchants: candidateMerchantCount,
    finalSubscriptionsPassedConfidenceGate:
      opts.gatedSubscriptions.length,
    spendingInsightCount: opts.spendingInsightCount,
    firstEligibleCandidatesPreview: firstTenEligible,
    heuristicRowsBeforeConfidenceGate: opts.heuristicRows.length,
  });
}

export async function analyzeStatementPdf(
  buffer: Buffer,
  options?: { signal?: AbortSignal }
): Promise<AnalyzeStatementResult> {
  const outerSignal = options?.signal;

  const { text, pageCount } = await extractPdfText(buffer);

  const timeoutMs = Number(process.env.OPENAI_SUBSCRIPTIONS_TIMEOUT_MS?.trim());
  const ms =
    Number.isFinite(timeoutMs) && timeoutMs > 5000 ? timeoutMs : 45000;

  const aiController = new AbortController();
  const onOuterAbort = () => aiController.abort();
  if (outerSignal) {
    if (outerSignal.aborted) aiController.abort();
    else outerSignal.addEventListener("abort", onOuterAbort, { once: true });
  }
  const killTimer = setTimeout(() => aiController.abort(), ms);

  let parseDebug: AnalyzeStatementResult["parseDebug"] = null;
  let transactions: AnalyzeStatementResult["transactions"] = [];

  try {
    const parsed = await parseTransactionsFromText(text, aiController.signal);
    transactions = parsed.transactions;
    parseDebug = parsed.debug;
  } catch (e) {
    console.warn(
      "[statements/analyze] transaction pipeline:",
      e instanceof Error ? e.message : e
    );
    parseDebug = null;
    transactions = [];
  }

  const statementPeriod = deriveStatementPeriod(transactions);
  const clusters = buildMerchantClusters(transactions);
  const heuristicRefDate = heuristicReferenceDate(statementPeriod);
  const displayRefDate = isoTodayUtc();
  const clusterById = new Map(clusters.map((c) => [c.id, c]));

  const heuristicRows = heuristicSubscriptionsFromClusters(
    clusters,
    statementPeriod,
    heuristicRefDate,
    displayRefDate
  );

  let aiSubscriptions: SubscriptionInsight[] = [];
  let openAiUsed = false;
  let openAiError: string | null = null;
  let fallbackUsed = true;

  try {
    const ai = await analyzeClustersWithOpenAI(clusters, aiController.signal);
    openAiError = ai.error;

    const filteredItems = ai.items.filter((raw) => {
      const cluster = clusterById.get(raw.clusterId);
      if (!cluster) return false;
      const debitsOnly = cluster.charges.filter((c) => c.type === "debit");
      const inferredFreq = coerceFrequency(
        inferFrequencyFromCharges(debitsOnly.map((d) => d.date))
      );
      return !excludeClusterFromSubscriptions(cluster, inferredFreq);
    });

    aiSubscriptions = filteredItems
      .map((raw) =>
        enrichAiSubscription({
          raw,
          clusterById,
          statementPeriod,
          heuristicRefDate,
          displayRefDate,
        })
      )
      .filter((x): x is SubscriptionInsight => Boolean(x));

    openAiUsed = aiSubscriptions.length > 0;
    fallbackUsed = !openAiUsed;

    if (filteredItems.length > 0 && aiSubscriptions.length === 0) {
      openAiError =
        openAiError ??
        "Could not correlate OpenAI subscriptions with debit clusters.";
    }
  } catch (e) {
    openAiError =
      openAiError ??
      (e instanceof Error ? e.message : "Unexpected OpenAI error");
    fallbackUsed = true;
  } finally {
    clearTimeout(killTimer);
    if (outerSignal) {
      outerSignal.removeEventListener("abort", onOuterAbort);
    }
  }

  const merged = mergeByClusterPreferHigherConfidence([
    heuristicRows,
    aiSubscriptions,
  ]);

  const excludedFromSubscriptions: AnalyzeStatementResult["diagnostics"]["excludedFromSubscriptions"] =
    [];

  const subscriptionCandidateRows = merged.filter((row) => {
    const cluster = clusterById.get(row.clusterId);
    return Boolean(cluster && !excludeClusterFromSubscriptions(cluster));
  });

  for (const row of subscriptionCandidateRows) {
    const cluster = clusterById.get(row.clusterId)!;
    const reasons: string[] = [];
    if (!passesSubscriptionConfidenceGate(row)) {
      reasons.push(
        `Confidence ${row.confidence.toFixed(2)} is below ${SUBSCRIPTION_CONFIDENCE_MIN}`
      );
    }
    if (!passesTrueSubscriptionGate(cluster, row)) {
      reasons.push(
        "Excluded from subscriptions: needs recognizable recurring bill or subscription merchant (routine purchases go to Spending Insights)"
      );
    }
    if (reasons.length) {
      excludedFromSubscriptions.push({
        clusterId: row.clusterId,
        merchantLabel: row.normalizedName,
        reasons,
      });
    }
  }

  let subscriptions = subscriptionCandidateRows.filter((row) => {
    const cluster = clusterById.get(row.clusterId)!;
    return (
      passesSubscriptionConfidenceGate(row) &&
      passesTrueSubscriptionGate(cluster, row)
    );
  });

  subscriptions = dedupeSubscriptions(subscriptions);

  const subscriptionClusterIds = new Set(subscriptions.map((s) => s.clusterId));

  const spendingInsights = buildSpendingInsightsFromClusters({
    clusters,
    subscriptionClusterIds,
  });

  const spendingInsightsTotal = spendingInsights.reduce(
    (s, x) => s + x.totalSpentInPeriod,
    0
  );

  emitSubscriptionInferenceDebug({
    transactionCount: transactions.length,
    clusters,
    heuristicRows,
    gatedSubscriptions: subscriptions,
    spendingInsightCount: spendingInsights.length,
  });

  const summary = buildSummary(subscriptions, spendingInsightsTotal);

  return {
    textChars: text.length,
    pageCount,
    transactions,
    statementPeriod,
    clusters,
    subscriptions,
    spendingInsights,
    summary,
    diagnostics: {
      subscriptionCount: subscriptions.length,
      spendingInsightCount: spendingInsights.length,
      excludedFromSubscriptions,
    },
    openAiUsed,
    openAiError,
    fallbackUsed,
    parseDebug,
  };
}

function dedupeSubscriptions(items: SubscriptionInsight[]): SubscriptionInsight[] {
  const map = new Map<string, SubscriptionInsight>();
  for (const s of items) {
    const k = s.normalizedName.trim().toUpperCase();
    const prev = map.get(k);
    if (!prev || prev.confidence < s.confidence) map.set(k, s);
  }
  return [...map.values()].sort(
    (a, b) => b.monthlyEquivalent - a.monthlyEquivalent
  );
}

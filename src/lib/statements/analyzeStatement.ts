import { buildMerchantClusters } from "./clusters";
import { extractPdfText } from "./extractPdfText";
import {
  SUBSCRIPTION_CONFIDENCE_MIN,
  TRUE_SUBSCRIPTION_SCORE_MIN,
  buildSpendingInsightsFromClusters,
  coerceFrequency,
  computeHeuristicFlags,
  computeTrueSubscriptionScore,
  equivalentsForFrequency,
  excludeClusterFromSubscriptions,
  heuristicSubscriptionsFromClusters,
  inferFrequencyFromCharges,
  mergeFlags,
  debitAmountsSimilar,
  passesTrueSubscriptionGate,
  snapshotSubscriptionCandidate,
} from "./heuristics";
import {
  buildMerchantNormalizationMap,
  clusterMerchantPresentation,
  merchantNormalizationDiagnostics,
} from "./merchantNormalization";
import type { MerchantNormalizationResult } from "./merchantNormalization";
import { clusterLooksSubscriptionMerchant } from "./subscriptionSignals";
import { analyzeClustersWithOpenAI } from "./openaiAnalyze";
import { deriveStatementPeriod, parseTransactionsFromText } from "./parseTransactions";
import { buildStatementIntelligence } from "./intelligence/buildIntelligence";
import type {
  AnalyzeStatementResult,
  MerchantCluster,
  SubscriptionCategory,
  SubscriptionFlags,
  SubscriptionInsight,
} from "./types";

function subscriptionCategory(raw: string): SubscriptionCategory {
  const allowed: SubscriptionCategory[] = [
    "streaming",
    "music",
    "fitness",
    "insurance",
    "software",
    "cloud_storage",
    "ai_tools",
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
    flags: Partial<SubscriptionInsight["flags"]>;
  };
  clusterById: Map<string, MerchantCluster>;
  merchantNormByClusterId: Map<string, MerchantNormalizationResult>;
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

  const presentation = clusterMerchantPresentation(
    cluster,
    args.merchantNormByClusterId?.get(cluster.id)
  );

  const heurFlags = computeHeuristicFlags({
    cluster,
    statementPeriod,
    referenceDate: heuristicRefDate,
  });
  const aiNorm: SubscriptionFlags = {
    forgotten: Boolean(raw.flags?.forgotten),
    duplicate: Boolean(raw.flags?.duplicate),
    priceIncreased: Boolean(raw.flags?.priceIncreased),
    trialConverted: Boolean(raw.flags?.trialConverted),
    suspicious: Boolean(raw.flags?.suspicious),
    reviewSuggested: Boolean(raw.flags?.reviewSuggested),
    confirmed: Boolean(raw.flags?.confirmed),
  };
  const flags = mergeFlags(aiNorm, heurFlags);

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
    trueSubscriptionScore: 0,
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
  recurringExpenseCount: number;
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

  const totals = {
    transactionsAnalyzed: opts.transactionCount,
    excludedDebitClustersMarkedNonSubscription,
    candidateRecurringOrServiceMerchants: candidateMerchantCount,
    finalSubscriptionsPassedConfidenceGate:
      opts.gatedSubscriptions.length,
    spendingInsightCount: opts.spendingInsightCount,
    recurringExpenseCount: opts.recurringExpenseCount,
    heuristicRowsBeforeConfidenceGate: opts.heuristicRows.length,
  };

  if (process.env.NODE_ENV === "production") {
    console.log("[statements/subscriptions] totals", totals);
  } else {
    console.log("[statements/subscriptions] totals", {
      ...totals,
      firstEligibleCandidatesPreview: firstTenEligible,
    });
  }
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

  const merchantNormByClusterId = await buildMerchantNormalizationMap({
    clusters,
    signal: aiController.signal,
  });

  const heuristicRows = heuristicSubscriptionsFromClusters(
    clusters,
    statementPeriod,
    heuristicRefDate,
    displayRefDate,
    merchantNormByClusterId
  );

  let aiSubscriptions: SubscriptionInsight[] = [];
  const aiSourceClusterIds = new Set<string>();
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
          merchantNormByClusterId,
          statementPeriod,
          heuristicRefDate,
          displayRefDate,
        })
      )
      .filter((x): x is SubscriptionInsight => Boolean(x));

    for (const item of aiSubscriptions) {
      aiSourceClusterIds.add(item.clusterId);
    }

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

  subscriptions = dedupeSubscriptions(subscriptions).map((row) => {
    const cluster = clusterById.get(row.clusterId)!;
    const trueSubscriptionScore = computeTrueSubscriptionScore(cluster, row);
    const confirmed =
      trueSubscriptionScore >= 0.78 &&
      row.confidence >= SUBSCRIPTION_CONFIDENCE_MIN &&
      !row.flags.suspicious &&
      !row.flags.duplicate;
    const reviewSuggested =
      !confirmed &&
      (row.flags.suspicious ||
        row.confidence < 0.78 ||
        row.flags.trialConverted);
    return {
      ...row,
      trueSubscriptionScore,
      flags: {
        ...row.flags,
        confirmed,
        reviewSuggested,
      },
    };
  });

  subscriptions = subscriptions.filter(
    (row) => row.trueSubscriptionScore >= TRUE_SUBSCRIPTION_SCORE_MIN
  );

  const subscriptionClusterIds = new Set(subscriptions.map((s) => s.clusterId));

  const { recurringExpenses, spendingInsights, transfers } =
    buildSpendingInsightsFromClusters({
      clusters,
      subscriptionClusterIds,
      merchantNormByClusterId,
    });

  const spendingInsightsTotal = spendingInsights.reduce(
    (s, x) => s + x.totalSpentInPeriod,
    0
  );

  const aiAssistedSubscriptionClusterIds = subscriptions
    .filter((s) => aiSourceClusterIds.has(s.clusterId))
    .map((s) => s.clusterId);

  emitSubscriptionInferenceDebug({
    transactionCount: transactions.length,
    clusters,
    heuristicRows,
    gatedSubscriptions: subscriptions,
    spendingInsightCount: spendingInsights.length,
    recurringExpenseCount: recurringExpenses.length,
  });

  const summary = buildSummary(subscriptions, spendingInsightsTotal);

  const intelligence = buildStatementIntelligence({
    statementPeriod,
    clusters,
    subscriptions,
    recurringExpenses,
    spendingInsights,
    transfers,
    merchantNormByClusterId,
  });

  return {
    textChars: text.length,
    pageCount,
    transactions,
    statementPeriod,
    clusters,
    subscriptions,
    recurringExpenses,
    spendingInsights,
    transfers,
    summary,
    diagnostics: {
      subscriptionCount: subscriptions.length,
      spendingInsightCount: spendingInsights.length,
      recurringExpenseCount: recurringExpenses.length,
      aiAssistedSubscriptionClusterIds,
      excludedFromSubscriptions,
      merchantNormalizations: merchantNormalizationDiagnostics(
        clusters,
        merchantNormByClusterId
      ),
    },
    openAiUsed,
    openAiError,
    fallbackUsed,
    parseDebug,
    intelligence,
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

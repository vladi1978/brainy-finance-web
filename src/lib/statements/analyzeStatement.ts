import { buildMerchantClusters } from "./clusters";
import { extractPdfText } from "./extractPdfText";
import {
  coerceFrequency,
  computeHeuristicFlags,
  equivalentsForFrequency,
  heuristicSubscriptionsFromClusters,
  mergeFlags,
} from "./heuristics";
import { analyzeClustersWithOpenAI } from "./openaiAnalyze";
import {
  deriveStatementPeriod,
  parseTransactionsFromText,
} from "./parseTransactions";
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

  const heurFlags = computeHeuristicFlags({
    cluster,
    statementPeriod,
    referenceDate: heuristicRefDate,
  });
  const flags = mergeFlags(raw.flags, heurFlags);

  const debits = cluster.charges.filter((c) => c.type === "debit");
  const totalSpentInPeriod = debits.reduce((s, c) => s + c.amount, 0);

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

  return {
    merchant: raw.merchant,
    normalizedName: raw.normalizedName,
    category: subscriptionCategory(raw.category),
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
    confidence: Math.min(1, Math.max(0, raw.confidence)),
    flags,
    clusterId: raw.clusterId,
    totalSpentInPeriod,
    daysSinceLastCharge,
  };
}

function buildSummary(subs: SubscriptionInsight[]): AnalyzeStatementResult["summary"] {
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
  return { monthlySpend, annualSpend, subscriptionCount, estimatedSavings };
}

export async function analyzeStatementPdf(
  buffer: Buffer,
  options?: { signal?: AbortSignal }
): Promise<AnalyzeStatementResult> {
  const outerSignal = options?.signal;

  const { text, pageCount } = await extractPdfText(buffer);
  const transactions = parseTransactionsFromText(text);
  const statementPeriod = deriveStatementPeriod(transactions);
  const clusters = buildMerchantClusters(transactions);
  const heuristicRefDate = heuristicReferenceDate(statementPeriod);
  const displayRefDate = isoTodayUtc();

  const clusterById = new Map(clusters.map((c) => [c.id, c]));
  let subscriptions: SubscriptionInsight[] = [];
  let openAiUsed = false;
  let openAiError: string | null = null;
  let fallbackUsed = false;

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

  try {
    const ai = await analyzeClustersWithOpenAI(clusters, aiController.signal);
    openAiError = ai.error;
    if (ai.items.length > 0) {
      const enriched = ai.items
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
      const dedup = dedupeSubscriptions(enriched);
      subscriptions = dedup;
      if (subscriptions.length > 0) {
        openAiUsed = true;
      } else {
        openAiError =
          openAiError ??
          "La respuesta de OpenAI no se pudo enlazar con las transacciones.";
      }
    }
  } catch (e) {
    openAiError =
      e instanceof Error ? e.message : "Error al llamar a OpenAI";
  } finally {
    clearTimeout(killTimer);
    if (outerSignal) {
      outerSignal.removeEventListener("abort", onOuterAbort);
    }
  }

  if (!subscriptions.length) {
    fallbackUsed = true;
    subscriptions = heuristicSubscriptionsFromClusters(
      clusters,
      statementPeriod,
      heuristicRefDate,
      displayRefDate
    );
  }

  const summary = buildSummary(subscriptions);

  return {
    textChars: text.length,
    pageCount,
    transactions,
    statementPeriod,
    clusters,
    subscriptions,
    summary,
    openAiUsed,
    openAiError,
    fallbackUsed,
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

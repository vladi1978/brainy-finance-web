"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { CopilotFeedSection } from "@/components/statements/copilot/CopilotFeedSection";
import { FinancialIntelligenceSummaryPanel } from "@/components/statements/FinancialIntelligenceSummary";
import type { FinancialIntelligenceSummary } from "@/lib/statements/intelligence/financialCategories";
import type { CopilotTimelineResult } from "@/lib/statements/timeline/types";
import { ProviderComparisonModal } from "@/components/statements/actions/ProviderComparisonModal";
import { RecommendationActionCard } from "@/components/statements/actions/RecommendationActionCard";
import { SavingsAcceptedSummary } from "@/components/statements/actions/SavingsAcceptedSummary";
import { useRecommendationActions } from "@/components/statements/actions/useRecommendationActions";
import { SUBSCRIPTION_CONFIDENCE_MIN, TRUE_SUBSCRIPTION_SCORE_MIN } from "@/lib/statements/heuristics";
import type { RecommendationActionType } from "@/lib/statements/recommendations/types";

type SubscriptionFlags = {
  forgotten: boolean;
  duplicate: boolean;
  priceIncreased: boolean;
  trialConverted: boolean;
  suspicious: boolean;
  reviewSuggested: boolean;
  confirmed: boolean;
};

type SubscriptionRow = {
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
  trueSubscriptionScore: number;
  flags: SubscriptionFlags;
  totalSpentInPeriod: number;
  daysSinceLastCharge: number | null;
};

type ParseDebugMeta = {
  totalExtractedChars: number;
  cleanedLineCount: number;
  reconstructedLineCount: number;
  candidateCount: number;
  highConfidenceParsed: number;
  acceptedCount: number;
  rejectedCount: number;
  aiDisambiguatedCount: number;
  fullTextAiFallbackUsed: boolean;
  firstTenTransactions?: Array<{
    date: string;
    description: string;
    amount: number;
    type: string;
    currency: string;
    source: string;
  }>;
};

type SpendingInsightRow = {
  clusterId: string;
  merchant: string;
  normalizedName: string;
  categoryLabel: string;
  categoryKey: string;
  kind: string;
  recommendation: string;
  amount: number;
  currency: string;
  frequency: string;
  totalSpentInPeriod: number;
  lastCharged: string;
  recurringExpenseScore: number;
  spendingInsightScore: number;
  smartSignal?: string;
  rowConfidence?: number;
  confidenceTier?: "confirmed" | "recurring_pattern" | "hidden";
};

type InsightSeverity = "positive" | "moderate" | "important" | "informational";

type FinancialInsightCard = {
  id: string;
  title: string;
  explanation: string;
  severity: InsightSeverity;
  annualImpact?: number;
};

type RecommendationSeverity = "low" | "medium" | "high";

type ActionRecommendationRow = {
  id: string;
  title: string;
  description: string;
  estimatedMonthlySavings: number;
  estimatedYearlySavings: number;
  severity: RecommendationSeverity;
  confidence: number;
  actionType: RecommendationActionType;
  merchantReference?: string;
  currency: string;
};

type StatementIntelligencePayload = {
  insights: FinancialInsightCard[];
  healthScore: {
    score: number;
    label: string;
    factors: Array<{ id: string; label: string; impact: number }>;
  };
  savings: Array<{
    id: string;
    title: string;
    explanation: string;
    monthlySavings: number;
    yearlySavings: number;
    currency: string;
    category: "confirmed" | "avoidable_fees" | "optimization";
    confidence: number;
  }>;
  financialSummary?: FinancialIntelligenceSummary;
  recommendations: {
    items: ActionRecommendationRow[];
    totalMonthlySavings: number;
    totalYearlySavings: number;
    actionableMonthlySavings?: number;
    actionableYearlySavings?: number;
    optimizationRange?: {
      monthlyLow: number;
      monthlyHigh: number;
      yearlyLow: number;
      yearlyHigh: number;
    };
    currency: string;
  };
  merchantGroups: Array<{
    groupKey: string;
    displayName: string;
    transactionCount: number;
    totalAmount: number;
    currency: string;
    recurringPatternScore: number;
  }>;
  visibleRecurring: SpendingInsightRow[];
  visibleInsights: SpendingInsightRow[];
  lowConfidenceRows: SpendingInsightRow[];
  copilot?: CopilotTimelinePayload;
};

type CopilotFeedItemPayload = {
  id: string;
  signalId: string;
  title: string;
  insight: string;
  recommendation: string;
  estimatedMonthlySavings?: number;
  estimatedYearlySavings?: number;
  currency: string;
  severity: InsightSeverity;
  tags: string[];
  priority: {
    urgency: number;
    savingsImpact: number;
    confidence: number;
    effort: number;
    overall: number;
  };
};

type CopilotTimelinePayload = {
  feed: CopilotFeedItemPayload[];
  topPriorities: CopilotFeedItemPayload[];
  behaviorTrends: CopilotFeedItemPayload[];
  yearlyOptimizationPotential: number;
  optimizationPotential?: {
    yearlyLow: number;
    yearlyHigh: number;
    confidence: number;
  };
  actionableYearlySavings?: number;
  currency: string;
  generatedAt: string;
};

type MerchantNormalizationDiagnosticRow = {
  clusterId: string;
  rawMerchant: string;
  normalizedName: string;
  rawExamples: string[];
  confidence: number;
  reason: string;
  source: "rules" | "openai";
};

type DiagnosticsMeta = {
  subscriptionCount: number;
  spendingInsightCount: number;
  recurringExpenseCount: number;
  aiAssistedSubscriptionClusterIds: string[];
  excludedFromSubscriptions: Array<{
    clusterId: string;
    merchantLabel: string;
    reasons: string[];
  }>;
  merchantNormalizations?: MerchantNormalizationDiagnosticRow[];
};

type AnalyzeOk = {
  ok: true;
  meta: {
    pageCount: number;
    transactionCount: number;
    textChars: number;
    statementPeriod: { start: string; end: string } | null;
    openAiUsed: boolean;
    openAiError: string | null;
    fallbackUsed: boolean;
    parseDebug: ParseDebugMeta | null;
  };
  summary: {
    monthlySpend: number;
    annualSpend: number;
    subscriptionCount: number;
    estimatedSavings: number;
    spendingInsightsTotal: number;
  };
  subscriptions: SubscriptionRow[];
  recurringExpenses: SpendingInsightRow[];
  spendingInsights: SpendingInsightRow[];
  /** Zelle and peer-transfer flows — excluded from all dashboard totals */
  transfers: SpendingInsightRow[];
  diagnostics: DiagnosticsMeta;
  intelligence?: StatementIntelligencePayload;
};

function formatMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.length === 3 ? currency : "USD",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function dominantCurrency(
  rows: { currency: string }[],
  fallback: string
): string {
  if (!rows.length) return fallback;
  const counts = new Map<string, number>();
  for (const s of rows) {
    const c = s.currency?.length === 3 ? s.currency : "USD";
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function dominantSubscriptionCurrency(rows: SubscriptionRow[]): string {
  return dominantCurrency(rows, "USD");
}

function merchantInitial(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  const ch = t[0];
  return /[a-zA-Z]/.test(ch) ? ch.toUpperCase() : "#";
}

const freqLabel: Record<string, string> = {
  monthly: "Monthly",
  annual: "Annual",
  weekly: "Weekly",
  unknown: "Unknown",
};

const catLabel: Record<string, string> = {
  streaming: "Streaming",
  music: "Music",
  fitness: "Gym / fitness",
  insurance: "Insurance",
  software: "Software",
  cloud_storage: "Cloud / storage",
  ai_tools: "AI tools",
  shopping: "Shopping",
  utilities: "Phone / internet / utilities",
  other: "Other recurring services",
};

const severityStyles: Record<
  InsightSeverity,
  { border: string; bg: string; text: string }
> = {
  positive: {
    border: "border-emerald-400/25",
    bg: "from-emerald-500/[0.08]",
    text: "text-emerald-100",
  },
  moderate: {
    border: "border-amber-400/25",
    bg: "from-amber-500/[0.08]",
    text: "text-amber-100",
  },
  important: {
    border: "border-red-400/25",
    bg: "from-red-500/[0.08]",
    text: "text-red-100",
  },
  informational: {
    border: "border-sky-400/20",
    bg: "from-sky-500/[0.07]",
    text: "text-sky-100",
  },
};

const healthScoreTone = (score: number): string => {
  if (score >= 85) return "text-emerald-300";
  if (score >= 70) return "text-sky-300";
  if (score >= 55) return "text-amber-300";
  return "text-red-300";
};

const recommendationSeverityStyles: Record<
  RecommendationSeverity,
  { border: string; bg: string; badge: string; text: string }
> = {
  high: {
    border: "border-red-400/25",
    bg: "from-red-500/[0.07]",
    badge: "border-red-400/30 bg-red-500/15 text-red-100",
    text: "text-red-100",
  },
  medium: {
    border: "border-amber-400/25",
    bg: "from-amber-500/[0.07]",
    badge: "border-amber-400/30 bg-amber-500/15 text-amber-100",
    text: "text-amber-100",
  },
  low: {
    border: "border-sky-400/20",
    bg: "from-sky-500/[0.06]",
    badge: "border-sky-400/25 bg-sky-500/10 text-sky-100",
    text: "text-sky-100",
  },
};

const recommendationSeverityLabel: Record<RecommendationSeverity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const insightKindLabel: Record<string, string> = {
  frequent_spending: "Frequent spending",
  one_time_expense: "One-time expense",
  possible_recurring_expense: "Possible recurring expense",
  fee: "Fee",
  income_transfer: "Income / transfer",
  needs_review: "Needs review",
};

export default function StatementsClient() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalyzeOk | null>(null);
  const [actions, setActions] = useState<
    Record<string, "cancel" | "review" | "keep" | "alt" | undefined>
  >({});

  const onFile = useCallback(async (file: File | null) => {
    if (!file) return;
    setError(null);
    setData(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/statements/analyze", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json()) as AnalyzeOk & {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not analyze the PDF.");
        return;
      }
      setData(json as AnalyzeOk);
    } catch {
      setError("Upload failed — check your network and try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  const periodLabel = useMemo(() => {
    if (!data?.meta.statementPeriod) return null;
    const { start, end } = data.meta.statementPeriod;
    return `${start} → ${end}`;
  }, [data]);

  const summaryCurrency = useMemo(() => {
    if (!data) return "USD";
    if (data.subscriptions.length > 0) {
      return dominantSubscriptionCurrency(data.subscriptions);
    }
    const pool = [
      ...(data.intelligence?.visibleInsights ?? data.spendingInsights),
      ...(data.intelligence?.visibleRecurring ?? data.recurringExpenses),
    ];
    return dominantCurrency(pool, "USD");
  }, [data]);

  const intelligence = data?.intelligence;

  const recommendationInputs = useMemo(
    () => intelligence?.recommendations?.items ?? [],
    [intelligence?.recommendations?.items]
  );

  const {
    visible: visibleRecommendations,
    acceptedSummary,
    modalRec,
    modalOpen,
    modalKind,
    dispatchAction,
    closeModal,
    acceptFromModal,
    getLastActionId,
  } = useRecommendationActions(recommendationInputs);

  const displayRecurring = useMemo(
    () => intelligence?.visibleRecurring ?? data?.recurringExpenses ?? [],
    [data, intelligence]
  );

  const displayInsights = useMemo(
    () => intelligence?.visibleInsights ?? data?.spendingInsights ?? [],
    [data, intelligence]
  );

  return (
    <main className="flex-1 bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-2 text-4xl font-bold">
          Statements & Subscriptions
        </h1>
        <p className="mb-8 max-w-2xl text-white/70">
          Upload a PDF bank statement from any institution. Text is extracted,
          reconstructed into statement lines, and scored as transaction
          candidates; AI fills in only disputed rows. Raw PDF bytes are{" "}
          <span className="text-white">not</span> forwarded to OpenAI.
        </p>

        <label className="flex cursor-pointer flex-col gap-3 rounded-2xl border border-dashed border-white/20 bg-white/[0.04] px-6 py-10 transition hover:border-emerald-400/35 hover:bg-white/[0.06]">
          <span className="text-sm font-medium text-white">
            {busy ? "Processing PDF…" : "Drag or choose a PDF"}
          </span>
          <span className="text-xs text-white/45">
            Multi-page extraction with pdf-parse · max 12&nbsp;MB
          </span>
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={busy}
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {busy ? (
          <div className="mt-6 space-y-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-4 text-sm text-emerald-100/90">
            <p className="font-medium text-emerald-200">Working…</p>
            <ul className="list-inside list-disc space-y-1 text-white/60">
              <li>Reading PDF pages</li>
              <li>Normalizing and stitching transaction lines</li>
              <li>Extracting and validating transactions</li>
              <li>Separating subscriptions from everyday spending patterns</li>
            </ul>
          </div>
        ) : null}

        {error ? (
          <div className="mt-6 space-y-2 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <p className="font-semibold text-red-100">Analysis could not complete</p>
            <p>{error}</p>
            <p className="text-xs text-red-200/70">
              If your PDF is a scanned image, try exporting a text-selectable
              statement from your bank portal.
            </p>
          </div>
        ) : null}

        {data ? (
          <div className="mt-10 space-y-12">
            <div className="space-y-2">
              <p className="text-sm font-medium uppercase tracking-widest text-emerald-400/80">
                Financial intelligence
              </p>
              <p className="max-w-3xl text-sm text-white/55">
                Subscriptions are separated from everyday spend using scoring: only
                high-confidence recurring bills and services count toward subscription
                totals. Transfers, dining, fuel, retail patterns, and fees are routed
                to the sections below.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-white/50">
              {periodLabel ? (
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                  Detected window: {periodLabel}
                </span>
              ) : null}
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                Pages: {data.meta.pageCount}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                Parsed transactions: {data.meta.transactionCount}
              </span>
              {data.meta.transactionCount === 0 ? (
                <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-amber-100">
                  No ledger rows parsed — choose a text-based PDF export
                </span>
              ) : null}
              {data.meta.parseDebug ? (
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                  Ambiguous AI assist:{" "}
                  {data.meta.parseDebug.aiDisambiguatedCount}
                  {data.meta.parseDebug.fullTextAiFallbackUsed
                    ? " · full-text rescue"
                    : ""}
                </span>
              ) : null}
              {data.meta.fallbackUsed ? (
                <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-amber-100">
                  Heuristic-only clustering (AI silent or unreachable)
                </span>
              ) : null}
              {data.meta.openAiUsed ? (
                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-emerald-100">
                  OpenAI analysis applied to clusters
                </span>
              ) : null}
              {data.meta.openAiError ? (
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/60">
                  OpenAI: {data.meta.openAiError}
                </span>
              ) : null}
            </div>

            {intelligence ? (
              <>
                <section className="grid gap-6 lg:grid-cols-[minmax(0,280px)_1fr]">
                  <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-6">
                    <p className="text-xs font-medium uppercase tracking-widest text-white/45">
                      Financial health
                    </p>
                    <p
                      className={[
                        "mt-3 text-5xl font-bold tabular-nums",
                        healthScoreTone(intelligence.healthScore.score),
                      ].join(" ")}
                    >
                      {intelligence.healthScore.score}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-white">
                      {intelligence.healthScore.label}
                    </p>
                    <ul className="mt-4 space-y-1.5 border-t border-white/10 pt-4 text-xs text-white/50">
                      {intelligence.healthScore.factors.slice(0, 5).map((f) => (
                        <li key={f.id} className="flex justify-between gap-2">
                          <span>{f.label}</span>
                          <span
                            className={
                              f.impact >= 0 ? "text-emerald-300/90" : "text-amber-300/90"
                            }
                          >
                            {f.impact >= 0 ? "+" : ""}
                            {f.impact}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <section className="space-y-4">
                    <SectionIntro
                      title="AI Financial Insights"
                      description="Pattern-based signals from your parsed statement — subscriptions, fees, dining, convenience, and spending trends."
                    />
                    {intelligence.insights.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-5 py-6 text-sm text-white/50">
                        No notable patterns crossed the insight threshold for this upload.
                      </div>
                    ) : (
                      <ul className="grid gap-3 sm:grid-cols-2">
                        {intelligence.insights.map((card) => {
                          const tone = severityStyles[card.severity];
                          return (
                            <li
                              key={card.id}
                              className={[
                                "rounded-2xl border bg-gradient-to-br to-white/[0.02] p-4",
                                tone.border,
                                tone.bg,
                              ].join(" ")}
                            >
                              <p className={["text-sm font-semibold", tone.text].join(" ")}>
                                {card.title}
                              </p>
                              <p className="mt-1.5 text-xs leading-relaxed text-white/55">
                                {card.explanation}
                              </p>
                              {card.annualImpact != null && card.annualImpact > 0 ? (
                                <p className="mt-2 text-xs text-white/40">
                                  Est. annual impact{" "}
                                  <span className="font-medium text-white/75">
                                    {formatMoney(card.annualImpact, summaryCurrency)}
                                  </span>
                                </p>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                </section>

                {intelligence.financialSummary ? (
                  <FinancialIntelligenceSummaryPanel
                    summary={intelligence.financialSummary}
                    formatMoney={formatMoney}
                  />
                ) : null}

                {intelligence.copilot && intelligence.copilot.feed.length > 0 ? (
                  <CopilotFeedSection
                    copilot={intelligence.copilot as CopilotTimelineResult}
                    formatMoney={formatMoney}
                  />
                ) : null}

                {intelligence.savings.length > 0 ? (
                  <section className="space-y-4 border-t border-white/10 pt-10">
                    <SectionIntro
                      title="Savings opportunities"
                      description="Grouped by category — optimization items show conservative ranges and are not counted as guaranteed savings."
                    />
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {intelligence.savings.map((opp) => (
                        <li
                          key={opp.id}
                          className="rounded-2xl border border-emerald-400/15 bg-gradient-to-br from-emerald-500/[0.06] to-white/[0.02] p-4"
                        >
                          <p className="text-sm font-semibold text-emerald-100">
                            {opp.title}
                          </p>
                          <p className="mt-1.5 text-xs leading-relaxed text-white/55">
                            {opp.explanation}
                          </p>
                          <p className="mt-2 text-[10px] uppercase tracking-widest text-white/35">
                            {opp.category === "confirmed"
                              ? "Confirmed savings"
                              : opp.category === "avoidable_fees"
                                ? "Avoidable fees"
                                : "Optimization"}
                          </p>
                          <p className="mt-2 text-xs text-white/45">
                            {opp.category === "optimization" ? (
                              <>
                                Range ≈{" "}
                                <span className="font-medium text-violet-200/90">
                                  {formatMoney(
                                    Math.round(opp.monthlySavings * 0.25 * 100) / 100,
                                    opp.currency
                                  )}
                                </span>
                                –{" "}
                                <span className="font-medium text-violet-200/90">
                                  {formatMoney(
                                    Math.round(opp.monthlySavings * 0.55 * 100) / 100,
                                    opp.currency
                                  )}
                                </span>
                                /mo
                              </>
                            ) : (
                              <>
                                ≈{" "}
                                <span className="font-medium text-white/80">
                                  {formatMoney(opp.monthlySavings, opp.currency)}
                                </span>
                                /mo ·{" "}
                                <span className="font-medium text-emerald-200/90">
                                  {formatMoney(opp.yearlySavings, opp.currency)}
                                </span>
                                /yr
                              </>
                            )}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {intelligence.recommendations?.items.length ? (
                  <section className="space-y-4 border-t border-white/10 pt-10">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                      <SectionIntro
                        title="Recommended actions"
                        description="Deterministic recommendations from subscriptions, fees, recurring spend, and merchant patterns — savings are conservative estimates, not quoted prices."
                      />
                      {intelligence.recommendations.totalMonthlySavings > 0 ? (
                        <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.08] px-4 py-2.5 text-sm">
                          <p className="text-xs uppercase tracking-widest text-emerald-200/70">
                            Actionable savings
                          </p>
                          <p className="mt-0.5 font-semibold tabular-nums text-emerald-100">
                            {formatMoney(
                              intelligence.recommendations.totalMonthlySavings,
                              intelligence.recommendations.currency
                            )}
                            <span className="text-xs font-normal text-white/45">
                              {" "}
                              /mo ·{" "}
                              {formatMoney(
                                intelligence.recommendations.totalYearlySavings,
                                intelligence.recommendations.currency
                              )}
                              /yr
                            </span>
                          </p>
                          {intelligence.recommendations.optimizationRange &&
                          intelligence.recommendations.optimizationRange.yearlyHigh > 0 ? (
                            <p className="mt-1 text-[10px] text-violet-200/60">
                              Optimization range (not included):{" "}
                              {formatMoney(
                                intelligence.recommendations.optimizationRange.yearlyLow,
                                intelligence.recommendations.currency
                              )}
                              –
                              {formatMoney(
                                intelligence.recommendations.optimizationRange.yearlyHigh,
                                intelligence.recommendations.currency
                              )}
                              /yr
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <SavingsAcceptedSummary
                      summary={acceptedSummary}
                      formatMoney={formatMoney}
                    />
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {visibleRecommendations.map((rec) => (
                        <RecommendationActionCard
                          key={rec.id}
                          rec={rec}
                          severityStyles={recommendationSeverityStyles}
                          severityLabel={recommendationSeverityLabel}
                          formatMoney={formatMoney}
                          lastActionId={getLastActionId(rec.id)}
                          onAction={(actionId) =>
                            dispatchAction(rec.id, actionId)
                          }
                        />
                      ))}
                    </ul>
                    <ProviderComparisonModal
                      open={modalOpen}
                      rec={modalRec}
                      modalKind={modalKind}
                      formatMoney={formatMoney}
                      onClose={closeModal}
                      onAccept={acceptFromModal}
                    />
                  </section>
                ) : null}

                {intelligence.merchantGroups.length > 0 ? (
                  <section className="space-y-3 border-t border-white/10 pt-10">
                    <SectionIntro
                      title="Grouped merchants"
                      description="Normalized merchant names — terminal codes and location suffixes collapsed."
                    />
                    <ul className="flex flex-wrap gap-2">
                      {intelligence.merchantGroups.slice(0, 12).map((g) => (
                        <li
                          key={g.groupKey}
                          className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/70"
                        >
                          <span className="font-medium text-white">{g.displayName}</span>
                          <span className="text-white/35"> · </span>
                          {g.transactionCount} txns ·{" "}
                          {formatMoney(g.totalAmount, g.currency)}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </>
            ) : null}

            <section className="grid gap-4 border-t border-white/10 pt-10 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard
                title="Estimated monthly subscriptions"
                value={formatMoney(data.summary.monthlySpend, summaryCurrency)}
                subtitle={
                  data.subscriptions.length
                    ? `True subscriptions only · ${summaryCurrency}`
                    : "No qualifying recurring bills in this statement window"
                }
              />
              <SummaryCard
                title="Estimated annual subscriptions"
                value={formatMoney(data.summary.annualSpend, summaryCurrency)}
                subtitle="Excludes transfers, dining, fuel, fees, and retail patterns"
              />
              <SummaryCard
                title="True subscriptions detected"
                value={String(data.summary.subscriptionCount)}
                subtitle={`Model confidence gate ≥ ${(SUBSCRIPTION_CONFIDENCE_MIN * 100).toFixed(0)}% · fit score ≥ ${(TRUE_SUBSCRIPTION_SCORE_MIN * 100).toFixed(0)}%`}
              />
              <SummaryCard
                title="Spending insights total"
                value={formatMoney(
                  data.summary.spendingInsightsTotal,
                  summaryCurrency
                )}
                subtitle={`${displayInsights.length} notable flows · does not include recurring everyday spend`}
              />
            </section>

            <section className="space-y-4">
              <SectionIntro
                title="Detected subscriptions"
                description="Streaming, software, insurance, phone and internet, fitness, music, cloud storage, AI tools, and similar recurring services. Each row includes a subscription fit score so only strong matches appear here."
              />
              {data.subscriptions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-5 py-8 text-center">
                  <p className="text-sm font-medium text-white/75">
                    No subscriptions matched this statement
                  </p>
                  <p className="mx-auto mt-2 max-w-lg text-sm text-white/45">
                    Items need both a healthy model confidence (≥{" "}
                    {SUBSCRIPTION_CONFIDENCE_MIN}) and a high subscription fit
                    score (≥ {TRUE_SUBSCRIPTION_SCORE_MIN}). Gas, groceries,
                    transfers, and similar spend never count toward subscription
                    totals. Try a longer PDF export if your window is very short.
                  </p>
                </div>
              ) : (
                <ul className="space-y-4">
                  {data.subscriptions.map((s) => (
                    <li key={s.clusterId}>
                      <SubscriptionCard
                        row={s}
                        action={actions[s.clusterId]}
                        onAction={(key) =>
                          setActions((prev) => ({
                            ...prev,
                            [s.clusterId]: key,
                          }))
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-4">
              <SectionIntro
                title="Recurring expenses"
                description="Repeated merchants that are not classified as subscription bills: fuel, groceries, dining, convenience runs, retail, fee patterns, and recurring transfers. These never flow into subscription totals."
              />
              {displayRecurring.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-violet-400/20 bg-violet-500/[0.03] px-5 py-8 text-center">
                  <p className="text-sm text-white/60">
                    No recurring non-subscription patterns crossed the reporting
                    threshold for this upload.
                  </p>
                </div>
              ) : (
                <ul className="space-y-4">
                  {displayRecurring.map((row) => (
                    <li key={row.clusterId}>
                      <RecurringExpenseCard row={row} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-4">
              <SectionIntro
                title="Spending insights"
                description="One-time debits, large transfers, bank fees, unusual activity, and merchants flagged for review or possible savings—aggregated separately from subscriptions and recurring everyday spend."
              />
              {displayInsights.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-sky-400/20 bg-sky-500/[0.03] px-5 py-8 text-center">
                  <p className="text-sm text-white/60">
                    No additional insight rows were promoted after routing recurring
                    patterns elsewhere.
                  </p>
                </div>
              ) : (
                <ul className="space-y-4">
                  {displayInsights.map((row) => (
                    <li key={row.clusterId}>
                      <SpendingInsightCard row={row} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {data.transfers.length > 0 ? (
              <details className="rounded-2xl border border-amber-400/15 bg-amber-500/[0.04]">
                <summary className="cursor-pointer select-none px-5 py-4 text-sm font-semibold text-amber-100/90">
                  Transfers ({data.transfers.length}){" "}
                  <span className="font-normal text-white/40">
                    — Zelle and peer payments · excluded from all totals
                  </span>
                </summary>
                <div className="space-y-3 px-5 pb-5">
                  <p className="text-xs text-white/45">
                    These transactions are classified as transfers and are not
                    counted toward subscription totals, recurring expenses, or
                    spending insights.
                  </p>
                  <ul className="space-y-3">
                    {data.transfers.map((row) => (
                      <li key={row.clusterId}>
                        <TransferCard row={row} />
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ) : null}

            <details className="group rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-white/55">
              <summary className="cursor-pointer select-none text-sm font-medium text-white/80">
                Diagnostics & parsed ledger
              </summary>
              <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
                {intelligence && intelligence.lowConfidenceRows.length > 0 ? (
                  <details className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs">
                    <summary className="cursor-pointer text-white/70">
                      Low-confidence spend rows ({intelligence.lowConfidenceRows.length})
                    </summary>
                    <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                      {intelligence.lowConfidenceRows.map((r) => (
                        <li
                          key={r.clusterId}
                          className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-[11px] text-white/60"
                        >
                          {r.normalizedName} · score{" "}
                          {((r.rowConfidence ?? 0) * 100).toFixed(0)}% ·{" "}
                          {formatMoney(r.totalSpentInPeriod, r.currency)}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {data.meta.parseDebug?.firstTenTransactions?.length ? (
                  <details className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs">
                    <summary className="cursor-pointer text-white/70">
                      Parsed transactions (sample)
                    </summary>
                    <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto font-mono text-[11px] text-white/60">
                      {data.meta.parseDebug.firstTenTransactions.map((t, i) => (
                        <li key={i}>
                          {t.date} · {t.description.slice(0, 72)}
                          {t.description.length > 72 ? "…" : ""} · {t.amount} ·{" "}
                          {t.type}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {data.meta.parseDebug ? (
                  <details className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs">
                    <summary className="cursor-pointer text-white/70">
                      Transaction extractor metrics
                    </summary>
                    <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div>
                        <dt className="text-white/40">Extracted characters</dt>
                        <dd className="text-white/70">{data.meta.parseDebug.totalExtractedChars}</dd>
                      </div>
                      <div>
                        <dt className="text-white/40">Physical vs reconstructed lines</dt>
                        <dd className="text-white/70">
                          {data.meta.parseDebug.cleanedLineCount} /{" "}
                          {data.meta.parseDebug.reconstructedLineCount}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-white/40">High-confidence parses</dt>
                        <dd className="text-white/70">{data.meta.parseDebug.highConfidenceParsed}</dd>
                      </div>
                      <div>
                        <dt className="text-white/40">Accepted / rejected</dt>
                        <dd className="text-white/70">
                          {data.meta.parseDebug.acceptedCount} /{" "}
                          {data.meta.parseDebug.rejectedCount}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-white/40">AI-disambiguated rows</dt>
                        <dd className="text-white/70">
                          {data.meta.parseDebug.aiDisambiguatedCount}
                          {data.meta.parseDebug.fullTextAiFallbackUsed
                            ? " · full-text fallback"
                            : ""}
                        </dd>
                      </div>
                    </dl>
                  </details>
                ) : null}

                <details className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs">
                  <summary className="cursor-pointer text-white/70">
                    Merchant normalization (
                    {data.diagnostics.merchantNormalizations?.length ?? 0})
                  </summary>
                  {data.diagnostics.merchantNormalizations?.length ? (
                    <ul className="mt-2 max-h-52 space-y-2 overflow-y-auto">
                      {data.diagnostics.merchantNormalizations
                        .slice(0, 48)
                        .map((row) => (
                          <li
                            key={row.clusterId}
                            className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-[11px]"
                          >
                            <span className="text-white/75">{row.normalizedName}</span>
                            <span className="text-white/35"> · </span>
                            <span className="text-white/50">
                              {(row.confidence * 100).toFixed(0)}% · {row.source}
                            </span>
                            <p className="mt-1 text-white/45">{row.reason}</p>
                            <p className="mt-0.5 font-mono text-[10px] text-white/35">
                              raw: {row.rawMerchant}
                            </p>
                            {row.rawExamples.length > 1 ? (
                              <p className="mt-0.5 text-[10px] text-white/30">
                                variants: {row.rawExamples.slice(1, 4).join(" · ")}
                              </p>
                            ) : null}
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-white/45">
                      No merchant clusters were normalized for this run.
                    </p>
                  )}
                </details>

                <details className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs">
                  <summary className="cursor-pointer text-white/70">
                    AI-assisted subscription clusters (
                    {data.diagnostics.aiAssistedSubscriptionClusterIds.length})
                  </summary>
                  {data.diagnostics.aiAssistedSubscriptionClusterIds.length ? (
                    <ul className="mt-2 max-h-40 overflow-y-auto text-white/60">
                      {data.diagnostics.aiAssistedSubscriptionClusterIds.map((id) => (
                        <li key={id} className="font-mono text-[11px]">
                          {id}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-white/45">
                      No subscription rows were attributed to OpenAI for this run
                      (heuristic-only or API unavailable).
                    </p>
                  )}
                </details>

                <details className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs">
                  <summary className="cursor-pointer text-white/70">
                    Detected subscriptions ({data.subscriptions.length})
                  </summary>
                  <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                    {data.subscriptions.map((s) => (
                      <li
                        key={s.clusterId}
                        className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-[11px]"
                      >
                        <span className="text-white/75">{s.normalizedName}</span>
                        <span className="text-white/35"> · </span>
                        <span className="text-white/50">{s.clusterId}</span>
                        <span className="text-white/35"> · </span>
                        <span className="text-emerald-200/90">
                          fit {(s.trueSubscriptionScore * 100).toFixed(0)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>

                <details className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs">
                  <summary className="cursor-pointer text-white/70">
                    Recurring expenses ({data.recurringExpenses.length})
                  </summary>
                  <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                    {data.recurringExpenses.map((r) => (
                      <li
                        key={r.clusterId}
                        className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-[11px] text-white/60"
                      >
                        {r.normalizedName} · score{" "}
                        {(r.recurringExpenseScore * 100).toFixed(0)}% ·{" "}
                        {r.categoryLabel}
                      </li>
                    ))}
                  </ul>
                </details>

                <details className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs">
                  <summary className="cursor-pointer text-white/70">
                    Spending insights ({data.spendingInsights.length})
                  </summary>
                  <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                    {data.spendingInsights.map((r) => (
                      <li
                        key={r.clusterId}
                        className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-[11px] text-white/60"
                      >
                        {r.normalizedName} · insight score{" "}
                        {(r.spendingInsightScore * 100).toFixed(0)}% ·{" "}
                        {r.categoryLabel}
                      </li>
                    ))}
                  </ul>
                </details>

                <details className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs">
                  <summary className="cursor-pointer text-white/70">
                    Subscription gate exclusions (
                    {data.diagnostics.excludedFromSubscriptions.length})
                  </summary>
                  {data.diagnostics.excludedFromSubscriptions.length ? (
                    <ul className="mt-2 max-h-52 space-y-2 overflow-y-auto">
                      {data.diagnostics.excludedFromSubscriptions
                        .slice(0, 40)
                        .map((row) => (
                          <li
                            key={row.clusterId}
                            className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-[11px]"
                          >
                            <span className="font-medium text-white/75">
                              {row.merchantLabel}
                            </span>
                            <span className="text-white/35"> · </span>
                            <span className="text-white/50">
                              {row.reasons.join(" · ")}
                            </span>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-white/45">
                      No merged candidates were blocked at the subscription gates.
                    </p>
                  )}
                  {data.diagnostics.excludedFromSubscriptions.length > 40 ? (
                    <p className="mt-2 text-white/35">
                      Showing first 40 of{" "}
                      {data.diagnostics.excludedFromSubscriptions.length}.
                    </p>
                  ) : null}
                </details>

                <dl className="grid gap-2 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-white/40">subscriptionCount</dt>
                    <dd className="text-white/75">{data.diagnostics.subscriptionCount}</dd>
                  </div>
                  <div>
                    <dt className="text-white/40">spendingInsightCount</dt>
                    <dd className="text-white/75">{data.diagnostics.spendingInsightCount}</dd>
                  </div>
                  <div>
                    <dt className="text-white/40">recurringExpenseCount</dt>
                    <dd className="text-white/75">{data.diagnostics.recurringExpenseCount}</dd>
                  </div>
                </dl>
              </div>
            </details>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function SectionIntro(props: { title: string; description: string }) {
  return (
    <div className="space-y-2 border-b border-white/10 pb-3">
      <h2 className="text-xl font-semibold tracking-tight text-white">
        {props.title}
      </h2>
      <p className="max-w-3xl text-sm leading-relaxed text-white/50">
        {props.description}
      </p>
    </div>
  );
}

function SummaryCard(props: {
  title: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
        {props.title}
      </p>
      <p className="mt-2 text-2xl font-semibold text-white">{props.value}</p>
      {props.subtitle ? (
        <p className="mt-1 text-xs text-white/45">{props.subtitle}</p>
      ) : null}
    </div>
  );
}

function SpendingInsightCard(props: { row: SpendingInsightRow }) {
  const { row: r } = props;
  const kind =
    insightKindLabel[r.kind] ?? r.kind.replaceAll("_", " ");

  return (
    <div className="rounded-2xl border border-sky-400/15 bg-gradient-to-br from-sky-400/[0.07] to-white/[0.02] p-5">
      <div className="flex flex-wrap gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-black/40 text-lg font-bold text-sky-200">
          {merchantInitial(r.normalizedName)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-white">
            {r.normalizedName}
          </h3>
          {r.normalizedName.trim().toUpperCase() !==
          r.merchant.trim().toUpperCase() ? (
            <p className="text-xs text-white/40">Descriptor: {r.merchant}</p>
          ) : null}
          <p className="mt-1 text-xs text-white/45">
            Category ·{" "}
            <span className="text-white/70">{r.categoryLabel}</span>
            {" · "}
            <span className="text-white/55">{kind}</span>
          </p>
          <p className="mt-1 text-xs text-white/45">
            Latest charge {r.lastCharged}
            {" · "}
            Frequency {freqLabel[r.frequency] ?? r.frequency}
            {" · "}
            Insight score{" "}
            <span className="text-sky-200/90">
              {(r.spendingInsightScore * 100).toFixed(0)}%
            </span>
          </p>
          <p className="mt-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs text-sky-100/95">
            <span className="font-semibold text-sky-200/95">Signal:</span>{" "}
            {r.smartSignal ?? r.recommendation}
          </p>
          {r.confidenceTier === "confirmed" ? (
            <span className="mt-2 inline-block rounded-full border border-emerald-400/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-100">
              Confirmed
            </span>
          ) : r.confidenceTier === "recurring_pattern" ? (
            <span className="mt-2 inline-block rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100">
              Recurring pattern
            </span>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-white">
            {formatMoney(r.amount, r.currency)}
          </p>
          <p className="text-xs text-white/45">Latest debit</p>
          <p className="mt-2 text-xs font-medium text-white/65">
            Period total{" "}
            <span className="text-white">
              {formatMoney(r.totalSpentInPeriod, r.currency)}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

function RecurringExpenseCard(props: { row: SpendingInsightRow }) {
  const { row: r } = props;
  const kind =
    insightKindLabel[r.kind] ?? r.kind.replaceAll("_", " ");

  return (
    <div className="rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/[0.08] to-white/[0.02] p-5">
      <div className="flex flex-wrap gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-black/40 text-lg font-bold text-violet-200">
          {merchantInitial(r.normalizedName)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-white">
            {r.normalizedName}
          </h3>
          <p className="mt-1 text-xs text-white/45">
            <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-100/95">
              {r.categoryLabel}
            </span>
            <span className="mx-2 text-white/30">·</span>
            <span className="text-white/55">{kind}</span>
          </p>
          <p className="mt-1 text-xs text-white/45">
            Latest {r.lastCharged} · {freqLabel[r.frequency] ?? r.frequency}{" "}
            · Recurring pattern score{" "}
            <span className="text-violet-200/90">
              {(r.recurringExpenseScore * 100).toFixed(0)}%
            </span>
          </p>
          <p className="mt-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs text-violet-100/95">
            <span className="font-semibold text-violet-200/95">Signal:</span>{" "}
            {r.smartSignal ?? r.recommendation}
          </p>
          {r.confidenceTier === "confirmed" ? (
            <span className="mt-2 inline-block rounded-full border border-emerald-400/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-100">
              Confirmed
            </span>
          ) : r.confidenceTier === "recurring_pattern" ? (
            <span className="mt-2 inline-block rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100">
              Recurring pattern
            </span>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-white">
            {formatMoney(r.amount, r.currency)}
          </p>
          <p className="text-xs text-white/45">Latest debit</p>
          <p className="mt-2 text-xs font-medium text-white/65">
            Period total{" "}
            <span className="text-white">
              {formatMoney(r.totalSpentInPeriod, r.currency)}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

function SubscriptionCard(props: {
  row: SubscriptionRow;
  action?: "cancel" | "review" | "keep" | "alt";
  onAction: (key: "cancel" | "review" | "keep" | "alt") => void;
}) {
  const { row: s, action, onAction } = props;
  const badges: Array<{ key: string; label: string; tone: string }> = [];
  if (s.flags.confirmed)
    badges.push({
      key: "ok",
      label: "CONFIRMED",
      tone: "border-emerald-400/50 bg-emerald-500/15 text-emerald-100",
    });
  if (s.flags.reviewSuggested)
    badges.push({
      key: "rv",
      label: "REVIEW",
      tone: "border-sky-400/45 bg-sky-500/15 text-sky-100",
    });
  if (s.flags.priceIncreased)
    badges.push({
      key: "p",
      label: "PRICE INCREASE",
      tone: "border-amber-400/40 bg-amber-500/15 text-amber-100",
    });
  if (s.flags.duplicate)
    badges.push({
      key: "d",
      label: "DUPLICATE",
      tone: "border-amber-400/40 bg-amber-500/15 text-amber-100",
    });
  if (s.flags.forgotten)
    badges.push({
      key: "f",
      label: "FORGOTTEN",
      tone: "border-orange-400/40 bg-orange-500/15 text-orange-100",
    });
  if (s.flags.trialConverted)
    badges.push({
      key: "t",
      label: "TRIAL → PAYING",
      tone: "border-fuchsia-400/35 bg-fuchsia-500/15 text-fuchsia-100",
    });
  if (s.flags.suspicious)
    badges.push({
      key: "s",
      label: "SUSPICIOUS",
      tone: "border-red-400/40 bg-red-500/15 text-red-100",
    });

  const compareHref = `/compare?subscriptionMerchant=${encodeURIComponent(s.normalizedName)}`;

  return (
    <div className="rounded-2xl border border-emerald-400/15 bg-gradient-to-br from-emerald-500/[0.06] to-white/[0.02] p-5">
      <div className="flex flex-wrap gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-black/40 text-lg font-bold text-emerald-200">
          {merchantInitial(s.normalizedName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="truncate text-base font-semibold text-white">
              {s.normalizedName}
            </h3>
          </div>
          {s.normalizedName.trim().toUpperCase() !==
          s.merchant.trim().toUpperCase() ? (
            <p className="mt-0.5 text-xs text-white/40">
              Statement text: {s.merchant}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-white/45">
            <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/80">
              {catLabel[s.category] ?? s.category}
            </span>
            <span className="mx-2 text-white/30">·</span>
            Confidence {(s.confidence * 100).toFixed(0)}%
            <span className="text-white/30"> · </span>
            Subscription fit {(s.trueSubscriptionScore * 100).toFixed(0)}%
          </p>
          <p className="mt-1 text-xs text-white/45">
            Latest charge {s.lastCharged}
            {s.daysSinceLastCharge != null
              ? ` · ${s.daysSinceLastCharge} day(s) ago`
              : ""}
            {" · "}
            Period debits sum:{" "}
            {formatMoney(s.totalSpentInPeriod, s.currency)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {badges.map((b) => (
              <span
                key={b.key}
                className={[
                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  b.tone,
                ].join(" ")}
              >
                {b.label.trim()}
              </span>
            ))}
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-white">
            {formatMoney(s.amount, s.currency)}
          </p>
          <p className="text-xs text-white/45">
            {freqLabel[s.frequency] ?? s.frequency}
          </p>
          <p className="text-xs text-emerald-200/90">
            ≈ {formatMoney(s.monthlyEquivalent, s.currency)}/mo ·{" "}
            {formatMoney(s.annualEquivalent, s.currency)}/yr
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 border-t border-white/10 pt-4">
        <ActionChip
          label="Cancel"
          pressed={action === "cancel"}
          onClick={() => onAction("cancel")}
        />
        <ActionChip
          label="Review"
          pressed={action === "review"}
          onClick={() => onAction("review")}
        />
        <ActionChip
          label="Keep"
          pressed={action === "keep"}
          onClick={() => onAction("keep")}
        />
        <Link
          href={compareHref}
          className={[
            "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
            action === "alt"
              ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-100"
              : "border-white/15 bg-white/5 text-white/80 hover:border-white/25",
          ].join(" ")}
          onClick={() => onAction("alt")}
        >
          Find alternative
        </Link>
      </div>
    </div>
  );
}

function TransferCard(props: { row: SpendingInsightRow }) {
  const { row: r } = props;
  return (
    <div className="rounded-xl border border-amber-400/15 bg-black/25 px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-sm font-bold text-amber-200">
          {merchantInitial(r.normalizedName)}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold text-white">
            {r.normalizedName}
          </h4>
          {r.normalizedName.trim().toUpperCase() !==
          r.merchant.trim().toUpperCase() ? (
            <p className="text-xs text-white/35">Descriptor: {r.merchant}</p>
          ) : null}
          <p className="mt-0.5 text-xs text-white/45">
            Last seen {r.lastCharged}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-white">
            {formatMoney(r.amount, r.currency)}
          </p>
          <p className="text-xs text-white/40">Latest debit</p>
          <p className="mt-1 text-xs text-white/55">
            Period total{" "}
            <span className="text-white/80">
              {formatMoney(r.totalSpentInPeriod, r.currency)}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

function ActionChip(props: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={[
        "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
        props.pressed
          ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-100"
          : "border-white/15 bg-white/5 text-white/80 hover:border-white/25",
      ].join(" ")}
    >
      {props.label}
    </button>
  );
}

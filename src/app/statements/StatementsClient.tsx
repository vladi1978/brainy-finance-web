"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";

import { CopilotFeedSection } from "@/components/statements/copilot/CopilotFeedSection";
import { GuidedStatementStart } from "@/components/statements/GuidedStatementStart";
import { FinancialIntelligenceSummaryPanel } from "@/components/statements/FinancialIntelligenceSummary";
import type { FinancialIntelligenceSummary } from "@/lib/statements/intelligence/financialCategories";
import type { CopilotAssistantContext } from "@/lib/statements/copilot/types";
import type { CopilotTimelineResult } from "@/lib/statements/timeline/types";
import { ProviderComparisonModal } from "@/components/statements/actions/ProviderComparisonModal";
import { RecommendationActionCard } from "@/components/statements/actions/RecommendationActionCard";
import { SavingsAcceptedSummary } from "@/components/statements/actions/SavingsAcceptedSummary";
import { useRecommendationActions } from "@/components/statements/actions/useRecommendationActions";
import { findRecommendationReviewTarget } from "@/lib/statements/actions/recommendationNavigation";
import { SUBSCRIPTION_CONFIDENCE_MIN, TRUE_SUBSCRIPTION_SCORE_MIN } from "@/lib/statements/heuristics";
import type { RecommendationActionType } from "@/lib/statements/recommendations/types";
import {
  buildActivityPresentationGroups,
  PRESENTATION_GROUP_COPY,
  type ActivityPresentationCard,
} from "@/lib/statements/intelligence/presentationGroups";

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
  observedPeriodAmount?: number;
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
    observedPeriodAmount?: number;
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
  presentationGroups?: {
    expectedRecurringBills: ActivityPresentationCardPayload[];
    subscriptions: ActivityPresentationCardPayload[];
    repeatedDiscretionary: ActivityPresentationCardPayload[];
    unusualRecurring: ActivityPresentationCardPayload[];
    oneTimeReview?: ActivityPresentationCardPayload[];
  };
  copilot?: CopilotTimelinePayload;
  copilotAssistant?: CopilotAssistantContext;
};

type ActivityPresentationCardPayload = {
  id: string;
  clusterId: string;
  groupId: string;
  status: "confirmed" | "possible" | "expected" | "unusual";
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
  summaryLine: string;
  showMonthlyEstimate: boolean;
  monthlyEstimate: number | null;
  source: "subscription" | "spending";
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
    possibleSubscriptionCount?: number;
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
  const [documentConsent, setDocumentConsent] = useState(false);
  const [highlightedClusterId, setHighlightedClusterId] = useState<string | null>(null);
  const activityCardRefs = useRef(new Map<string, HTMLDivElement>());
  const [actions, setActions] = useState<
    Record<
      string,
      "review" | "expected" | "not_mine" | "keep" | "alt" | "cancel" | undefined
    >
  >({});

  const recommendationInputs = useMemo(
    () => data?.intelligence?.recommendations?.items ?? [],
    [data?.intelligence?.recommendations?.items]
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
    resetActions: resetRecommendationActions,
    getLastActionId,
  } = useRecommendationActions(recommendationInputs);

  const onFile = useCallback(async (file: File | null) => {
    if (!file) return;
    if (!documentConsent) {
      setError(
        "Confirm document ownership and analysis permission before uploading."
      );
      return;
    }
    resetRecommendationActions();
    setActions({});
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
      // Each completed analysis ends the consent grant; a new PDF requires re-check.
      setDocumentConsent(false);
      setActions({});
    } catch {
      setError("Upload failed — check your network and try again.");
    } finally {
      setBusy(false);
    }
  }, [documentConsent, resetRecommendationActions]);

  const periodLabel = useMemo(() => {
    if (!data?.meta.statementPeriod) return null;
    const { start, end } = data.meta.statementPeriod;
    if (!start || !end) return null;
    // Always render ascending min → max; omit if either side is unusable.
    if (start <= end) return `${start} → ${end}`;
    return `${end} → ${start}`;
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

  const displayRecurring = useMemo(
    () => intelligence?.visibleRecurring ?? data?.recurringExpenses ?? [],
    [data, intelligence]
  );

  const displayInsights = useMemo(
    () => intelligence?.visibleInsights ?? data?.spendingInsights ?? [],
    [data, intelligence]
  );

  const presentationGroups = useMemo(() => {
    if (!data) return null;
    if (intelligence?.presentationGroups) {
      return intelligence.presentationGroups;
    }
    return buildActivityPresentationGroups({
      subscriptions: data.subscriptions as unknown as Parameters<
        typeof buildActivityPresentationGroups
      >[0]["subscriptions"],
      visibleRecurring: displayRecurring as unknown as Parameters<
        typeof buildActivityPresentationGroups
      >[0]["visibleRecurring"],
      visibleInsights: displayInsights as unknown as Parameters<
        typeof buildActivityPresentationGroups
      >[0]["visibleInsights"],
      clusters: [],
    });
  }, [data, intelligence, displayRecurring, displayInsights]);

  const openRecommendationReview = useCallback(
    (merchantReference?: string) => {
      const target = findRecommendationReviewTarget(
        merchantReference,
        presentationGroups?.subscriptions ?? []
      );
      if (!target) return false;

      const element = activityCardRefs.current.get(target.clusterId);
      if (!element) return false;

      setHighlightedClusterId(target.clusterId);
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.focus({ preventScroll: true });
      window.setTimeout(() => {
        setHighlightedClusterId((current) =>
          current === target.clusterId ? null : current
        );
      }, 2200);
      return true;
    },
    [presentationGroups]
  );

  return (
    <main className="flex-1 bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-2 text-4xl font-bold">
          Statements & Subscriptions
        </h1>
        <p className="mb-8 max-w-2xl text-white/70">
          Upload a <span className="text-white">text-selectable PDF</span> bank
          statement. Text is extracted, reconstructed into statement lines, and
          scored as transaction candidates; AI fills in only disputed rows. Excel
          and CSV are not supported. Raw PDF bytes are{" "}
          <span className="text-white">not</span> forwarded to OpenAI. This is
          not banking, accounting, or financial advice. See{" "}
          <a href="/terms" className="text-emerald-300 underline">
            Terms
          </a>{" "}
          and{" "}
          <a href="/privacy" className="text-emerald-300 underline">
            Privacy
          </a>
          .
        </p>

        <GuidedStatementStart />

        <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-xl border border-white/15 bg-white/[0.03] px-4 py-3 text-sm text-white/80">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 rounded border-white/30 bg-black"
            checked={documentConsent}
            disabled={busy}
            onChange={(e) => setDocumentConsent(e.target.checked)}
          />
          <span>
            I confirm that I own this document or have permission to analyze it.
            I authorize Brainy to process it to identify spending patterns,
            subscriptions, fees, and expected bills for this session. Consent is
            recorded only in this browser session until accounts exist — it is
            not a stored legal signature.
          </span>
        </label>

        <label
          className={[
            "flex flex-col gap-3 rounded-2xl border border-dashed px-6 py-10 transition",
            documentConsent && !busy
              ? "cursor-pointer border-white/20 bg-white/[0.04] hover:border-emerald-400/35 hover:bg-white/[0.06]"
              : "cursor-not-allowed border-white/10 bg-white/[0.02] opacity-60",
          ].join(" ")}
        >
          <span className="text-sm font-medium text-white">
            {busy
              ? "Processing PDF…"
              : documentConsent
                ? "Drag or choose a PDF"
                : "Accept document consent to enable upload"}
          </span>
          <span className="text-xs text-white/45">
            Multi-page extraction with pdf-parse · max 12&nbsp;MB
          </span>
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={busy || !documentConsent}
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
                              ) : /Annual estimate unavailable/i.test(
                                  card.explanation
                                ) ? (
                                <p className="mt-2 text-xs text-white/35">
                                  Annual estimate unavailable
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
                    assistant={intelligence.copilotAssistant}
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
                            {opp.category === "optimization" &&
                            opp.monthlySavings > 0 ? (
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
                            ) : opp.monthlySavings > 0 ? (
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
                            ) : (opp.observedPeriodAmount ?? 0) > 0 ? (
                              <>
                                <span className="font-medium text-white/80">
                                  {formatMoney(
                                    opp.observedPeriodAmount!,
                                    opp.currency
                                  )}
                                </span>{" "}
                                observed in this statement · Annual estimate
                                unavailable
                              </>
                            ) : (
                              <>Annual estimate unavailable</>
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
                          ) : (
                            <p className="mt-1 text-[10px] text-white/40">
                              No annual estimate available
                            </p>
                          )}
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
                          onAction={(actionId) => {
                            if (
                              rec.actionType === "review_subscription" &&
                              actionId === "review_merchant" &&
                              openRecommendationReview(rec.merchantReference)
                            ) {
                              return;
                            }
                            dispatchAction(rec.id, actionId);
                          }}
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
                  data.summary.subscriptionCount > 0
                    ? `Confirmed cadence only · ${summaryCurrency}`
                    : (data.summary.possibleSubscriptionCount ?? 0) > 0
                      ? `${data.summary.possibleSubscriptionCount} possible · recurrence not confirmed`
                      : "No qualifying recurring bills in this statement window"
                }
              />
              <SummaryCard
                title="Estimated annual subscriptions"
                value={
                  data.summary.annualSpend > 0
                    ? formatMoney(data.summary.annualSpend, summaryCurrency)
                    : "—"
                }
                subtitle={
                  data.summary.annualSpend > 0
                    ? "Evidence-backed confirmed subscriptions only"
                    : "Annual estimate unavailable"
                }
              />
              <SummaryCard
                title="True subscriptions detected"
                value={String(data.summary.subscriptionCount)}
                subtitle={
                  (data.summary.possibleSubscriptionCount ?? 0) > 0
                    ? `Confirmed only · ${data.summary.possibleSubscriptionCount} possible separately`
                    : `Confirmed cadence · confidence ≥ ${(SUBSCRIPTION_CONFIDENCE_MIN * 100).toFixed(0)}%`
                }
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
                title={PRESENTATION_GROUP_COPY.expected_recurring_bills.title}
                description={
                  PRESENTATION_GROUP_COPY.expected_recurring_bills.description
                }
              />
              {(presentationGroups?.expectedRecurringBills.length ?? 0) === 0 ? (
                <EmptyGroup note="No expected utility, phone, internet, or insurance-style bills were separated for this upload." />
              ) : (
                <ul className="space-y-4">
                  {presentationGroups!.expectedRecurringBills.map((card) => (
                    <li key={card.id}>
                      <ActivityPresentationCardView
                        card={card}
                        action={actions[card.clusterId]}
                        onAction={(key) =>
                          setActions((prev) => ({
                            ...prev,
                            [card.clusterId]: key,
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
                title={PRESENTATION_GROUP_COPY.subscriptions.title}
                description={PRESENTATION_GROUP_COPY.subscriptions.description}
              />
              {(presentationGroups?.subscriptions.length ?? 0) === 0 ? (
                <EmptyGroup note="No streaming, software, or membership-style subscriptions matched this statement." />
              ) : (
                <ul className="space-y-4">
                  {presentationGroups!.subscriptions.map((card) => (
                    <li key={card.id}>
                      <ActivityPresentationCardView
                        card={card}
                        highlighted={highlightedClusterId === card.clusterId}
                        cardRef={(element) => {
                          if (element) {
                            activityCardRefs.current.set(card.clusterId, element);
                          } else {
                            activityCardRefs.current.delete(card.clusterId);
                          }
                        }}
                        action={actions[card.clusterId]}
                        onAction={(key) =>
                          setActions((prev) => ({
                            ...prev,
                            [card.clusterId]: key,
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
                title={PRESENTATION_GROUP_COPY.repeated_discretionary.title}
                description={
                  PRESENTATION_GROUP_COPY.repeated_discretionary.description
                }
              />
              {(presentationGroups?.repeatedDiscretionary.length ?? 0) === 0 ? (
                <EmptyGroup note="No repeated rideshare, dining, or convenience patterns crossed the reporting threshold." />
              ) : (
                <ul className="space-y-4">
                  {presentationGroups!.repeatedDiscretionary.map((card) => (
                    <li key={card.id}>
                      <ActivityPresentationCardView
                        card={card}
                        action={actions[card.clusterId]}
                        onAction={(key) =>
                          setActions((prev) => ({
                            ...prev,
                            [card.clusterId]: key,
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
                title={PRESENTATION_GROUP_COPY.unusual_recurring.title}
                description={PRESENTATION_GROUP_COPY.unusual_recurring.description}
              />
              {(presentationGroups?.unusualRecurring.length ?? 0) === 0 ? (
                <EmptyGroup note="No unusual recurring activity was flagged for review in this window." />
              ) : (
                <ul className="space-y-4">
                  {presentationGroups!.unusualRecurring.map((card) => (
                    <li key={card.id}>
                      <ActivityPresentationCardView
                        card={card}
                        action={actions[card.clusterId]}
                        onAction={(key) =>
                          setActions((prev) => ({
                            ...prev,
                            [card.clusterId]: key,
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
                title={PRESENTATION_GROUP_COPY.one_time_review.title}
                description={PRESENTATION_GROUP_COPY.one_time_review.description}
              />
              {(presentationGroups?.oneTimeReview?.length ?? 0) === 0 ? (
                <EmptyGroup note="No one-time review items were separated for this upload." />
              ) : (
                <ul className="space-y-4">
                  {presentationGroups!.oneTimeReview!.map((card) => (
                    <li key={card.id}>
                      <ActivityPresentationCardView
                        card={card}
                        action={actions[card.clusterId]}
                        onAction={(key) =>
                          setActions((prev) => ({
                            ...prev,
                            [card.clusterId]: key,
                          }))
                        }
                      />
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


function EmptyGroup(props: { note: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-5 py-8 text-center">
      <p className="text-sm text-white/60">{props.note}</p>
    </div>
  );
}

function statusBadge(status: ActivityPresentationCardPayload["status"]) {
  switch (status) {
    case "confirmed":
      return {
        label: "Confirmed",
        className:
          "border-emerald-400/35 bg-emerald-500/10 text-emerald-100",
      };
    case "possible":
      return {
        label: "Possible",
        className: "border-amber-400/30 bg-amber-500/10 text-amber-100",
      };
    case "expected":
      return {
        label: "Expected",
        className: "border-sky-400/30 bg-sky-500/10 text-sky-100",
      };
    case "unusual":
      return {
        label: "Review",
        className: "border-orange-400/35 bg-orange-500/10 text-orange-100",
      };
  }
}

function ActivityPresentationCardView(props: {
  card: ActivityPresentationCardPayload | ActivityPresentationCard;
  highlighted?: boolean;
  cardRef?: (element: HTMLDivElement | null) => void;
  action?: "review" | "expected" | "not_mine" | "keep" | "alt" | "cancel";
  onAction: (
    key: "review" | "expected" | "not_mine" | "keep" | "alt"
  ) => void;
}) {
  const { card, action, onAction, highlighted = false, cardRef } = props;
  const badge = statusBadge(card.status);
  const compareHref = `/compare?subscriptionMerchant=${encodeURIComponent(card.normalizedName)}`;
  const showExpectedAction = card.groupId === "expected_recurring_bills";
  const showNotMine =
    card.groupId === "subscriptions" || card.groupId === "unusual_recurring";

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      className={[
        "rounded-2xl border bg-gradient-to-br from-white/[0.04] to-white/[0.01] p-5 outline-none transition duration-300",
        highlighted
          ? "border-violet-300/70 ring-2 ring-violet-400/35"
          : "border-white/10",
      ].join(" ")}
    >
      <div className="flex flex-wrap gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-black/40 text-lg font-bold text-white/80">
          {merchantInitial(card.normalizedName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-white">
              {card.normalizedName}
            </h3>
            <span
              className={[
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                badge.className,
              ].join(" ")}
            >
              {badge.label}
            </span>
          </div>
          {card.normalizedName.trim().toUpperCase() !==
          card.merchant.trim().toUpperCase() ? (
            <p className="mt-0.5 text-xs text-white/40">
              Statement text: {card.merchant}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-white/45">
            <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/80">
              {catLabel[card.categoryLabel] ?? card.categoryLabel}
            </span>
            {card.confidence != null ? (
              <>
                <span className="mx-2 text-white/30">·</span>
                Confidence {(card.confidence * 100).toFixed(0)}%
              </>
            ) : null}
            {card.estimatedCadence ? (
              <>
                <span className="mx-2 text-white/30">·</span>
                {card.estimatedCadence}
              </>
            ) : null}
          </p>
          <p className="mt-2 text-sm text-white/80">{card.summaryLine}</p>
          <p className="mt-1 text-xs text-white/50">
            {card.chargeCount} charge{card.chargeCount === 1 ? "" : "s"}
            {" · "}
            Period total {formatMoney(card.periodTotal, card.currency)}
            {" · "}
            Avg {formatMoney(card.averageCharge, card.currency)}
            {" · "}
            Latest {formatMoney(card.latestCharge, card.currency)}
            {card.dateRange
              ? ` · ${card.dateRange.start} → ${card.dateRange.end}`
              : ""}
          </p>
          <p className="mt-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs text-white/80">
            {card.reason}
          </p>
          {card.showMonthlyEstimate && card.monthlyEstimate != null ? (
            <p className="mt-2 text-xs text-emerald-200/90">
              Estimated monthly from supported cadence:{" "}
              {formatMoney(card.monthlyEstimate, card.currency)}/mo
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 border-t border-white/10 pt-4">
        <ActionChip
          label={card.groupId === "unusual_recurring" ? "Review this activity" : "Review"}
          pressed={action === "review"}
          onClick={() => onAction("review")}
        />
        {showExpectedAction ? (
          <ActionChip
            label="Expected"
            pressed={action === "expected"}
            onClick={() => onAction("expected")}
          />
        ) : (
          <ActionChip
            label="Keep"
            pressed={action === "keep"}
            onClick={() => onAction("keep")}
          />
        )}
        {showNotMine ? (
          <ActionChip
            label="Not mine"
            pressed={action === "not_mine"}
            onClick={() => onAction("not_mine")}
          />
        ) : null}
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
      <p className="mt-2 text-[11px] text-white/35">
        Choices stay on this device for this session — alerts are not sent or
        stored on a server.
      </p>
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

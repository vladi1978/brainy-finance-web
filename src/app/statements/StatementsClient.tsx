"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { SUBSCRIPTION_CONFIDENCE_MIN } from "@/lib/statements/heuristics";

type SubscriptionFlags = {
  forgotten: boolean;
  duplicate: boolean;
  priceIncreased: boolean;
  trialConverted: boolean;
  suspicious: boolean;
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
};

type DiagnosticsMeta = {
  subscriptionCount: number;
  spendingInsightCount: number;
  excludedFromSubscriptions: Array<{
    clusterId: string;
    merchantLabel: string;
    reasons: string[];
  }>;
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
  spendingInsights: SpendingInsightRow[];
  diagnostics: DiagnosticsMeta;
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

function dominantSubscriptionCurrency(rows: SubscriptionRow[]): string {
  if (!rows.length) return "USD";
  const counts = new Map<string, number>();
  for (const s of rows) {
    const c = s.currency?.length === 3 ? s.currency : "USD";
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
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
  fitness: "Fitness",
  insurance: "Insurance",
  software: "Software / digital services",
  shopping: "Shopping",
  utilities: "Utilities",
  other: "Other",
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

  const summaryCurrency = useMemo(
    () => (data ? dominantSubscriptionCurrency(data.subscriptions) : "USD"),
    [data]
  );

  return (
    <main className="flex-1 bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-4xl">
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
          <div className="mt-10 space-y-10">
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

            {data.meta.parseDebug ? (
              <details className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/55">
                <summary className="cursor-pointer select-none text-white/70">
                  Transaction extractor diagnostics
                </summary>
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-white/40">Extracted characters</dt>
                    <dd>{data.meta.parseDebug.totalExtractedChars}</dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Physical vs reconstructed lines</dt>
                    <dd>
                      {data.meta.parseDebug.cleanedLineCount} /{" "}
                      {data.meta.parseDebug.reconstructedLineCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-white/40">High-confidence regex parses</dt>
                    <dd>{data.meta.parseDebug.highConfidenceParsed}</dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Accepted / rejected samples</dt>
                    <dd>
                      {data.meta.parseDebug.acceptedCount} /{" "}
                      {data.meta.parseDebug.rejectedCount}
                    </dd>
                  </div>
                </dl>
              </details>
            ) : null}

            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard
                title="Estimated monthly subscriptions"
                value={formatMoney(data.summary.monthlySpend, summaryCurrency)}
                subtitle={
                  data.subscriptions.length
                    ? `${summaryCurrency} · excludes Spending Insights totals`
                    : "No recurring subscriptions or bills cleared the stronger cutoff"
                }
              />
              <SummaryCard
                title="Estimated annual subscriptions"
                value={formatMoney(data.summary.annualSpend, summaryCurrency)}
                subtitle="Based on detected recurring subscriptions only"
              />
              <SummaryCard
                title="Number of subscriptions"
                value={String(data.summary.subscriptionCount)}
              />
              <SummaryCard
                title="Spending insights total"
                value={formatMoney(
                  data.summary.spendingInsightsTotal,
                  summaryCurrency
                )}
                subtitle={`${data.spendingInsights.length} merchants categorized`}
              />
            </section>

            <section className="space-y-4">
              <h2 className="text-lg font-semibold text-white">
                Detected subscriptions
              </h2>
              {data.subscriptions.length === 0 ? (
                <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/60">
                  Nothing cleared the stronger subscription-only cutoff (confidence ≥{" "}
                  {SUBSCRIPTION_CONFIDENCE_MIN}
                  {" "}
                  plus recurring bill / billing-merchant checks). Routine stores now surface under Spending Insights.
                  Narrow windows, payroll-only exports, or image-only PDFs also reduce matches.
                </p>
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
              <h2 className="text-lg font-semibold text-white">
                Spending insights
              </h2>
              <p className="text-sm text-white/50">
                Everyday purchases and cash-flow items are surfaced here—not mixed into subscription totals.
              </p>
              {data.spendingInsights.length === 0 ? (
                <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/60">
                  No additional spending clusters matched insight patterns after removing subscriptions and statement noise.
                </p>
              ) : (
                <ul className="space-y-4">
                  {data.spendingInsights.map((row) => (
                    <li key={row.clusterId}>
                      <SpendingInsightCard row={row} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <details className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/55">
              <summary className="cursor-pointer select-none text-white/70">
                Subscription analysis diagnostics
              </summary>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-white/40">subscriptionCount</dt>
                  <dd className="text-white/80">{data.diagnostics.subscriptionCount}</dd>
                </div>
                <div>
                  <dt className="text-white/40">spendingInsightCount</dt>
                  <dd className="text-white/80">{data.diagnostics.spendingInsightCount}</dd>
                </div>
              </dl>
              {data.diagnostics.excludedFromSubscriptions.length ? (
                <div className="mt-4 border-t border-white/10 pt-3">
                  <p className="mb-2 font-medium text-white/60">
                    excludedFromSubscriptions ({data.diagnostics.excludedFromSubscriptions.length})
                  </p>
                  <ul className="max-h-52 space-y-2 overflow-y-auto text-[11px]">
                    {data.diagnostics.excludedFromSubscriptions
                      .slice(0, 40)
                      .map((row) => (
                        <li
                          key={row.clusterId}
                          className="rounded-lg border border-white/10 bg-black/30 px-2 py-2"
                        >
                          <span className="font-medium text-white/75">
                            {row.merchantLabel}
                          </span>
                          <span className="text-white/35"> · </span>
                          <span className="text-white/50">{row.reasons.join(" · ")}</span>
                        </li>
                      ))}
                  </ul>
                  {data.diagnostics.excludedFromSubscriptions.length > 40 ? (
                    <p className="mt-2 text-white/35">
                      Showing first 40 of{" "}
                      {data.diagnostics.excludedFromSubscriptions.length} excluded candidates.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-white/45">
                  No merged subscription candidates were excluded (or analysis produced none).
                </p>
              )}
            </details>
          </div>
        ) : null}
      </div>
    </main>
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
          {merchantInitial(r.merchant)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-white">
            {r.merchant}
          </h3>
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
          </p>
          <p className="mt-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs text-sky-100/95">
            <span className="font-semibold text-sky-200/95">Recommendation:</span>{" "}
            {r.recommendation}
          </p>
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
  const badges: Array<{ key: string; label: string }> = [];
  if (s.flags.forgotten) badges.push({ key: "f", label: "FORGOTTEN" });
  if (s.flags.duplicate) badges.push({ key: "d", label: "DUPLICATE" });
  if (s.flags.priceIncreased)
    badges.push({ key: "p", label: "PRICE INCREASE" });
  if (s.flags.suspicious) badges.push({ key: "s", label: "SUSPICIOUS" });
  if (s.flags.trialConverted)
    badges.push({ key: "t", label: "TRIAL → PAYING" });

  const compareHref = `/compare?subscriptionMerchant=${encodeURIComponent(s.normalizedName)}`;

  return (
    <div className="rounded-2xl border border-white/[0.09] bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-5">
      <div className="flex flex-wrap gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-black/40 text-lg font-bold text-emerald-200">
          {merchantInitial(s.merchant)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="truncate text-base font-semibold text-white">
              {s.merchant}
            </h3>
            <span className="text-sm text-white/50">
              Confidence {(s.confidence * 100).toFixed(0)}%
            </span>
          </div>
          {s.normalizedName.trim().toUpperCase() !==
          s.merchant.trim().toUpperCase() ? (
            <p className="mt-0.5 text-xs text-white/45">
              Label alias: {s.normalizedName}
            </p>
          ) : null}
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
                className="rounded-full border border-amber-400/35 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100"
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
          <p className="mt-1 text-[11px] text-white/40">
            {catLabel[s.category] ?? s.category}
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

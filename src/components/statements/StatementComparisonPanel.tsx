"use client";

import { useId, useState, type RefObject } from "react";

import type { StatementPeriod } from "@/lib/statements/types";
import type { StatementActivitySummary } from "@/lib/statements/intelligence/statementActivity";
import {
  answerComparisonQuestion,
  buildStatementComparison,
  type StatementComparisonResult,
  type StatementHealthSnapshot,
} from "@/lib/statements/intelligence/statementComparison";
import { REMOVE_COMPARISON_STATEMENT_LABEL } from "@/lib/statements/intelligence/statementScopePresentation";

type Props = {
  currentActivity: StatementActivitySummary;
  currentPeriod: StatementPeriod | null;
  currentHealth?: StatementHealthSnapshot | null;
  previousActivity: StatementActivitySummary | null;
  previousPeriod: StatementPeriod | null;
  previousHealth?: StatementHealthSnapshot | null;
  previousBusy: boolean;
  previousError: string | null;
  previousConsent: boolean;
  onPreviousConsentChange: (value: boolean) => void;
  onPreviousFile: (file: File | null) => void;
  onClearPrevious: () => void;
  formatMoney: (amount: number, currency: string) => string;
  sectionRef?: RefObject<HTMLElement | null>;
};

const COMPARE_ASK: Array<{
  id:
    | "why_spent_more"
    | "bills_changed"
    | "subscriptions_appeared"
    | "spent_less"
    | "review_first";
  label: string;
}> = [
  { id: "why_spent_more", label: "Why did I spend more?" },
  { id: "bills_changed", label: "What bills changed?" },
  { id: "subscriptions_appeared", label: "Did any subscriptions appear?" },
  { id: "spent_less", label: "Where did I spend less?" },
  { id: "review_first", label: "What should I review first?" },
];

function periodLabel(period: StatementPeriod | null): string {
  if (!period?.start || !period?.end) return "Period not confirmed";
  return period.start <= period.end
    ? `${period.start} → ${period.end}`
    : `${period.end} → ${period.start}`;
}

export function StatementComparisonPanel({
  currentActivity,
  currentPeriod,
  currentHealth = null,
  previousActivity,
  previousPeriod,
  previousHealth = null,
  previousBusy,
  previousError,
  previousConsent,
  onPreviousConsentChange,
  onPreviousFile,
  onClearPrevious,
  formatMoney,
  sectionRef,
}: Props) {
  const fileInputId = useId();
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [askId, setAskId] = useState<(typeof COMPARE_ASK)[number]["id"] | null>(
    null
  );

  const comparison: StatementComparisonResult | null = previousActivity
    ? buildStatementComparison({
        previous: previousActivity,
        current: currentActivity,
        previousPeriod,
        currentPeriod,
        previousHealth,
        currentHealth,
      })
    : null;

  const currency = currentActivity.currency;
  const askAnswer =
    comparison && askId
      ? answerComparisonQuestion(comparison, askId)
      : null;

  return (
    <section
      ref={sectionRef}
      id="statement-comparison"
      className="scroll-mt-8 space-y-5 rounded-3xl border border-sky-400/20 bg-sky-500/[0.05] p-5 sm:p-7"
      aria-labelledby="comparison-heading"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300/80">
          Statement comparison
        </p>
        <h2
          id="comparison-heading"
          className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl"
        >
          What changed since your previous statement
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/55">
          Upload one additional text-selectable PDF from the same account. Brainy
          orders the two periods by date automatically. Both documents stay in
          this browser session only—Brainy does not store them. No OpenAI is used
          for this comparison.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
        {comparison &&
        comparison.status !== "unavailable" &&
        comparison.previousPeriod &&
        comparison.currentPeriod ? (
          <>
            <p className="text-sm text-white/70">
              <span className="font-medium text-white">
                Previous (earlier period):{" "}
              </span>
              {periodLabel(comparison.previousPeriod)}
            </p>
            <p className="mt-1 text-sm text-white/70">
              <span className="font-medium text-white">
                Current (later period):{" "}
              </span>
              {periodLabel(comparison.currentPeriod)}
            </p>
            {comparison.chronologyNote ? (
              <p className="mt-2 text-xs leading-relaxed text-sky-100/70">
                {comparison.chronologyNote}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-sm text-white/70">
              <span className="font-medium text-white">
                First uploaded statement:{" "}
              </span>
              {periodLabel(currentPeriod)}
            </p>
            {previousActivity ? (
              <p className="mt-1 text-sm text-white/70">
                <span className="font-medium text-white">
                  Second uploaded statement:{" "}
                </span>
                {periodLabel(previousPeriod)}
              </p>
            ) : (
              <p className="mt-1 text-sm text-white/50">
                Second statement: not uploaded yet
              </p>
            )}
            <p className="mt-2 text-xs leading-relaxed text-white/45">
              After both uploads, Brainy labels Previous and Current by statement
              dates—not by upload order.
            </p>
          </>
        )}
      </div>

      {!previousActivity ? (
        <div className="space-y-4">
          <label className="flex cursor-pointer items-start gap-3 text-sm text-white/70">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-white/30 bg-black/40 text-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
              checked={previousConsent}
              onChange={(e) => onPreviousConsentChange(e.target.checked)}
            />
            <span>
              I own or have permission to analyze this additional statement PDF.
              Consent is recorded only in this browser session.
            </span>
          </label>
          <div>
            <label
              htmlFor={fileInputId}
              className={[
                "inline-flex cursor-pointer rounded-full border px-4 py-2 text-sm transition focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-sky-300",
                previousConsent && !previousBusy
                  ? "border-sky-300/40 bg-sky-500/20 text-sky-50 hover:bg-sky-500/30"
                  : "cursor-not-allowed border-white/10 bg-white/5 text-white/35",
              ].join(" ")}
            >
              {previousBusy
                ? "Analyzing previous statement…"
                : "Upload another statement (PDF, max 12 MB)"}
            </label>
            <input
              id={fileInputId}
              type="file"
              accept="application/pdf"
              className="sr-only"
              disabled={previousBusy || !previousConsent}
              onChange={(e) => {
                void onPreviousFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </div>
          {previousError ? (
            <p className="text-sm text-red-200" role="alert">
              {previousError}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onClearPrevious}
            className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/75 transition hover:border-white/35 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
          >
            {REMOVE_COMPARISON_STATEMENT_LABEL}
          </button>
        </div>
      )}

      {comparison ? (
        <ComparisonResults
          comparison={comparison}
          currency={currency}
          formatMoney={formatMoney}
          expandedCategory={expandedCategory}
          setExpandedCategory={setExpandedCategory}
          askId={askId}
          setAskId={setAskId}
          askAnswer={askAnswer}
        />
      ) : null}
    </section>
  );
}

function ComparisonResults({
  comparison,
  currency,
  formatMoney,
  expandedCategory,
  setExpandedCategory,
  askId,
  setAskId,
  askAnswer,
}: {
  comparison: StatementComparisonResult;
  currency: string;
  formatMoney: (n: number, c: string) => string;
  expandedCategory: string | null;
  setExpandedCategory: (id: string | null) => void;
  askId: (typeof COMPARE_ASK)[number]["id"] | null;
  setAskId: (id: (typeof COMPARE_ASK)[number]["id"] | null) => void;
  askAnswer: string | null;
}) {
  return (
    <div className="space-y-6">
      <p className="text-base leading-relaxed text-white/85">
        {comparison.summarySentence}
      </p>
      <p className="text-xs text-white/45">{comparison.statusReason}</p>

      {comparison.provisionalNotes.length ? (
        <ul className="space-y-1 rounded-2xl border border-amber-400/20 bg-amber-500/[0.07] px-4 py-3 text-sm text-amber-50/90">
          {comparison.provisionalNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      {comparison.status !== "same_statement" &&
      comparison.status !== "unavailable" ? (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              label="Money received"
              previous={comparison.moneyReceived.previous}
              current={comparison.moneyReceived.current}
              delta={comparison.moneyReceived.dollarDelta}
              percent={comparison.moneyReceived.percentDelta}
              currency={currency}
              formatMoney={formatMoney}
            />
            <MetricCard
              label="Money spent"
              previous={comparison.moneySpent.previous}
              current={comparison.moneySpent.current}
              delta={comparison.moneySpent.dollarDelta}
              percent={comparison.moneySpent.percentDelta}
              currency={currency}
              formatMoney={formatMoney}
            />
            {comparison.netCashFlow.available ? (
              <MetricCard
                label="Net cash flow"
                previous={comparison.netCashFlow.previous ?? 0}
                current={comparison.netCashFlow.current ?? 0}
                delta={comparison.netCashFlow.dollarDelta ?? 0}
                percent={comparison.netCashFlow.percentDelta}
                currency={currency}
                formatMoney={formatMoney}
              />
            ) : (
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-xs uppercase tracking-wider text-white/40">
                  Net cash flow
                </p>
                <p className="mt-2 text-sm text-white/55">
                  {comparison.netCashFlow.unavailableReason}
                </p>
              </div>
            )}
          </dl>

          {comparison.rankedFindings.length ? (
            <div>
              <h3 className="text-lg font-semibold text-white">
                The biggest reasons
              </h3>
              <ul className="mt-3 space-y-3">
                {comparison.rankedFindings.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-2xl border border-white/10 bg-black/25 p-4"
                  >
                    <p className="font-semibold text-white">{f.title}</p>
                    <p className="mt-1 text-sm tabular-nums text-white/70">
                      {f.previous != null
                        ? formatMoney(f.previous, currency)
                        : "—"}{" "}
                      →{" "}
                      {f.current != null
                        ? formatMoney(f.current, currency)
                        : "—"}
                      {f.dollarDelta != null
                        ? ` · ${f.dollarDelta >= 0 ? "+" : "−"}${formatMoney(Math.abs(f.dollarDelta), currency)}`
                        : ""}
                    </p>
                    <p className="mt-2 text-sm text-white/55">{f.evidence}</p>
                    {f.nextStep ? (
                      <p className="mt-2 text-sm text-emerald-100/80">
                        Next: {f.nextStep}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {comparison.educationalFlexibleNotes.length ? (
            <ul className="space-y-1 text-sm text-white/55">
              {comparison.educationalFlexibleNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}

          <div>
            <h3 className="text-lg font-semibold text-white">
              Category comparison
            </h3>
            <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10">
              <table className="min-w-full text-left text-sm text-white/70">
                <thead className="bg-black/30 text-xs uppercase tracking-wider text-white/40">
                  <tr>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium">Previous</th>
                    <th className="px-3 py-2 font-medium">Current</th>
                    <th className="px-3 py-2 font-medium">Change</th>
                    <th className="px-3 py-2 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.categories.map((cat) => {
                    const open = expandedCategory === cat.id;
                    return (
                      <tr key={cat.id} className="border-t border-white/10">
                        <td className="px-3 py-2 text-white">{cat.label}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {formatMoney(cat.previous, currency)}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {formatMoney(cat.current, currency)}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {cat.dollarDelta >= 0 ? "+" : "−"}
                          {formatMoney(Math.abs(cat.dollarDelta), currency)}
                          {cat.percentDelta != null
                            ? ` (${cat.percentDelta >= 0 ? "+" : ""}${cat.percentDelta}%)`
                            : ""}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            aria-expanded={open}
                            className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/70 transition hover:border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
                            onClick={() =>
                              setExpandedCategory(open ? null : cat.id)
                            }
                          >
                            {open ? "Hide" : "View details"}
                          </button>
                          {open ? (
                            <p className="mt-2 max-w-xs text-xs text-white/45">
                              {cat.evidence} Direction:{" "}
                              {cat.direction.replace(/-/g, " ")}.
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-white">
              Ask about this comparison
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {COMPARE_ASK.map((q) => {
                const selected = askId === q.id;
                return (
                  <button
                    key={q.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setAskId(selected ? null : q.id)}
                    className={[
                      "rounded-full border px-4 py-2 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300",
                      selected
                        ? "border-sky-300/50 bg-sky-500/25 text-sky-50"
                        : "border-white/15 bg-black/20 text-white/75 hover:border-white/30",
                    ].join(" ")}
                  >
                    {q.label}
                  </button>
                );
              })}
            </div>
            {askAnswer ? (
              <p className="mt-4 rounded-2xl border border-sky-400/20 bg-sky-500/[0.08] p-4 text-sm leading-relaxed text-white/75">
                {askAnswer}
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/55">
        <p>{comparison.healthNote}</p>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-white/45">
          {comparison.previousHealth ? (
            <span>
              Previous Statement Health: {comparison.previousHealth.score} (
              {comparison.previousHealth.label})
            </span>
          ) : null}
          {comparison.currentHealth ? (
            <span>
              Current Statement Health: {comparison.currentHealth.score} (
              {comparison.currentHealth.label})
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  previous,
  current,
  delta,
  percent,
  currency,
  formatMoney,
}: {
  label: string;
  previous: number;
  current: number;
  delta: number;
  percent: number | null;
  currency: string;
  formatMoney: (n: number, c: string) => string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
      <p className="text-xs uppercase tracking-wider text-white/40">{label}</p>
      <p className="mt-2 text-lg font-semibold tabular-nums text-white">
        {formatMoney(current, currency)}
      </p>
      <p className="mt-1 text-xs tabular-nums text-white/50">
        Was {formatMoney(previous, currency)} · {delta >= 0 ? "+" : "−"}
        {formatMoney(Math.abs(delta), currency)}
        {percent != null ? ` (${percent >= 0 ? "+" : ""}${percent}%)` : ""}
      </p>
    </div>
  );
}

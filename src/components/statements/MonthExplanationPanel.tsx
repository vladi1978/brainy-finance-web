"use client";

import { useId, useState } from "react";

import type { StatementPeriod } from "@/lib/statements/types";
import type { StatementActivitySummary } from "@/lib/statements/intelligence/statementActivity";
import {
  buildDebtGuidance,
  buildMonthlyExplanation,
  buildSpendingScenario,
  type SpendingScenarioPercent,
} from "@/lib/statements/intelligence/monthlyExplanation";

type Props = {
  activity: StatementActivitySummary;
  statementPeriod: StatementPeriod | null;
  healthScore: number | null;
  formatMoney: (amount: number, currency: string) => string;
};

export function MonthExplanationPanel({
  activity,
  statementPeriod,
  healthScore,
  formatMoney,
}: Props) {
  const { currency } = activity;
  const explanation = buildMonthlyExplanation({
    activity,
    statementPeriod,
    healthScore,
    formatMoney,
  });
  const debt = buildDebtGuidance(activity);
  const [scenarioPct, setScenarioPct] = useState<SpendingScenarioPercent | null>(
    null
  );
  const [showCallScript, setShowCallScript] = useState(false);
  const [showCompareOptions, setShowCompareOptions] = useState(false);
  const [showCompareMonth, setShowCompareMonth] = useState(false);
  const [copied, setCopied] = useState(false);
  const scriptTitleId = useId();
  const compareTitleId = useId();

  const scenario =
    scenarioPct != null
      ? buildSpendingScenario({
          activity,
          percent: scenarioPct,
          formatMoney,
        })
      : null;

  const flexibleGroup = explanation.commitmentGroups.find(
    (g) => g.id === "flexible"
  );
  const showScenarios =
    activity.ledger.status === "reconciled" &&
    activity.cashFlowReliable &&
    (flexibleGroup?.total ?? 0) > 0;

  async function copyScript(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* A. This month in plain English */}
      <section
        className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-7"
        aria-labelledby="plain-english-heading"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300/80">
          This month in plain English
        </p>
        <h2
          id="plain-english-heading"
          className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl"
        >
          {explanation.headline}
        </h2>

        {explanation.healthCashFlowClarification ? (
          <p className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/[0.07] px-4 py-3 text-sm leading-relaxed text-amber-50/90">
            {explanation.healthCashFlowClarification}
          </p>
        ) : null}

        {explanation.whyNegative ? (
          <div className="mt-5 rounded-2xl border border-sky-400/20 bg-sky-500/[0.06] p-4">
            <h3 className="text-base font-semibold text-white">
              {explanation.whyNegative.title}
            </h3>
            <ul className="mt-2 space-y-2 text-sm leading-relaxed text-white/70">
              {explanation.whyNegative.paragraphs.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-white/45">
              Statement Health measures detected fees and patterns. Cash flow
              compares money received with money spent.
            </p>
          </div>
        ) : null}

        {explanation.topFactors.length ? (
          <div className="mt-4">
            <p className="text-sm text-white/55">
              Your largest spending areas were:
            </p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-white/80">
              {explanation.topFactors.map((f) => (
                <li key={f.id}>
                  <span className="font-medium text-white">{f.label}</span>
                  {" — "}
                  <span className="tabular-nums">
                    {formatMoney(f.total, currency)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {explanation.supportingLines
          .filter((line) => line !== "Your largest spending areas were:")
          .map((line) => (
            <p key={line} className="mt-2 text-sm leading-relaxed text-white/50">
              {line}
            </p>
          ))}

        {explanation.subscriptionSummary.possibleCount > 0 ||
        explanation.subscriptionSummary.otherDigitalChargeCount > 0 ||
        explanation.subscriptionSummary.confirmedCount > 0 ? (
          <p className="mt-3 text-sm leading-relaxed text-white/55">
            {explanation.subscriptionSummary.summaryLine}
          </p>
        ) : null}

        <div className="mt-5">
          <button
            type="button"
            className="rounded-full border border-white/20 bg-black/25 px-4 py-2 text-sm text-white/80 transition hover:border-white/35 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
            aria-expanded={showCompareMonth}
            onClick={() => setShowCompareMonth((v) => !v)}
          >
            {explanation.compareLastMonth.ctaLabel}
          </button>
          {showCompareMonth ? (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/55">
              {explanation.compareLastMonth.message}
            </p>
          ) : null}
        </div>
      </section>

      {/* B. Commitment groups */}
      <section aria-labelledby="commitments-heading">
        <h2
          id="commitments-heading"
          className="text-xl font-semibold tracking-tight text-white sm:text-2xl"
        >
          Commitments and flexible spending
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-white/50">
          Brainy separates needs and financing from spending you may choose to
          review. Mortgage, utilities, insurance, and debt are never labeled
          flexible.
        </p>
        <ul className="mt-4 grid gap-3 md:grid-cols-3">
          {explanation.commitmentGroups.map((group) => (
            <li
              key={group.id}
              className="rounded-2xl border border-white/10 bg-black/25 p-4"
            >
              <p className="text-base font-semibold text-white">{group.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-white/45">
                {group.description}
              </p>
              <p className="mt-3 text-lg font-semibold tabular-nums text-white">
                {formatMoney(group.total, currency)}
              </p>
              <p className="text-xs text-white/40">
                {group.transactionCount} charge
                {group.transactionCount === 1 ? "" : "s"}
              </p>
              {group.lines.length ? (
                <ul className="mt-3 space-y-1 border-t border-white/10 pt-3 text-xs text-white/55">
                  {group.lines.map((line) => (
                    <li key={line.label} className="flex justify-between gap-2">
                      <span className="truncate">{line.label}</span>
                      <span className="shrink-0 tabular-nums">
                        {formatMoney(line.total, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-white/40">None separated.</p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* C. Flexible scenarios */}
      {showScenarios ? (
        <section
          className="rounded-3xl border border-violet-400/15 bg-violet-500/[0.05] p-5 sm:p-6"
          aria-labelledby="scenario-heading"
        >
          <h2
            id="scenario-heading"
            className="text-lg font-semibold text-white sm:text-xl"
          >
            Explore a spending scenario
          </h2>
          <p className="mt-1 text-sm text-white/50">
            Illustrative only — based on flexible spending in this statement.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {([5, 10, 15] as SpendingScenarioPercent[]).map((pct) => {
              const selected = scenarioPct === pct;
              return (
                <button
                  key={pct}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setScenarioPct(pct)}
                  className={[
                    "rounded-full border px-4 py-2 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300",
                    selected
                      ? "border-violet-300/50 bg-violet-500/25 text-violet-50"
                      : "border-white/15 bg-black/20 text-white/75 hover:border-white/30",
                  ].join(" ")}
                >
                  Reduce flexible spending by {pct}%
                </button>
              );
            })}
          </div>
          {scenario ? (
            <div className="mt-4 space-y-2 text-sm leading-relaxed text-white/70">
              {scenario.eligible ? (
                <>
                  <p>
                    A {scenario.percent}% change in the flexible spending
                    observed in this statement would equal about{" "}
                    <span className="font-semibold tabular-nums text-white">
                      {formatMoney(scenario.illustrativeAmount, currency)}
                    </span>{" "}
                    for this period.
                  </p>
                  {scenario.arithmeticLines.length ? (
                    <ul className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 font-mono text-xs text-white/60">
                      {scenario.arithmeticLines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : null}
                  {scenario.remainingNet != null &&
                  scenario.originalNet != null &&
                  scenario.originalNet < 0 ? (
                    <p className="text-sm text-white/60">
                      {scenario.closesDeficit
                        ? "In this illustration, that adjustment would cover the period difference."
                        : "In this illustration, the period would still end negative—just by a smaller amount."}
                    </p>
                  ) : null}
                </>
              ) : (
                <p>{scenario.periodScopeNote}</p>
              )}
              <p className="text-xs text-amber-100/80">{scenario.disclaimer}</p>
              <p className="text-xs text-white/40">{scenario.exclusionNote}</p>
              {scenario.eligible ? (
                <p className="text-xs text-white/40">{scenario.periodScopeNote}</p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* D–F. Debt guidance */}
      {debt ? (
        <section
          className="rounded-3xl border border-sky-400/15 bg-sky-500/[0.05] p-5 sm:p-7"
          aria-labelledby="debt-heading"
        >
          <h2
            id="debt-heading"
            className="text-xl font-semibold tracking-tight text-white sm:text-2xl"
          >
            Understand your debt payments
          </h2>
          <p className="mt-2 text-sm text-white/55">
            Facts Brainy observed on this statement only—not balances, rates, or
            credit scores.
          </p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <dt className="text-xs uppercase tracking-wider text-white/40">
                Total debt payments
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-white">
                {formatMoney(debt.totalPaid, currency)}
              </dd>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <dt className="text-xs uppercase tracking-wider text-white/40">
                Number of payments
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-white">
                {debt.transactionCount}
              </dd>
            </div>
          </dl>
          {debt.creditors.length ? (
            <ul className="mt-4 space-y-2 text-sm text-white/70">
              {debt.creditors.map((c) => (
                <li
                  key={c.name}
                  className="flex justify-between gap-3 rounded-xl border border-white/10 bg-black/15 px-3 py-2"
                >
                  <span>{c.name}</span>
                  <span className="tabular-nums">
                    {formatMoney(c.total, currency)} · {c.count} payment
                    {c.count === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {debt.recurrenceNote ? (
            <p className="mt-3 text-sm text-white/50">{debt.recurrenceNote}</p>
          ) : null}

          <p className="mt-5 text-sm font-medium text-white">
            Educational options you can explore with your provider
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/65">
            {debt.educationalOptions.map((opt) => (
              <li key={opt}>{opt}</li>
            ))}
          </ul>

          <p className="mt-4 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-xs leading-relaxed text-white/45">
            {debt.legalDisclaimer}
          </p>
          <p className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/[0.07] px-4 py-3 text-xs leading-relaxed text-amber-50/85">
            {debt.refinanceTotalCostWarning}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
              aria-expanded={showCallScript}
              aria-controls={showCallScript ? scriptTitleId : undefined}
              onClick={() => {
                setShowCallScript(true);
                setCopied(false);
              }}
            >
              Prepare a call
            </button>
            <button
              type="button"
              className="rounded-full border border-white/20 bg-black/25 px-4 py-2 text-sm text-white/80 transition hover:border-white/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
              aria-expanded={showCompareOptions}
              aria-controls={showCompareOptions ? compareTitleId : undefined}
              onClick={() => setShowCompareOptions((v) => !v)}
            >
              Compare options
            </button>
          </div>

          {showCallScript ? (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={scriptTitleId}
              className="mt-4 rounded-2xl border border-white/15 bg-black/40 p-4 sm:p-5"
            >
              <h3 id={scriptTitleId} className="text-base font-semibold text-white">
                Call script (for your use)
              </h3>
              <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 p-3 text-sm leading-relaxed text-white/75">
                {debt.callScript}
              </pre>
              <p className="mt-3 text-xs text-amber-100/80">
                {debt.callScriptSafetyNote}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-sm text-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
                  onClick={() => void copyScript(debt.callScript)}
                >
                  {copied ? "Copied" : "Copy script"}
                </button>
                <button
                  type="button"
                  className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  onClick={() => {
                    setShowCallScript(false);
                    setCopied(false);
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          ) : null}

          {showCompareOptions ? (
            <div
              id={compareTitleId}
              className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4"
            >
              <h3 className="text-base font-semibold text-white">
                What to compare in any offer
              </h3>
              <p className="mt-1 text-xs text-white/45">
                Educational checklist only—no providers, rankings, or affiliate
                links.
              </p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-white/70">
                {debt.compareChecklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

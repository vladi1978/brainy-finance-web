"use client";

import type { FinancialIntelligenceSummary } from "@/lib/statements/intelligence/financialCategories";

type Props = {
  summary: FinancialIntelligenceSummary;
  formatMoney: (n: number, currency: string) => string;
};

function confidenceLabel(score: number): string {
  if (score >= 0.85) return "High confidence";
  if (score >= 0.7) return "Moderate confidence";
  if (score > 0) return "Lower confidence";
  return "";
}

function CategoryCard(props: {
  title: string;
  subtitle: string;
  tone: "emerald" | "amber" | "violet";
  children: React.ReactNode;
}) {
  const border =
    props.tone === "emerald"
      ? "border-emerald-400/20"
      : props.tone === "amber"
        ? "border-amber-400/20"
        : "border-violet-400/20";
  const label =
    props.tone === "emerald"
      ? "text-emerald-200/80"
      : props.tone === "amber"
        ? "text-amber-200/80"
        : "text-violet-200/80";

  return (
    <div
      className={[
        "rounded-2xl border bg-gradient-to-br from-white/[0.04] to-white/[0.01] p-5",
        border,
      ].join(" ")}
    >
      <p className={["text-[10px] font-semibold uppercase tracking-widest", label].join(" ")}>
        {props.title}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-white/45">{props.subtitle}</p>
      <div className="mt-4">{props.children}</div>
    </div>
  );
}

export function FinancialIntelligenceSummaryPanel({ summary, formatMoney }: Props) {
  const { currency } = summary;
  const observedFees = summary.observedAvoidableFeesPeriod ?? 0;
  const hasActionable =
    summary.actionableMonthly > 0 || summary.actionableYearly > 0;
  const hasOptimization =
    summary.optimization.yearlyHigh > 0 || summary.optimization.monthlyHigh > 0;
  const hasObservedFees = observedFees > 0;

  if (!hasActionable && !hasOptimization && !hasObservedFees) return null;

  return (
    <section className="space-y-4 border-t border-white/10 pt-10">
      <div className="space-y-2 border-b border-white/10 pb-3">
        <h2 className="text-xl font-semibold tracking-tight text-white">
          Financial intelligence
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-white/50">
          Separated by confirmed recurring savings, observed statement fees, and
          optimization ideas that are not guaranteed savings.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <CategoryCard
          title="Confirmed savings"
          subtitle="Cancelable subscriptions, streaming, SaaS, and recurring bills you can act on directly."
          tone="emerald"
        >
          {summary.confirmed.itemCount > 0 && summary.confirmed.monthlyHigh > 0 ? (
            <>
              <p className="text-2xl font-bold tabular-nums text-emerald-100">
                {formatMoney(summary.confirmed.monthlyHigh, currency)}
                <span className="text-sm font-normal text-white/45"> /mo</span>
              </p>
              <p className="mt-1 text-sm tabular-nums text-white/55">
                {summary.confirmed.yearlyHigh > 0 ? (
                  <>
                    {formatMoney(summary.confirmed.yearlyHigh, currency)} /yr
                    {summary.confirmed.confidence > 0 ? (
                      <span className="text-white/35">
                        {" "}
                        · {confidenceLabel(summary.confirmed.confidence)}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span>Annual estimate unavailable</span>
                )}
              </p>
            </>
          ) : (
            <p className="text-sm text-white/40">None identified in this window.</p>
          )}
        </CategoryCard>

        <CategoryCard
          title="Avoidable fees"
          subtitle="Overdraft, maintenance, NSF, and bank penalties detected on this statement."
          tone="amber"
        >
          {summary.avoidableFees.yearlyHigh > 0 ? (
            <>
              <p className="text-2xl font-bold tabular-nums text-amber-100">
                {formatMoney(summary.avoidableFees.monthlyHigh, currency)}
                <span className="text-sm font-normal text-white/45"> /mo</span>
              </p>
              <p className="mt-1 text-sm tabular-nums text-white/55">
                {formatMoney(summary.avoidableFees.yearlyHigh, currency)} /yr
              </p>
              <p className="mt-2 text-[10px] text-white/35">
                Evidence-backed repeat fee pattern
              </p>
            </>
          ) : hasObservedFees ? (
            <>
              <p className="text-2xl font-bold tabular-nums text-amber-100">
                {formatMoney(observedFees, currency)}
              </p>
              <p className="mt-1 text-sm text-white/55">
                observed in this statement
              </p>
              <p className="mt-2 text-[10px] text-white/35">
                Annual estimate unavailable · not included in monthly totals
              </p>
            </>
          ) : (
            <p className="text-sm text-white/40">No bank fees flagged.</p>
          )}
        </CategoryCard>

        <CategoryCard
          title="Optimization opportunities"
          subtitle="Telecom, insurance, bundles, and spending trends — outcomes vary; not counted as real savings."
          tone="violet"
        >
          {hasOptimization && summary.optimization.yearlyHigh > 0 ? (
            <>
              <p className="text-2xl font-bold tabular-nums text-violet-100">
                {formatMoney(summary.optimization.monthlyLow, currency)}
                <span className="text-lg font-normal text-white/40"> – </span>
                {formatMoney(summary.optimization.monthlyHigh, currency)}
                <span className="text-sm font-normal text-white/45"> /mo</span>
              </p>
              <p className="mt-1 text-sm tabular-nums text-white/55">
                {formatMoney(summary.optimization.yearlyLow, currency)} –{" "}
                {formatMoney(summary.optimization.yearlyHigh, currency)} /yr
              </p>
              <p className="mt-2 text-[10px] text-violet-200/50">
                Range only — not included in actionable totals
              </p>
            </>
          ) : (
            <p className="text-sm text-white/40">No annual estimate available</p>
          )}
        </CategoryCard>
      </div>

      {hasActionable ? (
        <div className="rounded-xl border border-emerald-400/15 bg-emerald-500/[0.06] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-200/70">
            Actionable savings (confirmed recurring
            {summary.avoidableFees.yearlyHigh > 0
              ? " + evidence-backed fees"
              : ""}
            )
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-100">
            {formatMoney(summary.actionableMonthly, currency)}
            <span className="text-sm font-normal text-white/45"> /mo · </span>
            {formatMoney(summary.actionableYearly, currency)}
            <span className="text-sm font-normal text-white/45"> /yr</span>
          </p>
        </div>
      ) : hasObservedFees ? (
        <div className="rounded-xl border border-amber-400/15 bg-amber-500/[0.06] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-200/70">
            Observed avoidable fees (this statement)
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-amber-100">
            {formatMoney(observedFees, currency)}
            <span className="text-sm font-normal text-white/45">
              {" "}
              · Annual estimate unavailable
            </span>
          </p>
        </div>
      ) : null}
    </section>
  );
}

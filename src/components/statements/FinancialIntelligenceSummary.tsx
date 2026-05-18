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
  const hasActionable =
    summary.actionableMonthly > 0 || summary.actionableYearly > 0;
  const hasOptimization =
    summary.optimization.yearlyHigh > 0 || summary.optimization.monthlyHigh > 0;

  if (!hasActionable && !hasOptimization) return null;

  return (
    <section className="space-y-4 border-t border-white/10 pt-10">
      <div className="space-y-2 border-b border-white/10 pb-3">
        <h2 className="text-xl font-semibold tracking-tight text-white">
          Financial intelligence
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-white/50">
          Separated by what you can act on today versus fees you can avoid and
          optimization ideas that are not guaranteed savings.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <CategoryCard
          title="Confirmed savings"
          subtitle="Cancelable subscriptions, streaming, SaaS, and recurring bills you can act on directly."
          tone="emerald"
        >
          {summary.confirmed.itemCount > 0 ? (
            <>
              <p className="text-2xl font-bold tabular-nums text-emerald-100">
                {formatMoney(summary.confirmed.monthlyHigh, currency)}
                <span className="text-sm font-normal text-white/45"> /mo</span>
              </p>
              <p className="mt-1 text-sm tabular-nums text-white/55">
                {formatMoney(summary.confirmed.yearlyHigh, currency)} /yr
                {summary.confirmed.confidence > 0 ? (
                  <span className="text-white/35">
                    {" "}
                    · {confidenceLabel(summary.confirmed.confidence)}
                  </span>
                ) : null}
              </p>
              <p className="mt-2 text-[10px] text-white/35">
                {summary.confirmed.itemCount} actionable recurring item
                {summary.confirmed.itemCount === 1 ? "" : "s"}
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
          {summary.avoidableFees.itemCount > 0 ? (
            <>
              <p className="text-2xl font-bold tabular-nums text-amber-100">
                {formatMoney(summary.avoidableFees.monthlyHigh, currency)}
                <span className="text-sm font-normal text-white/45"> /mo</span>
              </p>
              <p className="mt-1 text-sm tabular-nums text-white/55">
                {formatMoney(summary.avoidableFees.yearlyHigh, currency)} /yr
                {summary.avoidableFees.confidence > 0 ? (
                  <span className="text-white/35">
                    {" "}
                    · {confidenceLabel(summary.avoidableFees.confidence)}
                  </span>
                ) : null}
              </p>
              <p className="mt-2 text-[10px] text-white/35">
                Conservative estimate if fees are eliminated going forward
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
          {hasOptimization ? (
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
                {summary.optimization.confidence > 0 ? (
                  <span className="text-white/35">
                    {" "}
                    · {confidenceLabel(summary.optimization.confidence)}
                  </span>
                ) : null}
              </p>
              <p className="mt-2 text-[10px] text-violet-200/50">
                Range only — not included in actionable totals
              </p>
            </>
          ) : (
            <p className="text-sm text-white/40">No optimization signals yet.</p>
          )}
        </CategoryCard>
      </div>

      {hasActionable ? (
        <div className="rounded-xl border border-emerald-400/15 bg-emerald-500/[0.06] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-200/70">
            Actionable savings (confirmed + avoidable fees)
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-100">
            {formatMoney(summary.actionableMonthly, currency)}
            <span className="text-sm font-normal text-white/45"> /mo · </span>
            {formatMoney(summary.actionableYearly, currency)}
            <span className="text-sm font-normal text-white/45"> /yr</span>
          </p>
        </div>
      ) : null}
    </section>
  );
}

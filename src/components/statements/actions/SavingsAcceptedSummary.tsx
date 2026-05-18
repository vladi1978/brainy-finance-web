"use client";

import type { AcceptedSavingsSummary } from "@/lib/statements/actions";

type Props = {
  summary: AcceptedSavingsSummary;
  formatMoney: (n: number, currency: string) => string;
};

export function SavingsAcceptedSummary({ summary, formatMoney }: Props) {
  if (summary.count === 0) return null;

  return (
    <div className="rounded-2xl border border-emerald-400/25 bg-gradient-to-br from-emerald-500/[0.1] to-white/[0.02] px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-200/80">
        Savings accepted
      </p>
      <p className="mt-1 text-sm text-white/70">
        You accepted{" "}
        <span className="font-semibold text-emerald-100">{summary.count}</span>{" "}
        recommendation{summary.count === 1 ? "" : "s"} with estimated impact:
      </p>
      <p className="mt-2 text-lg font-semibold tabular-nums text-emerald-100">
        {formatMoney(summary.monthly, summary.currency)}
        <span className="text-sm font-normal text-white/45"> /mo · </span>
        {formatMoney(summary.yearly, summary.currency)}
        <span className="text-sm font-normal text-white/45"> /yr</span>
      </p>
    </div>
  );
}

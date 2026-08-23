"use client";

import type { SavingsLedgerSummary } from "@/lib/statements/actions";

type Props = {
  summary: SavingsLedgerSummary;
  formatMoney: (n: number, currency: string) => string;
};

export function SavingsAcceptedSummary({ summary, formatMoney }: Props) {
  if (summary.plannedCount === 0 && summary.confirmedCount === 0) return null;

  return (
    <div className="rounded-2xl border border-emerald-400/25 bg-gradient-to-br from-emerald-500/[0.1] to-white/[0.02] px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-200/80">
        Savings ledger
      </p>
      <p className="mt-1 text-sm text-white/70">
        Planned changes are estimates. Brainy counts savings as confirmed only
        after you mark a change completed.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <LedgerMetric label="Planned" count={summary.plannedCount} monthly={summary.plannedMonthly} yearly={summary.plannedYearly} currency={summary.currency} formatMoney={formatMoney} />
        <LedgerMetric label="Confirmed by you" count={summary.confirmedCount} monthly={summary.confirmedMonthly} yearly={summary.confirmedYearly} currency={summary.currency} formatMoney={formatMoney} />
      </div>
    </div>
  );
}

function LedgerMetric({ label, count, monthly, yearly, currency, formatMoney }: {
  label: string;
  count: number;
  monthly: number;
  yearly: number;
  currency: string;
  formatMoney: (n: number, currency: string) => string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <p className="text-[10px] uppercase tracking-widest text-white/45">{label} · {count}</p>
      <p className="mt-1 font-semibold tabular-nums text-emerald-100">
        {formatMoney(monthly, currency)}<span className="text-xs font-normal text-white/40"> /mo · </span>
        {formatMoney(yearly, currency)}<span className="text-xs font-normal text-white/40"> /yr</span>
      </p>
    </div>
  );
}

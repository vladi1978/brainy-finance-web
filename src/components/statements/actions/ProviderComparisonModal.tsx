"use client";

import { useEffect } from "react";

import type { ActionModalKind, EnrichedRecommendation } from "@/lib/statements/actions";

type Props = {
  open: boolean;
  rec: EnrichedRecommendation | null;
  modalKind: ActionModalKind;
  formatMoney: (n: number, currency: string) => string;
  onClose: () => void;
  onAccept?: () => void;
};

const MOCK_ALTERNATIVES = [
  {
    name: "Mint Mobile",
    monthly: 25,
    note: "Prepaid · 15GB · uses T-Mobile network",
  },
  {
    name: "Visible",
    monthly: 30,
    note: "Unlimited · Verizon network · party pay eligible",
  },
  {
    name: "T-Mobile Connect",
    monthly: 35,
    note: "Entry postpaid · 2.5GB · loyalty pricing",
  },
];

function providerLabel(merchant?: string): string {
  if (!merchant) return "Your provider";
  const first = merchant.split(",")[0]?.trim();
  return first || "Your provider";
}

function aiSuggestion(
  rec: EnrichedRecommendation,
  modalKind: ActionModalKind
): string {
  const merchant = providerLabel(rec.merchant);
  const savings = rec.estimatedMonthlySavings;

  if (modalKind === "fee_education") {
    return `Set a low-balance alert ${
      savings > 0
        ? `to avoid repeat fees — this statement shows about ${Math.round(savings)} in avoidable charges.`
        : "before your balance drops — most banks let you set thresholds in their app."
    } Consider a fee-free checking account if overdraft fees appear more than once per quarter.`;
  }

  if (rec.actionType === "reduce_streaming") {
    return `You have multiple streaming services on this statement. Rotating one service every few months or using an annual bundle can cut overlap without losing access — estimated room to save ~${Math.round(savings || 15)}/mo.`;
  }

  return `Based on your statement, ${merchant} may be above typical prepaid/MVNO pricing in your area. Switching to a prepaid MVNO could save ~$${Math.round(savings || 35)}/mo while keeping similar coverage — compare at your next contract renewal.`;
}

export function ProviderComparisonModal({
  open,
  rec,
  modalKind,
  formatMoney,
  onClose,
  onAccept,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !rec) return null;

  const currentProvider = providerLabel(rec.merchant);
  const isFeeModal = modalKind === "fee_education";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="comparison-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-white/10 bg-gradient-to-br from-violet-500/[0.1] via-[#0a0d12] to-black p-6 shadow-2xl shadow-violet-950/40">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-200/70">
              {isFeeModal ? "Fee avoidance guide" : "Provider comparison"}
            </p>
            <h2
              id="comparison-modal-title"
              className="mt-1 text-lg font-semibold text-white"
            >
              {isFeeModal
                ? "Avoid overdraft & NSF fees"
                : `${currentProvider} alternatives`}
            </h2>
            <p className="mt-1 text-xs text-white/50">
              {rec.title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/60 hover:text-white"
          >
            Close
          </button>
        </div>

        {!isFeeModal ? (
          <ul className="mt-5 space-y-3">
            <li className="rounded-xl border border-amber-400/25 bg-amber-500/[0.06] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-amber-100">
                    {currentProvider}
                  </p>
                  <p className="mt-0.5 text-xs text-white/45">Current (statement)</p>
                </div>
                <p className="text-sm font-semibold tabular-nums text-white">
                  {rec.estimatedMonthlySavings > 0
                    ? `~${formatMoney(rec.estimatedMonthlySavings * 4 + 40, rec.currency)}/mo`
                    : "—"}
                </p>
              </div>
            </li>
            {MOCK_ALTERNATIVES.map((alt) => (
              <li
                key={alt.name}
                className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.05] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-emerald-100">
                      {alt.name}
                    </p>
                    <p className="mt-0.5 text-xs text-white/45">{alt.note}</p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-emerald-200">
                    {formatMoney(alt.monthly, rec.currency)}/mo
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="mt-5 space-y-2 text-sm text-white/65">
            <li className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              Enable push alerts when balance drops below a buffer (e.g. $100).
            </li>
            <li className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              Link a no-fee savings account for automatic transfers on payday.
            </li>
            <li className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              Ask your bank to opt out of overdraft coverage on debit — card
              declines beat $35 fees.
            </li>
          </ul>
        )}

        <div className="mt-5 rounded-xl border border-violet-400/25 bg-violet-500/[0.08] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-200/80">
            AI assistant suggestion
          </p>
          <p className="mt-2 text-sm leading-relaxed text-violet-50/90">
            {aiSuggestion(rec, modalKind)}
          </p>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {onAccept ? (
            <button
              type="button"
              onClick={() => {
                onAccept();
                onClose();
              }}
              className="rounded-lg border border-emerald-400/45 bg-emerald-500/15 px-4 py-2 text-xs font-medium text-emerald-100 hover:border-emerald-400/60"
            >
              Accept estimated savings
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs font-medium text-white/75 hover:border-white/25"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect } from "react";

import type { ActionModalKind, EnrichedRecommendation } from "@/lib/statements/actions";

type Props = {
  open: boolean;
  rec: EnrichedRecommendation | null;
  modalKind: ActionModalKind;
  onClose: () => void;
};

export function ProviderComparisonModal({ open, rec, modalKind, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !rec || modalKind !== "fee_education") return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fee-guide-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        aria-label="Close fee guide"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-white/10 bg-gradient-to-br from-violet-500/[0.1] via-[#0a0d12] to-black p-6 shadow-2xl shadow-violet-950/40">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-200/70">
              Fee avoidance guide
            </p>
            <h2 id="fee-guide-title" className="mt-1 text-lg font-semibold text-white">
              Avoid overdraft and NSF fees
            </h2>
            <p className="mt-2 text-xs text-amber-100/70">
              General educational tips only — not banking or financial advice.
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

        <ul className="mt-5 space-y-2 text-sm text-white/65">
          <li className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            Turn on a low-balance alert in your bank app before your balance
            drops below your chosen buffer.
          </li>
          <li className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            Ask your bank which overdraft settings are active and whether debit
            transactions can be declined instead of creating a fee.
          </li>
          <li className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            If fees continue, compare verified fee schedules for checking
            accounts directly with banks or credit unions.
          </li>
        </ul>

        <div className="mt-5 rounded-xl border border-violet-400/25 bg-violet-500/[0.08] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-200/80">
            Suggested next step
          </p>
          <p className="mt-2 text-sm leading-relaxed text-violet-50/90">
            Start with a low-balance alert. If another fee appears, review your
            account settings and fee-free alternatives before the next cycle.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs font-medium text-white/75 hover:border-white/25"
        >
          Done
        </button>
      </div>
    </div>
  );
}

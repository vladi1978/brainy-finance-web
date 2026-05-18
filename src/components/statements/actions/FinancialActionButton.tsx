"use client";

import type { FinancialActionDefinition } from "@/lib/statements/actions";

type Props = {
  action: FinancialActionDefinition;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

const kindStyles: Record<FinancialActionDefinition["kind"], string> = {
  primary:
    "border-violet-400/45 bg-violet-500/15 text-violet-100 hover:border-violet-400/60",
  secondary:
    "border-white/15 bg-white/5 text-white/80 hover:border-white/25",
  ghost:
    "border-transparent bg-transparent text-white/50 hover:text-white/70",
};

const pressedStyles: Record<FinancialActionDefinition["kind"], string> = {
  primary: "border-violet-400/60 bg-violet-500/25 text-violet-50",
  secondary: "border-emerald-400/50 bg-emerald-400/15 text-emerald-100",
  ghost: "text-white/35",
};

export function FinancialActionButton({
  action,
  pressed,
  disabled,
  onClick,
}: Props) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
        pressed ? pressedStyles[action.kind] : kindStyles[action.kind],
      ].join(" ")}
    >
      {action.label}
    </button>
  );
}

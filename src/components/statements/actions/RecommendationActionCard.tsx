"use client";

import type { EnrichedRecommendation } from "@/lib/statements/actions";
import type { RecommendationSeverity } from "@/lib/statements/recommendations/types";

import { FinancialActionButton } from "./FinancialActionButton";

type SeverityStyles = {
  border: string;
  bg: string;
  badge: string;
  text: string;
};

type Props = {
  rec: EnrichedRecommendation;
  severityStyles: Record<RecommendationSeverity, SeverityStyles>;
  severityLabel: Record<RecommendationSeverity, string>;
  formatMoney: (n: number, currency: string) => string;
  lastActionId?: string;
  onAction: (actionId: string) => void;
};

const statusBadge: Partial<
  Record<EnrichedRecommendation["status"], { label: string; className: string }>
> = {
  accepted: {
    label: "Planned",
    className: "border-emerald-400/35 bg-emerald-500/15 text-emerald-100",
  },
  completed: {
    label: "Completed",
    className: "border-emerald-300/45 bg-emerald-400/20 text-emerald-50",
  },
  dismissed: {
    label: "Dismissed",
    className: "border-white/10 bg-white/5 text-white/40",
  },
  tracked: {
    label: "Tracking",
    className: "border-sky-400/35 bg-sky-500/15 text-sky-100",
  },
  essential: {
    label: "Essential",
    className: "border-fuchsia-400/35 bg-fuchsia-500/15 text-fuchsia-100",
  },
};

const statusAnimation: Record<EnrichedRecommendation["status"], string> = {
  pending: "",
  accepted: "bf-accept-glow",
  completed: "ring-1 ring-emerald-300/40",
  dismissed: "bf-dismiss-fade",
  tracked: "bf-tracked-highlight",
  essential: "ring-1 ring-fuchsia-400/30",
};

export function RecommendationActionCard({
  rec,
  severityStyles,
  severityLabel,
  formatMoney,
  lastActionId,
  onAction,
}: Props) {
  const tone = severityStyles[rec.severity];
  const badge = statusBadge[rec.status];
  const isDismissed = rec.status === "dismissed";

  return (
    <li
      className={[
        "rounded-2xl border bg-gradient-to-br to-white/[0.02] p-4 transition-all duration-300",
        tone.border,
        tone.bg,
        statusAnimation[rec.status],
        isDismissed ? "pointer-events-none" : "",
      ].join(" ")}
    >
      <CardHeader rec={rec} tone={tone} severityLabel={severityLabel} badge={badge} />

      <p className={["mt-2 text-sm font-semibold", tone.text].join(" ")}>
        {rec.title}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-white/55">
        {rec.description}
      </p>
      {rec.merchant ? (
        <p className="mt-2 text-[11px] text-white/40">
          Merchants:{" "}
          <span className="text-white/65">{rec.merchant}</span>
        </p>
      ) : null}
      {rec.estimatedMonthlySavings > 0 ? (
        <p className="mt-3 text-xs text-white/45">
          Est. savings ≈{" "}
          <span className="font-medium text-white/80">
            {formatMoney(rec.estimatedMonthlySavings, rec.currency)}
          </span>
          /mo ·{" "}
          <span className="font-medium text-violet-200/90">
            {formatMoney(rec.estimatedYearlySavings, rec.currency)}
          </span>
          /yr
        </p>
      ) : rec.observedPeriodAmount != null && rec.observedPeriodAmount > 0 ? (
        <p className="mt-3 text-xs text-white/45">
          <span className="font-medium text-white/80">
            {formatMoney(rec.observedPeriodAmount, rec.currency)}
          </span>{" "}
          observed in this statement · Annual estimate unavailable
        </p>
      ) : null}

      {!isDismissed ? (
        <CardActions
          rec={rec}
          lastActionId={lastActionId}
          onAction={onAction}
        />
      ) : null}
    </li>
  );
}

function CardHeader(props: {
  rec: EnrichedRecommendation;
  tone: SeverityStyles;
  severityLabel: Record<RecommendationSeverity, string>;
  badge?: { label: string; className: string };
}) {
  const { rec, tone, severityLabel, badge } = props;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={[
          "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          tone.badge,
        ].join(" ")}
      >
        {severityLabel[rec.severity]}
      </span>
      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/50">
        {Math.round(rec.confidence * 100)}% confidence
      </span>
      {badge ? (
        <span
          className={[
            "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            badge.className,
          ].join(" ")}
        >
          {badge.label}
        </span>
      ) : null}
    </div>
  );
}

function CardActions(props: {
  rec: EnrichedRecommendation;
  lastActionId?: string;
  onAction: (actionId: string) => void;
}) {
  const { rec, lastActionId, onAction } = props;
  return (
    <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-3">
      {rec.actions.map((action) => (
        <FinancialActionButton
          key={action.id}
          action={action}
          pressed={lastActionId === action.id}
          onClick={() => onAction(action.id)}
        />
      ))}
    </div>
  );
}

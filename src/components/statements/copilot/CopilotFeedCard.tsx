"use client";

import type { CopilotFeedItem } from "@/lib/statements/timeline/types";
import {
  copilotSeverityLabel,
  copilotSeverityStyles,
} from "./priorities";

type Props = {
  item: CopilotFeedItem;
  formatMoney: (n: number, currency: string) => string;
  index?: number;
};

export function CopilotFeedCard({ item, formatMoney, index = 0 }: Props) {
  const tone = copilotSeverityStyles[item.severity];

  return (
    <li
      className={[
        "bf-copilot-enter rounded-2xl border bg-gradient-to-br to-white/[0.02] p-5",
        tone.border,
        tone.bg,
      ].join(" ")}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className={["text-sm font-semibold", tone.text].join(" ")}>
          {item.title}
        </p>
        <span
          className={[
            "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            tone.badge,
          ].join(" ")}
        >
          {copilotSeverityLabel[item.severity]}
        </span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-white/60">{item.insight}</p>

      <p className="mt-3 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-xs leading-relaxed text-violet-100/90">
        <span className="font-medium text-violet-200/70">Recommendation · </span>
        {item.recommendation}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-white/40">
        <span>
          Priority{" "}
          <span className="font-semibold tabular-nums text-white/75">
            {item.priority.overall}
          </span>
        </span>
        {item.estimatedYearlySavings != null && item.estimatedYearlySavings > 0 ? (
          <span>
            Est. savings{" "}
            <span className="font-medium text-emerald-200/90">
              {formatMoney(item.estimatedYearlySavings, item.currency)}/yr
            </span>
          </span>
        ) : null}
      </div>
    </li>
  );
}

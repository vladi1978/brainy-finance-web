"use client";

import type { CopilotAssistantContext } from "@/lib/statements/copilot/types";
import type { CopilotFeedItem, CopilotTimelineResult } from "@/lib/statements/timeline/types";

export type CopilotSectionData = Omit<CopilotTimelineResult, "feed" | "topPriorities" | "behaviorTrends"> & {
  feed: CopilotFeedItem[];
  topPriorities: CopilotFeedItem[];
  behaviorTrends: CopilotFeedItem[];
};
import { CopilotFeedCard } from "./CopilotFeedCard";
import { CopilotAssistantPanel } from "./CopilotAssistantPanel";

type Props = {
  copilot: CopilotSectionData | CopilotTimelineResult;
  assistant?: CopilotAssistantContext;
  formatMoney: (n: number, currency: string) => string;
};

function SectionIntro(props: { title: string; description: string }) {
  return (
    <div className="space-y-2 border-b border-white/10 pb-3">
      <h2 className="text-xl font-semibold tracking-tight text-white">
        {props.title}
      </h2>
      <p className="max-w-3xl text-sm leading-relaxed text-white/50">
        {props.description}
      </p>
    </div>
  );
}

export function CopilotFeedSection({ copilot, assistant, formatMoney }: Props) {
  if (copilot.feed.length === 0) return null;

  return (
    <section className="space-y-10 border-t border-white/10 pt-10">
      <div className="bf-copilot-enter">
        <SectionIntro
          title="Financial Copilot"
          description="Statement signals ranked by urgency — with an analyst-style assistant that answers from your detected subscriptions, fees, trends, and recurring merchants."
        />
      </div>

      <div className="grid gap-8 xl:grid-cols-[1fr_minmax(280px,340px)]">
        <div className="space-y-8">
          {copilot.topPriorities.length > 0 ? (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-widest text-violet-200/80">
                Top financial priorities this month
              </h3>
              <ol className="grid gap-3">
                {copilot.topPriorities.map((item, i) => (
                  <li
                    key={item.id}
                    className="bf-copilot-enter flex gap-4 rounded-xl border border-violet-400/15 bg-gradient-to-r from-violet-500/[0.08] to-white/[0.02] p-4"
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-violet-400/30 bg-violet-500/15 text-sm font-bold tabular-nums text-violet-100">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white">
                        {item.title}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-white/55">
                        {item.insight}
                      </p>
                      <p className="mt-2 text-[10px] text-white/40">
                        Priority score {item.priority.overall}
                        {item.estimatedYearlySavings != null &&
                        item.estimatedYearlySavings > 0
                          ? ` · est. ${formatMoney(item.estimatedYearlySavings, item.currency)}/yr`
                          : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-white/45">
              Copilot feed
            </h3>
            <ul className="grid gap-4 lg:grid-cols-2">
              {copilot.feed.map((item, index) => (
                <CopilotFeedCard
                  key={item.id}
                  item={item}
                  formatMoney={formatMoney}
                  index={index}
                />
              ))}
            </ul>
          </div>
        </div>

        <CopilotAssistantPanel assistant={assistant} />
      </div>

      {copilot.behaviorTrends.length > 0 ? (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-sky-200/70">
            Financial behavior trends
          </h3>
          <ul className="flex flex-wrap gap-2">
            {copilot.behaviorTrends.map((item) => (
              <li
                key={`trend-${item.id}`}
                className="bf-copilot-enter max-w-md rounded-full border border-sky-400/20 bg-sky-500/[0.06] px-4 py-2 text-xs text-sky-100/90"
              >
                <span className="font-medium">{item.title}</span>
                <span className="text-sky-200/50"> — </span>
                <span className="text-white/55">{item.insight}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="bf-copilot-enter grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/[0.1] to-white/[0.02] p-6">
          <p className="text-xs font-medium uppercase tracking-widest text-emerald-200/70">
            Actionable savings
          </p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-emerald-100">
            {formatMoney(copilot.actionableYearlySavings ?? 0, copilot.currency)}
            <span className="text-sm font-normal text-white/45"> /yr</span>
          </p>
          <p className="mt-2 text-xs leading-relaxed text-white/50">
            Confirmed recurring cuts and avoidable fees only — excludes
            optimization estimates.
          </p>
        </div>
        <div className="rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/[0.08] to-white/[0.02] p-6">
          <p className="text-xs font-medium uppercase tracking-widest text-violet-200/70">
            Optimization opportunity range
          </p>
          {(copilot.optimizationPotential?.yearlyHigh ?? 0) > 0 ? (
            <>
              <p className="mt-2 text-3xl font-bold tabular-nums text-violet-100">
                {formatMoney(
                  copilot.optimizationPotential?.yearlyLow ?? 0,
                  copilot.currency
                )}
                <span className="text-lg font-normal text-white/40"> – </span>
                {formatMoney(
                  copilot.optimizationPotential?.yearlyHigh ?? 0,
                  copilot.currency
                )}
                <span className="text-sm font-normal text-white/45"> /yr</span>
              </p>
              <p className="mt-2 text-xs leading-relaxed text-white/50">
                Not guaranteed savings — evidence-backed optimization only.
                Never added to actionable totals.
                {(copilot.optimizationPotential?.confidence ?? 0) > 0 ? (
                  <span className="mt-1 block text-violet-200/50">
                    Confidence{" "}
                    {Math.round(
                      (copilot.optimizationPotential?.confidence ?? 0) * 100
                    )}
                    %
                  </span>
                ) : null}
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-xl font-semibold text-violet-100/90">
                No annual estimate available
              </p>
              <p className="mt-2 text-xs leading-relaxed text-white/50">
                Optimization ranges require evidence-backed cadence — period
                spending is never annualized as potential savings.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

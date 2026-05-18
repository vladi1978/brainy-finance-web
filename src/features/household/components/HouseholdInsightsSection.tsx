import type { HouseholdSharedInsight } from "../types";
import { formatUsdFromCents } from "../utils/formatMoney";

export function HouseholdInsightsSection({
  insights,
}: {
  insights: HouseholdSharedInsight[];
}) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6">
      <h2 className="text-lg font-semibold text-white">Shared insights</h2>
      <p className="mt-1 max-w-2xl text-sm text-white/50">
        Opportunities surfaced at the household level. No one sees another
        member’s private transactions or account details.
      </p>
      <ul className="mt-6 space-y-4">
        {insights.map((ins) => (
          <li
            key={ins.id}
            className="rounded-xl border border-white/[0.06] bg-black/25 p-4 sm:p-5"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200/80">
                  {ins.category}
                </p>
                <h3 className="mt-1 text-base font-semibold text-white">
                  {ins.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-white/55">
                  {ins.description}
                </p>
              </div>
              <div className="shrink-0 text-left sm:text-right">
                <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">
                  Est. monthly
                </p>
                <p className="text-lg font-semibold text-emerald-300/95">
                  {formatUsdFromCents(ins.estimatedMonthlySavingCents)}
                </p>
                <p className="mt-1 text-[11px] text-white/35">
                  Updated {new Date(ins.updatedAt).toLocaleDateString("en-US")}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

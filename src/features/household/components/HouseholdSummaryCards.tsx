import type { Household } from "../types";
import { formatUsdFromCents } from "../utils/formatMoney";
import { planTypeLabel } from "../utils/planLabels";

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-white">
        {value}
      </p>
      {hint ? (
        <p className="mt-2 text-xs leading-relaxed text-white/45">{hint}</p>
      ) : null}
    </div>
  );
}

export function HouseholdSummaryCards({ household }: { household: Household }) {
  const memberCount = household.members.length;
  const insightCount = household.sharedInsights.length;
  const savings = formatUsdFromCents(household.potentialMonthlySavingsCents);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        label="Household plan"
        value={planTypeLabel(household.planType)}
        hint={`Up to ${household.planLimits.maxMembers} members on this tier.`}
      />
      <SummaryCard
        label="Members"
        value={String(memberCount)}
        hint={`${household.planLimits.maxMembers} seats included with current limits.`}
      />
      <SummaryCard
        label="Shared insights"
        value={String(insightCount)}
        hint={`Track up to ${household.planLimits.maxSharedInsightsTracked} household opportunities.`}
      />
      <SummaryCard
        label="Potential monthly savings"
        value={savings}
        hint="Household-level estimate from shared opportunities only."
      />
    </div>
  );
}

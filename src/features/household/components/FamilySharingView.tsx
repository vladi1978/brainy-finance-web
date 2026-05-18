"use client";

import { useHousehold } from "../hooks/useHousehold";
import { HouseholdInsightsSection } from "./HouseholdInsightsSection";
import { HouseholdMembersSection } from "./HouseholdMembersSection";
import { HouseholdSummaryCards } from "./HouseholdSummaryCards";

export function FamilySharingView() {
  const { household, error, isLoading } = useHousehold();

  if (isLoading && !household) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-24 text-white/50">
        <p className="text-sm">Loading household…</p>
      </div>
    );
  }

  if (error && !household) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-24">
        <p className="text-sm text-rose-300/90">{error}</p>
      </div>
    );
  }

  if (!household) {
    return null;
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-col gap-6 border-b border-white/[0.06] pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Family Sharing
            </h1>
            <p className="mt-2 max-w-2xl text-base text-white/55">
              Share Brainy with your household while keeping financial data
              private.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled
              className="cursor-not-allowed rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-white/35"
              title="Invitations will be available in a future release."
            >
              Invite member
            </button>
          </div>
        </header>

        {error ? (
          <p
            className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-100/90"
            role="status"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-8 space-y-8">
          <HouseholdSummaryCards household={household} />
          <HouseholdMembersSection members={household.members} />
          <HouseholdInsightsSection insights={household.sharedInsights} />
          <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-200/90">
              Privacy
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/70">
              Each member keeps their own financial data private. Brainy only
              shares household-level savings opportunities.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

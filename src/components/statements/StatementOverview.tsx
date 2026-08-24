type OverviewCard = {
  clusterId: string;
  merchant: string;
  status: "confirmed" | "possible" | "expected" | "unusual";
  categoryLabel: string;
  chargeCount: number;
  periodTotal: number;
  latestCharge: number;
  currency: string;
  estimatedCadence: string | null;
  reason: string;
};

type OverviewGroups = {
  expectedRecurringBills: OverviewCard[];
  subscriptions: OverviewCard[];
  repeatedDiscretionary: OverviewCard[];
  unusualRecurring: OverviewCard[];
  oneTimeReview?: OverviewCard[];
};

type Props = {
  periodLabel: string | null;
  transactionCount: number;
  pageCount: number;
  currency: string;
  healthScore?: { score: number; label: string };
  groups: OverviewGroups | null;
  formatMoney: (amount: number, currency: string) => string;
};

function uniqueCards(groups: OverviewGroups): OverviewCard[] {
  const seen = new Set<string>();
  return [
    ...groups.expectedRecurringBills,
    ...groups.subscriptions,
    ...groups.repeatedDiscretionary,
    ...groups.unusualRecurring,
    ...(groups.oneTimeReview ?? []),
  ].filter((card) => {
    if (seen.has(card.clusterId)) return false;
    seen.add(card.clusterId);
    return true;
  });
}

export function StatementOverview({
  periodLabel,
  transactionCount,
  pageCount,
  currency,
  healthScore,
  groups,
  formatMoney,
}: Props) {
  if (!groups) return null;

  const cards = uniqueCards(groups);
  const organizedTotal = cards.reduce((sum, card) => sum + card.periodTotal, 0);
  const confirmedSubscriptions = groups.subscriptions.filter(
    (card) => card.status === "confirmed"
  );
  const possibleSubscriptions = groups.subscriptions.filter(
    (card) => card.status !== "confirmed"
  );
  const reviewCount =
    possibleSubscriptions.length +
    groups.unusualRecurring.length +
    (groups.oneTimeReview?.length ?? 0);

  const priorities = [
    ...(groups.oneTimeReview ?? []).map((card) => ({
      title: `Review ${card.merchant}`,
      detail: `${formatMoney(card.periodTotal, card.currency)} was observed and separated for review.`,
      tone: "border-red-400/20 bg-red-500/[0.06] text-red-100",
    })),
    ...possibleSubscriptions.map((card) => ({
      title: `Do you still use ${card.merchant}?`,
      detail: `${card.chargeCount} charge${card.chargeCount === 1 ? "" : "s"} detected; recurrence is not yet confirmed.`,
      tone: "border-amber-400/20 bg-amber-500/[0.06] text-amber-100",
    })),
    ...groups.repeatedDiscretionary.map((card) => ({
      title: `Notice the pattern at ${card.merchant}`,
      detail: `${card.chargeCount} charges totaling ${formatMoney(card.periodTotal, card.currency)} in this statement.`,
      tone: "border-sky-400/20 bg-sky-500/[0.06] text-sky-100",
    })),
  ].slice(0, 3);

  const summary = priorities.length
    ? `Brainy found ${priorities.length} item${priorities.length === 1 ? "" : "s"} worth your attention first. The goal is not to tell you what to stop buying, but to make recurring charges, fees, and flexible spending easier to see.`
    : "Brainy did not find an urgent review item in this statement. You can still inspect expected bills and spending groups below.";

  return (
    <section className="space-y-7 rounded-3xl border border-emerald-400/15 bg-gradient-to-br from-emerald-500/[0.08] via-white/[0.025] to-violet-500/[0.05] p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300/80">
            Your statement at a glance
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Here is what deserves your attention
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/60">
            {summary}
          </p>
        </div>
        {healthScore ? (
          <div className="min-w-28 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-center">
            <p className="text-xs uppercase tracking-wider text-white/40">Health</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-emerald-200">
              {healthScore.score}
            </p>
            <p className="text-xs text-white/55">{healthScore.label}</p>
          </div>
        ) : null}
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewMetric label="Statement window" value={periodLabel ?? "Not confirmed"} />
        <OverviewMetric
          label="PDF analyzed"
          value={`${pageCount} page${pageCount === 1 ? "" : "s"} · ${transactionCount} transactions`}
        />
        <OverviewMetric
          label="Organized activity"
          value={formatMoney(organizedTotal, currency)}
          note="Only activity shown in the groups below"
        />
        <OverviewMetric
          label="Needs your review"
          value={String(reviewCount)}
          note="Possible subscriptions and flagged activity"
        />
      </dl>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-widest text-white/55">
          Start with these
        </h3>
        {priorities.length ? (
          <ul className="mt-3 grid gap-3 lg:grid-cols-3">
            {priorities.map((priority) => (
              <li
                key={`${priority.title}-${priority.detail}`}
                className={`rounded-2xl border p-4 ${priority.tone}`}
              >
                <p className="font-semibold">{priority.title}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-white/55">
                  {priority.detail}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/55">
            No urgent item crossed the current evidence threshold.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <GroupLink
          href="#expected-bills"
          label="Expected bills"
          count={groups.expectedRecurringBills.length}
          description="Phone, utilities, insurance and necessities"
        />
        <GroupLink
          href="#subscriptions-review"
          label="Subscriptions"
          count={groups.subscriptions.length}
          description={`${confirmedSubscriptions.length} confirmed · ${possibleSubscriptions.length} possible`}
        />
        <GroupLink
          href="#flexible-spending"
          label="Flexible spending"
          count={groups.repeatedDiscretionary.length}
          description="Repeated dining, delivery or rideshare"
        />
        <GroupLink
          href="#activity-review"
          label="Review activity"
          count={groups.unusualRecurring.length + (groups.oneTimeReview?.length ?? 0)}
          description="Charges that deserve a closer look"
        />
      </div>
    </section>
  );
}

function OverviewMetric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <dt className="text-[11px] uppercase tracking-wider text-white/40">{label}</dt>
      <dd className="mt-1.5 font-semibold text-white">{value}</dd>
      {note ? <p className="mt-1 text-[11px] leading-relaxed text-white/35">{note}</p> : null}
    </div>
  );
}

function GroupLink({
  href,
  label,
  count,
  description,
}: {
  href: string;
  label: string;
  count: number;
  description: string;
}) {
  return (
    <a
      href={href}
      className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 transition hover:border-emerald-400/30 hover:bg-white/[0.06]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-white">{label}</span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs tabular-nums text-white/70">
          {count}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-white/45">{description}</p>
    </a>
  );
}

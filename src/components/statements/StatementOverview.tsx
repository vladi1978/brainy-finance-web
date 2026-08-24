"use client";

import { useState } from "react";

import type { StatementActivitySummary } from "@/lib/statements/intelligence/statementActivity";

type OverviewGroups = {
  expectedRecurringBills: unknown[];
  subscriptions: unknown[];
  repeatedDiscretionary: unknown[];
  unusualRecurring: unknown[];
  oneTimeReview?: unknown[];
};

type Props = {
  periodLabel: string | null;
  pageCount: number;
  activity: StatementActivitySummary | null;
  groups: OverviewGroups | null;
  healthScore?: { score: number; label: string; factors: Array<{ id: string; label: string; impact: number }> };
  formatMoney: (amount: number, currency: string) => string;
};

const ATTENTION_TONE: Record<string, string> = {
  fee: "border-amber-400/20 bg-amber-500/[0.06] text-amber-100",
  subscription: "border-violet-400/20 bg-violet-500/[0.06] text-violet-100",
  review: "border-sky-400/20 bg-sky-500/[0.06] text-sky-100",
  bill: "border-emerald-400/20 bg-emerald-500/[0.06] text-emerald-100",
};

export function StatementOverview({
  periodLabel,
  pageCount,
  activity,
  groups,
  healthScore,
  formatMoney,
}: Props) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  if (!activity) return null;

  const { currency } = activity;
  const confirmedSubs =
    activity.subscriptionCards.filter((s) => s.status === "confirmed") ?? [];
  const possibleSubs =
    activity.subscriptionCards.filter((s) => s.status === "possible") ?? [];

  return (
    <section className="space-y-8 rounded-3xl border border-emerald-400/15 bg-gradient-to-br from-emerald-500/[0.08] via-white/[0.025] to-violet-500/[0.05] p-5 sm:p-7">
      {/* A. Your statement at a glance */}
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300/80">
            Your statement at a glance
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Complete activity from this PDF
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/60">
            {pageCount} page{pageCount === 1 ? "" : "s"} analyzed ·{" "}
            {activity.debitCount} debits and {activity.creditCount} credits parsed
            · categories reconcile to total debits
            {activity.reconciliation.ok ? "" : " (reconciliation mismatch — review parser output)"}.
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

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <OverviewMetric label="Money in" value={formatMoney(activity.moneyIn, currency)} />
        <OverviewMetric label="Money out" value={formatMoney(activity.moneyOut, currency)} />
        <OverviewMetric
          label="Net cash flow"
          value={formatMoney(activity.netCashFlow, currency)}
        />
        <OverviewMetric label="Statement period" value={periodLabel ?? "Not confirmed"} />
        <OverviewMetric
          label="Transactions"
          value={String(activity.transactionCount)}
        />
        <OverviewMetric
          label="Health factors"
          value={healthScore ? `${healthScore.factors.length} visible` : "—"}
          note={
            healthScore?.factors[0]
              ? healthScore.factors[0].label.slice(0, 48)
              : undefined
          }
        />
      </dl>

      {/* B. What deserves your attention */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-widest text-white/55">
          What deserves your attention
        </h3>
        {activity.attentionItems.length ? (
          <ul className="mt-3 grid gap-3 lg:grid-cols-3">
            {activity.attentionItems.map((item) => (
              <li
                key={item.id}
                className={`rounded-2xl border p-4 ${ATTENTION_TONE[item.tone] ?? ATTENTION_TONE.review}`}
              >
                <p className="font-semibold">{item.title}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-white/55">{item.detail}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/55">
            No urgent review item crossed the current evidence threshold.
          </p>
        )}
      </div>

      {/* C. Where your money went */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-widest text-white/55">
          Where your money went
        </h3>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {activity.categories
            .filter((c) => c.transactionCount > 0)
            .map((cat) => (
              <div
                key={cat.id}
                className="rounded-2xl border border-white/10 bg-black/20 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{cat.label}</p>
                    <p className="mt-1 text-sm tabular-nums text-white/70">
                      {formatMoney(cat.total, currency)} · {cat.transactionCount}{" "}
                      txn{cat.transactionCount === 1 ? "" : "s"} · {cat.percentOfDebits}%
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedCategory((prev) =>
                        prev === cat.id ? null : cat.id
                      )
                    }
                    className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/55 hover:border-white/25"
                  >
                    {expandedCategory === cat.id ? "Hide" : "Expand"}
                  </button>
                </div>
                {cat.topMerchants.length ? (
                  <p className="mt-2 text-xs text-white/45">
                    Top:{" "}
                    {cat.topMerchants
                      .map((m) => `${m.name} (${formatMoney(m.total, currency)})`)
                      .join(" · ")}
                  </p>
                ) : null}
                {expandedCategory === cat.id ? (
                  <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto border-t border-white/10 pt-3 text-xs text-white/60">
                    {cat.transactions.map((txn) => (
                      <li key={txn.id} className="flex justify-between gap-2">
                        <span className="truncate">{txn.normalizedName}</span>
                        <span className="shrink-0 tabular-nums">
                          {formatMoney(txn.amount, txn.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
        </div>
      </div>

      {/* D. Bills and services */}
      <div id="expected-bills">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-white/55">
          Bills and services
        </h3>
        {activity.billCards.length ? (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {activity.billCards.map((bill) => (
              <li
                key={bill.id}
                className="rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.05] p-4"
              >
                <p className="font-semibold text-white">{bill.normalizedName}</p>
                <p className="mt-1 text-sm tabular-nums text-white/70">
                  {formatMoney(bill.observedAmount, bill.currency)} · {bill.chargeCount}{" "}
                  charge{bill.chargeCount === 1 ? "" : "s"}
                </p>
                <p className="mt-1 text-xs text-white/45">
                  {bill.dateRange
                    ? `${bill.dateRange.start} → ${bill.dateRange.end}`
                    : "Date range not confirmed"}
                  {bill.cadenceLabel
                    ? ` · ${bill.cadenceLabel}`
                    : bill.chargeCount === 1
                      ? " · Recurrence not confirmed"
                      : ""}
                </p>
                {bill.insuranceSubtype ? (
                  <p className="mt-1 text-xs text-emerald-200/70">{bill.insuranceSubtype}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-2xl border border-dashed border-white/15 px-4 py-5 text-sm text-white/50">
            No phone, internet, utility, or insurance payments were separated for this upload.
          </p>
        )}
      </div>

      {/* E. Subscriptions */}
      <div id="subscriptions-review">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-white/55">
          Subscriptions
        </h3>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <SubscriptionBucket
            title="Confirmed subscriptions"
            empty="None with enough recurrence evidence."
            items={confirmedSubs}
            formatMoney={formatMoney}
          />
          <SubscriptionBucket
            title="Possible subscriptions"
            empty="No possible subscriptions — ordinary purchases stay out of this list."
            items={possibleSubs}
            formatMoney={formatMoney}
            highlightForgotten
          />
        </div>
      </div>

      {/* F. Activity needing classification */}
      <div id="activity-review">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-white/55">
          Activity needing classification
        </h3>
        {activity.uncategorized.length ? (
          <ul className="mt-3 space-y-2">
            {activity.uncategorized.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm"
              >
                <span className="truncate text-white/80">{row.normalizedName}</span>
                <span className="shrink-0 tabular-nums text-white/60">
                  {formatMoney(row.amount, row.currency)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/55">
            All parsed debits mapped to a category above.
          </p>
        )}
      </div>

      {groups ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <GroupLink
            href="#expected-bills"
            label="Expected bills"
            count={groups.expectedRecurringBills.length}
          />
          <GroupLink
            href="#subscriptions-review"
            label="Subscriptions"
            count={groups.subscriptions.length}
          />
          <GroupLink
            href="#flexible-spending"
            label="Flexible spending"
            count={groups.repeatedDiscretionary.length}
          />
          <GroupLink
            href="#activity-review"
            label="Other / review"
            count={activity.uncategorized.length + (groups.oneTimeReview?.length ?? 0)}
          />
        </div>
      ) : null}
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
}: {
  href: string;
  label: string;
  count: number;
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
    </a>
  );
}

function SubscriptionBucket({
  title,
  empty,
  items,
  formatMoney,
  highlightForgotten,
}: {
  title: string;
  empty: string;
  items: StatementActivitySummary["subscriptionCards"];
  formatMoney: (amount: number, currency: string) => string;
  highlightForgotten?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-sm font-semibold text-white">{title}</p>
      {items.length ? (
        <ul className="mt-3 space-y-2">
          {items.map((sub) => (
            <li
              key={sub.id}
              className={[
                "rounded-xl border px-3 py-2.5 text-sm",
                highlightForgotten && sub.status === "possible"
                  ? "border-amber-400/25 bg-amber-500/[0.06]"
                  : "border-white/10 bg-white/[0.03]",
              ].join(" ")}
            >
              <p className="font-medium text-white">{sub.normalizedName}</p>
              <p className="mt-0.5 text-xs text-white/50">
                {sub.chargeCount} charge{sub.chargeCount === 1 ? "" : "s"} ·{" "}
                {formatMoney(sub.periodTotal, sub.currency)} total
                {sub.cadenceLabel
                  ? ` · ${sub.cadenceLabel}`
                  : " · Recurrence not confirmed"}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-white/45">{empty}</p>
      )}
    </div>
  );
}

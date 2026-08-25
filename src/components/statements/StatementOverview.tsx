"use client";

import { useState } from "react";

import type { StatementActivitySummary } from "@/lib/statements/intelligence/statementActivity";
import { STATEMENT_CATEGORY_ORDER } from "@/lib/statements/intelligence/statementActivity";

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
  healthScore?: {
    score: number;
    label: string;
    factors: Array<{ id: string; label: string; impact: number }>;
    provisional?: boolean;
    displayMode?: "numeric" | "provisional" | "suppressed";
    analysisConfidence?: "high" | "medium" | "low";
    statusNote?: string;
  };
  formatMoney: (amount: number, currency: string) => string;
};

const ATTENTION_TONE: Record<string, string> = {
  fee: "border-amber-400/20 bg-amber-500/[0.06] text-amber-100",
  subscription: "border-violet-400/20 bg-violet-500/[0.06] text-violet-100",
  review: "border-sky-400/20 bg-sky-500/[0.06] text-sky-100",
  bill: "border-emerald-400/20 bg-emerald-500/[0.06] text-emerald-100",
};

const NECESSITY_IDS = new Set(["housing", "bills", "insurance"]);
const FLEXIBLE_IDS = new Set([
  "shopping",
  "dining",
  "food_delivery_rideshare",
  "fuel",
]);

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

  const orderedCategories = STATEMENT_CATEGORY_ORDER.map(
    (id) => activity.categories.find((c) => c.id === id)!
  ).filter(Boolean);

  const ledgerLabel =
    activity.ledger.status === "reconciled"
      ? "Reconciled with statement summary"
      : activity.ledger.status === "partially_reconciled"
        ? "Partially reconciled"
        : "Unreconciled with statement summary";

  const showHealthNumeric =
    healthScore &&
    healthScore.displayMode !== "suppressed" &&
    !healthScore.provisional;

  const moneyInVisible = activity.moneyInCategories.filter(
    (c) => c.transactionCount > 0
  );

  return (
    <section className="space-y-8 rounded-3xl border border-emerald-400/15 bg-gradient-to-br from-emerald-500/[0.08] via-white/[0.025] to-violet-500/[0.05] p-5 sm:p-7">
      {/* 1. Statement status and reconciliation */}
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300/80">
            Statement status
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Complete activity from this PDF
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/60">
            {pageCount} page{pageCount === 1 ? "" : "s"} analyzed ·{" "}
            {activity.debitCount} debits and {activity.creditCount} credits ·{" "}
            {ledgerLabel}
            {activity.reconciliation.ok
              ? ""
              : " · category totals need review"}
            .
          </p>
        </div>
        {healthScore ? (
          <div className="min-w-28 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-center">
            <p className="text-xs uppercase tracking-wider text-white/40">
              {healthScore.provisional ? "Health (provisional)" : "Health"}
            </p>
            {showHealthNumeric || healthScore.provisional ? (
              <p className="mt-1 text-3xl font-bold tabular-nums text-emerald-200">
                {healthScore.score}
              </p>
            ) : (
              <p className="mt-1 text-lg font-semibold text-white/70">—</p>
            )}
            <p className="text-xs text-white/55">{healthScore.label}</p>
            {healthScore.statusNote ? (
              <p className="mt-2 max-w-[11rem] text-[10px] leading-snug text-white/40">
                {healthScore.statusNote}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 2. Money in / out / net — only reliable net */}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <OverviewMetric
          label="Money in"
          value={formatMoney(activity.moneyIn, currency)}
          note={
            activity.ledger.depositsStatus !== "reconciled"
              ? "May be incomplete vs statement deposits"
              : undefined
          }
        />
        <OverviewMetric
          label="Money out"
          value={formatMoney(activity.moneyOut, currency)}
          note={
            activity.ledger.withdrawalsStatus !== "reconciled"
              ? "May be incomplete vs statement withdrawals"
              : undefined
          }
        />
        <OverviewMetric
          label="Net cash flow"
          value={
            activity.cashFlowReliable && activity.netCashFlow != null
              ? formatMoney(activity.netCashFlow, currency)
              : "Not reliable yet"
          }
          note={
            activity.cashFlowReliable
              ? undefined
              : "Hidden until ledger reconciliation improves"
          }
        />
        <OverviewMetric label="Statement period" value={periodLabel ?? "Not confirmed"} />
        <OverviewMetric
          label="Transactions"
          value={String(activity.transactionCount)}
        />
        <OverviewMetric
          label="Analysis confidence"
          value={
            healthScore?.analysisConfidence
              ? healthScore.analysisConfidence
              : activity.ledger.status === "reconciled"
                ? "high"
                : "low"
          }
        />
      </dl>

      {activity.attentionItems.length ? (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-widest text-white/55">
            What deserves your attention
          </h3>
          <ul className="mt-3 grid gap-3 lg:grid-cols-3">
            {activity.attentionItems.map((item) => (
              <li
                key={item.id}
                className={`rounded-2xl border p-4 ${ATTENTION_TONE[item.tone] ?? ATTENTION_TONE.review}`}
              >
                <p className="font-semibold">{item.title}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-white/55">
                  {item.detail}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Money received — credits only, never mixed into spending */}
      {moneyInVisible.length ? (
        <div id="money-received">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-white/55">
            Money received
          </h3>
          <p className="mt-1 text-xs text-white/40">
            Incoming activity only — not counted in spending categories below.
          </p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {moneyInVisible.map((cat) => (
              <div
                key={cat.id}
                className="rounded-2xl border border-sky-400/15 bg-sky-500/[0.05] p-4"
              >
                <p className="font-semibold text-white">{cat.label}</p>
                <p className="mt-1 text-sm tabular-nums text-white/70">
                  {formatMoney(cat.total, currency)} · {cat.transactionCount}{" "}
                  txn{cat.transactionCount === 1 ? "" : "s"}
                </p>
                {cat.dateRange ? (
                  <p className="mt-1 text-xs text-white/40">
                    {cat.dateRange.start} → {cat.dateRange.end}
                  </p>
                ) : null}
                {cat.topSources.length ? (
                  <p className="mt-2 text-xs text-white/45">
                    Top:{" "}
                    {cat.topSources
                      .map(
                        (s) => `${s.name} (${formatMoney(s.total, currency)})`
                      )
                      .join(" · ")}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* 3. Bills and necessities */}
      <CategorySection
        title="Bills and necessities"
        sectionId="expected-bills"
        categories={orderedCategories.filter((c) => NECESSITY_IDS.has(c.id))}
        expandedCategory={expandedCategory}
        setExpandedCategory={setExpandedCategory}
        formatMoney={formatMoney}
        currency={currency}
        empty="No housing, utility, phone, or insurance payments were separated."
      />
      {activity.billCards.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {activity.billCards.map((bill) => (
            <li
              key={bill.id}
              className="rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.05] p-4"
            >
              <p className="font-semibold text-white">{bill.normalizedName}</p>
              <p className="mt-1 text-sm tabular-nums text-white/70">
                {formatMoney(bill.observedAmount, bill.currency)} ·{" "}
                {bill.chargeCount} charge{bill.chargeCount === 1 ? "" : "s"}
              </p>
              <p className="mt-1 text-xs text-white/45">
                {bill.billKind}
                {bill.cadenceLabel
                  ? ` · ${bill.cadenceLabel}`
                  : bill.chargeCount === 1
                    ? " · Recurrence not confirmed"
                    : ""}
              </p>
              {bill.observationNote ? (
                <p className="mt-1 text-xs text-amber-100/70">{bill.observationNote}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {/* 4. Debt and financing */}
      <CategorySection
        title="Debt and financing payments"
        sectionId="debt-financing"
        categories={orderedCategories.filter((c) => c.id === "debt_financing")}
        expandedCategory={expandedCategory}
        setExpandedCategory={setExpandedCategory}
        formatMoney={formatMoney}
        currency={currency}
        empty="No Synchrony / Affirm / Comenity-style financing payments detected."
      />

      {/* 5. Subscriptions */}
      <div id="subscriptions-review">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-white/55">
          Confirmed and possible subscriptions
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
            empty="No possible subscriptions — bills and debt stay out of this list."
            items={possibleSubs}
            formatMoney={formatMoney}
            highlightForgotten
          />
        </div>
      </div>

      {/* 6. Flexible spending */}
      <CategorySection
        title="Flexible spending"
        sectionId="flexible-spending"
        categories={orderedCategories.filter((c) => FLEXIBLE_IDS.has(c.id))}
        expandedCategory={expandedCategory}
        setExpandedCategory={setExpandedCategory}
        formatMoney={formatMoney}
        currency={currency}
        empty="No shopping, dining, rideshare, or fuel activity separated."
      />

      {/* Software */}
      <CategorySection
        title="Software and services"
        sectionId="software-services"
        categories={orderedCategories.filter((c) => c.id === "software_services")}
        expandedCategory={expandedCategory}
        setExpandedCategory={setExpandedCategory}
        formatMoney={formatMoney}
        currency={currency}
        empty="No software/service merchants separated."
      />

      {/* 7. Fees + transfers */}
      <CategorySection
        title="Fees and transfers"
        sectionId="fees-transfers"
        categories={orderedCategories.filter(
          (c) => c.id === "fees" || c.id === "transfers_payments"
        )}
        expandedCategory={expandedCategory}
        setExpandedCategory={setExpandedCategory}
        formatMoney={formatMoney}
        currency={currency}
        empty="No fees or peer transfers separated."
      />

      {/* 8. Other residual */}
      <div id="activity-review">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-white/55">
          Other / unclassified
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
            label="Bills"
            count={activity.billCards.length}
          />
          <GroupLink
            href="#subscriptions-review"
            label="Subscriptions"
            count={activity.subscriptionCards.length}
          />
          <GroupLink
            href="#flexible-spending"
            label="Flexible spending"
            count={
              orderedCategories
                .filter((c) => FLEXIBLE_IDS.has(c.id))
                .reduce((s, c) => s + c.transactionCount, 0)
            }
          />
          <GroupLink
            href="#activity-review"
            label="Other / review"
            count={activity.uncategorized.length}
          />
        </div>
      ) : null}
    </section>
  );
}

function CategorySection({
  title,
  sectionId,
  categories,
  expandedCategory,
  setExpandedCategory,
  formatMoney,
  currency,
  empty,
}: {
  title: string;
  sectionId: string;
  categories: StatementActivitySummary["categories"];
  expandedCategory: string | null;
  setExpandedCategory: (updater: (prev: string | null) => string | null) => void;
  formatMoney: (amount: number, currency: string) => string;
  currency: string;
  empty: string;
}) {
  const visible = categories.filter((c) => c.transactionCount > 0);
  return (
    <div id={sectionId}>
      <h3 className="text-sm font-semibold uppercase tracking-widest text-white/55">
        {title}
      </h3>
      {visible.length ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {visible.map((cat) => (
            <div
              key={cat.id}
              className="rounded-2xl border border-white/10 bg-black/20 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">{cat.label}</p>
                  <p className="mt-1 text-sm tabular-nums text-white/70">
                    {formatMoney(cat.total, currency)} · {cat.transactionCount}{" "}
                    txn{cat.transactionCount === 1 ? "" : "s"} ·{" "}
                    {cat.percentOfDebits}%
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
      ) : (
        <p className="mt-3 rounded-2xl border border-dashed border-white/15 px-4 py-5 text-sm text-white/50">
          {empty}
        </p>
      )}
    </div>
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
      {note ? (
        <p className="mt-1 text-[11px] leading-relaxed text-white/35">{note}</p>
      ) : null}
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

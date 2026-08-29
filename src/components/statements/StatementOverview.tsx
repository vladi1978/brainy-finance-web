"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import { MonthExplanationPanel } from "@/components/statements/MonthExplanationPanel";
import type { StatementPeriod } from "@/lib/statements/types";
import type {
  StatementActivityCategory,
  StatementActivitySummary,
  StatementDebitCategoryId,
} from "@/lib/statements/intelligence/statementActivity";
import {
  buildMonthlyExplanation,
  buildSpendingScenario,
} from "@/lib/statements/intelligence/monthlyExplanation";
import {
  answerComparisonQuestion,
  buildStatementComparison,
  type StatementComparisonResult,
} from "@/lib/statements/intelligence/statementComparison";
import { presentationMerchantDisplayName } from "@/lib/statements/presentationMerchantDisplay";

type OverviewGroups = {
  expectedRecurringBills: unknown[];
  subscriptions: unknown[];
  repeatedDiscretionary: unknown[];
  unusualRecurring: unknown[];
  oneTimeReview?: unknown[];
} | null;

type HealthScoreProps = {
  score: number;
  label: string;
  factors: Array<{ id: string; label: string; impact: number }>;
  provisional?: boolean;
  displayMode?: "numeric" | "provisional" | "suppressed";
  analysisConfidence?: "high" | "medium" | "low";
  statusNote?: string;
};

type Props = {
  periodLabel: string | null;
  statementPeriod?: StatementPeriod | null;
  pageCount: number;
  activity: StatementActivitySummary | null;
  groups: OverviewGroups;
  healthScore?: HealthScoreProps;
  formatMoney: (amount: number, currency: string) => string;
  /** Detailed intelligence / presentation sections rendered inside progressive disclosure. */
  detailedAnalysis?: ReactNode;
  /** Focus/scroll to the second-statement upload comparison flow. */
  onRequestComparison?: () => void;
  /** Comparison upload + results slot (session-only previous statement). */
  comparisonSlot?: ReactNode;
  previousActivity?: StatementActivitySummary | null;
  previousPeriod?: StatementPeriod | null;
};

type HouseholdBucketId =
  | "home_essentials"
  | "debt"
  | "shopping"
  | "food"
  | "transport"
  | "digital"
  | "transfers"
  | "other";

type HouseholdBucket = {
  id: HouseholdBucketId;
  label: string;
  sourceIds: StatementDebitCategoryId[];
};

const HOUSEHOLD_BUCKETS: HouseholdBucket[] = [
  {
    id: "home_essentials",
    label: "Home & essential bills",
    sourceIds: ["housing", "bills", "insurance"],
  },
  {
    id: "debt",
    label: "Debt & financing",
    sourceIds: ["debt_financing"],
  },
  {
    id: "shopping",
    label: "Shopping",
    sourceIds: ["shopping"],
  },
  {
    id: "food",
    label: "Food & dining",
    sourceIds: ["dining", "food_delivery_rideshare"],
  },
  {
    id: "transport",
    label: "Transportation",
    sourceIds: ["fuel"],
  },
  {
    id: "digital",
    label: "Digital services & subscriptions",
    sourceIds: ["software_services", "subscriptions"],
  },
  {
    id: "transfers",
    label: "Transfers",
    sourceIds: ["transfers_payments"],
  },
  {
    id: "other",
    label: "Other",
    sourceIds: ["other", "professional_services", "fees"],
  },
];

type AttentionFinding = {
  id: string;
  title: string;
  observed: string;
  why: string;
  evidence: string;
  nextAction: string;
  tone: "fee" | "subscription" | "review" | "bill";
};

type AskChoiceId =
  | "understand"
  | "save"
  | "subscriptions"
  | "bills"
  | "changed"
  | "unusual"
  | "buy";

const ASK_CHOICES: Array<{ id: AskChoiceId; label: string }> = [
  { id: "understand", label: "Help me understand my spending" },
  { id: "save", label: "Find ways to save" },
  { id: "subscriptions", label: "Review my subscriptions" },
  { id: "bills", label: "Explain my bills" },
  { id: "changed", label: "What changed?" },
  { id: "unusual", label: "Review unusual activity" },
  { id: "buy", label: "Help me buy something" },
];

const ATTENTION_TONE: Record<string, string> = {
  fee: "border-amber-400/25 bg-amber-500/[0.07]",
  subscription: "border-violet-400/25 bg-violet-500/[0.07]",
  review: "border-sky-400/25 bg-sky-500/[0.07]",
  bill: "border-emerald-400/25 bg-emerald-500/[0.07]",
};

function confidencePlain(
  level: "high" | "medium" | "low" | undefined,
  ledgerStatus: string
): string {
  const resolved =
    level ?? (ledgerStatus === "reconciled" ? "high" : "low");
  if (resolved === "high") return "High";
  if (resolved === "medium") return "Medium";
  return "Lower";
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildHouseholdRows(
  activity: StatementActivitySummary
): Array<{
  id: HouseholdBucketId;
  label: string;
  total: number;
  transactionCount: number;
  percentOfDebits: number;
  topMerchants: Array<{ name: string; total: number; count: number }>;
  transactions: StatementActivityCategory["transactions"];
}> {
  const byId = new Map(activity.categories.map((c) => [c.id, c]));
  const moneyOut = activity.moneyOut || 0;

  return HOUSEHOLD_BUCKETS.map((bucket) => {
    const cats = bucket.sourceIds
      .map((id) => byId.get(id))
      .filter((c): c is StatementActivityCategory => Boolean(c));
    const total = roundMoney(cats.reduce((s, c) => s + c.total, 0));
    const transactionCount = cats.reduce((s, c) => s + c.transactionCount, 0);
    const merchantMap = new Map<
      string,
      { name: string; total: number; count: number }
    >();
    for (const cat of cats) {
      for (const m of cat.topMerchants) {
        const prev = merchantMap.get(m.name);
        if (prev) {
          prev.total = roundMoney(prev.total + m.total);
          prev.count += m.count;
        } else {
          merchantMap.set(m.name, { ...m });
        }
      }
    }
    const topMerchants = [...merchantMap.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 3)
      .map((m) => ({
        ...m,
        name: presentationMerchantDisplayName(m.name),
      }));
    const transactions = cats
      .flatMap((c) => c.transactions)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((t) => ({
        ...t,
        // Keep raw merchant on the object for diagnostics; display uses helper.
        normalizedName: presentationMerchantDisplayName(
          t.normalizedName,
          t.merchant
        ),
        merchant: t.merchant,
      }));

    return {
      id: bucket.id,
      label: bucket.label,
      total,
      transactionCount,
      percentOfDebits:
        moneyOut > 0 ? roundMoney((total / moneyOut) * 100) : 0,
      topMerchants,
      transactions,
    };
  }).filter((row) => row.transactionCount > 0);
}

function buildAttentionFindings(
  activity: StatementActivitySummary,
  _formatMoney: (amount: number, currency: string) => string
): AttentionFinding[] {
  void _formatMoney;
  return activity.attentionItems.slice(0, 5).map((item) => {
    if (item.id === "cashflow-negative") {
      return {
        id: item.id,
        title: item.title,
        observed: item.detail,
        why: "Cash flow compares money received with money spent—separate from Statement Health.",
        evidence: "Taken from reconciled money in and money out on this PDF.",
        nextAction:
          "Review essential commitments, debt payments, and flexible spending below.",
        tone: item.tone,
      };
    }
    if (item.tone === "fee") {
      return {
        id: item.id,
        title: item.title,
        observed: item.detail,
        why: "Fees reduce money available for everyday spending.",
        evidence: "Found in the fee lines Brainy read from this PDF.",
        nextAction:
          "Review whether your bank offers alerts or a lower-fee option.",
        tone: "fee",
      };
    }
    if (item.tone === "subscription") {
      return {
        id: item.id,
        title: item.title.replace(
          /^Possible subscription:\s*/i,
          "Possible subscription · "
        ),
        observed: item.detail,
        why: "Recurring services can add up if they are no longer useful.",
        evidence:
          "One or more charges were found; monthly recurrence is not confirmed.",
        nextAction: "You decide whether this expense still provides value.",
        tone: "subscription",
      };
    }
    return {
      id: item.id,
      title: item.title,
      observed: item.detail,
      why: "This charge may be hard to recognize at a glance.",
      evidence: "Shown from the activity Brainy read on this statement.",
      nextAction: "Open the details below if you want to review the charge.",
      tone: item.tone,
    };
  });
}

export function StatementOverview({
  periodLabel,
  statementPeriod = null,
  pageCount,
  activity,
  groups,
  healthScore,
  formatMoney,
  detailedAnalysis,
  onRequestComparison,
  comparisonSlot,
  previousActivity = null,
  previousPeriod = null,
}: Props) {
  const [expandedBucket, setExpandedBucket] = useState<string | null>(null);
  const [askChoice, setAskChoice] = useState<AskChoiceId | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const householdRows = useMemo(
    () => (activity ? buildHouseholdRows(activity) : []),
    [activity]
  );

  const findings = useMemo(
    () => (activity ? buildAttentionFindings(activity, formatMoney) : []),
    [activity, formatMoney]
  );

  const comparison = useMemo((): StatementComparisonResult | null => {
    if (!activity || !previousActivity) return null;
    return buildStatementComparison({
      previous: previousActivity,
      current: activity,
      previousPeriod,
      currentPeriod: statementPeriod,
      previousHealth: null,
      currentHealth: healthScore
        ? {
            score: healthScore.score,
            label: healthScore.label,
            provisional: healthScore.provisional,
            displayMode: healthScore.displayMode,
          }
        : null,
    });
  }, [
    activity,
    previousActivity,
    previousPeriod,
    statementPeriod,
    healthScore,
  ]);

  if (!activity) return null;

  const { currency } = activity;
  const provisionalLedger = activity.ledger.status !== "reconciled";
  const showNet =
    activity.cashFlowReliable && activity.netCashFlow != null;
  const confidence = confidencePlain(
    healthScore?.analysisConfidence,
    activity.ledger.status
  );
  const showHealth =
    healthScore && healthScore.displayMode !== "suppressed";
  const healthProvisional = Boolean(healthScore?.provisional);

  const confirmedSubs = activity.subscriptionCards.filter(
    (s) => s.status === "confirmed"
  );
  const possibleSubs = activity.subscriptionCards.filter(
    (s) => s.status === "possible"
  );

  const askResponse = buildAskResponse({
    choice: askChoice,
    activity,
    formatMoney,
    confirmedCount: confirmedSubs.length,
    possibleCount: possibleSubs.length,
    findings,
    comparison,
    onRequestComparison,
  });

  return (
    <div className="space-y-8">
      <p className="text-sm text-white/50">
        Keep your lifestyle. Spend smarter.
      </p>

      {/* 1. Monthly snapshot */}
      <section className="rounded-3xl border border-emerald-400/15 bg-gradient-to-br from-emerald-500/[0.08] via-white/[0.025] to-violet-500/[0.05] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300/80">
              Monthly snapshot
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              What happened on this statement
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/55">
              {periodLabel
                ? `Statement period: ${periodLabel}`
                : "Statement period not confirmed from this PDF"}
              {" · "}
              {pageCount} page{pageCount === 1 ? "" : "s"}
            </p>
          </div>
          {showHealth ? (
            <div className="min-w-[8.5rem] rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-white/35">
                {healthProvisional
                  ? "Statement Health (provisional)"
                  : "Statement Health"}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-200/90">
                {healthScore!.score}
              </p>
              <p className="text-[11px] text-white/45">{healthScore!.label}</p>
              <p className="mt-1.5 max-w-[9rem] text-[10px] leading-snug text-white/35">
                Secondary signal — not overall financial wellbeing
              </p>
            </div>
          ) : null}
        </div>

        {provisionalLedger ? (
          <p className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/[0.08] px-4 py-3 text-sm leading-relaxed text-amber-50/90">
            Some activity may be missing or duplicated, so Brainy is showing a
            provisional analysis.
          </p>
        ) : null}

        <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <SnapshotMetric
            label="Money received"
            value={formatMoney(activity.moneyIn, currency)}
          />
          <SnapshotMetric
            label="Money spent"
            value={formatMoney(activity.moneyOut, currency)}
          />
          {showNet ? (
            <SnapshotMetric
              label="Net cash flow"
              value={formatMoney(activity.netCashFlow!, currency)}
            />
          ) : (
            <SnapshotMetric
              label="Net cash flow"
              value="Not shown yet"
              note="Shown only when the statement totals line up"
            />
          )}
          <SnapshotMetric label="Analysis confidence" value={confidence} />
        </dl>

        <p className="mt-4 max-w-3xl text-xs leading-relaxed text-white/40">
          Statement Health measures fees, recurring patterns, and activity on
          this PDF—not overall financial wellbeing.
        </p>
      </section>

      <MonthExplanationPanel
        activity={activity}
        statementPeriod={statementPeriod}
        healthScore={healthScore?.score ?? null}
        formatMoney={formatMoney}
        onRequestComparison={onRequestComparison}
        comparisonReady={Boolean(
          comparison &&
            comparison.status !== "unavailable" &&
            comparison.status !== "same_statement"
        )}
      />

      {comparisonSlot}

      {/* 2. Attention */}
      <section>
        <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
          What deserves your attention
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-white/50">
          Brainy found a few items worth a calm look. You decide what still
          provides value.
        </p>
        {findings.length ? (
          <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {findings.map((f) => (
              <li
                key={f.id}
                className={`rounded-2xl border p-4 ${ATTENTION_TONE[f.tone] ?? ATTENTION_TONE.review}`}
              >
                <p className="text-base font-semibold text-white">{f.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-white/70">
                  <span className="text-white/45">Brainy found: </span>
                  {f.observed}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-white/55">
                  {f.why}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-white/40">
                  Evidence: {f.evidence}
                </p>
                <p className="mt-3 text-sm font-medium text-emerald-100/90">
                  Next: {f.nextAction}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-2xl border border-dashed border-white/15 px-4 py-6 text-sm text-white/50">
            Nothing stood out as urgent on this statement.
          </p>
        )}
      </section>

      {/* 3. Where money went */}
      <section>
        <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
          Where your money went
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-white/50">
          Spending categories from this statement. Totals match the money Brainy
          read from your PDF.
        </p>
        <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {householdRows.map((row) => {
            const open = expandedBucket === row.id;
            return (
              <li
                key={row.id}
                className="rounded-2xl border border-white/10 bg-black/25 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-white">
                      {row.label}
                    </p>
                    <p className="mt-1 text-sm tabular-nums text-white/70">
                      {formatMoney(row.total, currency)} · {row.transactionCount}{" "}
                      charge{row.transactionCount === 1 ? "" : "s"} ·{" "}
                      {row.percentOfDebits}%
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedBucket((prev) =>
                        prev === row.id ? null : row.id
                      )
                    }
                    className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 transition hover:border-white/30 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
                    aria-expanded={open}
                  >
                    {open ? "Hide details" : "View details"}
                  </button>
                </div>
                {row.topMerchants.length ? (
                  <p className="mt-2 text-xs leading-relaxed text-white/45">
                    Top:{" "}
                    {row.topMerchants
                      .map(
                        (m) =>
                          `${m.name} (${formatMoney(m.total, currency)})`
                      )
                      .join(" · ")}
                  </p>
                ) : null}
                {open ? (
                  <ul className="mt-3 max-h-52 space-y-1.5 overflow-y-auto border-t border-white/10 pt-3 text-xs text-white/60">
                    {row.transactions.map((txn) => (
                      <li
                        key={txn.id}
                        className="flex justify-between gap-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-white/80">
                            {txn.normalizedName}
                          </span>
                          {txn.merchant &&
                          txn.merchant.trim() !== txn.normalizedName.trim() ? (
                            <span
                              className="mt-0.5 block truncate text-[10px] text-white/35"
                              title={txn.merchant}
                            >
                              Bank text: {txn.merchant}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {formatMoney(txn.amount, txn.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {/* 4. Ask Brainy */}
      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-7">
        <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
          Ask Brainy
        </h2>
        <p className="mt-1 text-sm text-white/50">
          What would you like Brainy to help you with?
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {ASK_CHOICES.map((choice) => {
            const selected = askChoice === choice.id;
            return (
              <button
                key={choice.id}
                type="button"
                onClick={() => setAskChoice(choice.id)}
                className={[
                  "rounded-full border px-4 py-2 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300",
                  selected
                    ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-50"
                    : "border-white/15 bg-black/20 text-white/75 hover:border-white/30 hover:text-white",
                ].join(" ")}
                aria-pressed={selected}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
        {askResponse ? (
          <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.06] p-4 text-sm leading-relaxed text-white/75">
            {askResponse.body}
            {askResponse.href ? (
              <p className="mt-3">
                <Link
                  href={askResponse.href}
                  className="inline-flex rounded-full border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/25"
                >
                  {askResponse.linkLabel}
                </Link>
              </p>
            ) : null}
            {askResponse.actionLabel && askResponse.onAction ? (
              <p className="mt-3">
                <button
                  type="button"
                  onClick={askResponse.onAction}
                  className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
                >
                  {askResponse.actionLabel}
                </button>
              </p>
            ) : null}
            {askResponse.openDetails ? (
              <p className="mt-3">
                <button
                  type="button"
                  onClick={() => setDetailsOpen(true)}
                  className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/80 transition hover:border-white/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
                >
                  Open detailed analysis
                </button>
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-sm text-white/40">
            Choose a topic above. Brainy will use what it already found on this
            statement—no extra apps needed.
          </p>
        )}
      </section>

      {/* Progressive disclosure */}
      <details
        className="group rounded-3xl border border-white/10 bg-white/[0.025]"
        open={detailsOpen}
        onToggle={(e) =>
          setDetailsOpen((e.target as HTMLDetailsElement).open)
        }
      >
        <summary className="cursor-pointer list-none px-5 py-5 sm:px-7 [&::-webkit-details-marker]:hidden">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-base font-semibold text-white">
                View detailed financial analysis
              </p>
              <p className="mt-1 text-sm text-white/45">
                Bills, subscriptions, money received, Health factors, and
                diagnostics—kept out of the way until you want them.
              </p>
            </div>
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/55 transition group-open:rotate-180">
              ↓
            </span>
          </div>
        </summary>

        <div className="space-y-10 border-t border-white/10 px-5 py-7 sm:px-7">
          <DetailedLedgerBlock activity={activity} formatMoney={formatMoney} />

          <DetailedMoneyIn
            activity={activity}
            formatMoney={formatMoney}
          />

          <DetailedBills activity={activity} formatMoney={formatMoney} />

          <DetailedSubscriptions
            confirmed={confirmedSubs}
            possible={possibleSubs}
            formatMoney={formatMoney}
          />

          {groups ? (
            <p className="text-xs text-white/40">
              Additional merchant cards and recommendation tools appear below
              when available.
            </p>
          ) : null}

          {detailedAnalysis}

          <p className="text-xs text-white/35">
            Diagnostics stay at the bottom of this detailed section when
            available.
          </p>
        </div>
      </details>
    </div>
  );
}

function buildAskResponse(args: {
  choice: AskChoiceId | null;
  activity: StatementActivitySummary;
  formatMoney: (n: number, c: string) => string;
  confirmedCount: number;
  possibleCount: number;
  findings: AttentionFinding[];
  comparison?: StatementComparisonResult | null;
  onRequestComparison?: () => void;
}): {
  body: ReactNode;
  href?: string;
  linkLabel?: string;
  openDetails?: boolean;
  actionLabel?: string;
  onAction?: () => void;
} | null {
  if (!args.choice) return null;
  const { activity, formatMoney } = args;
  const { currency } = activity;

  switch (args.choice) {
    case "understand": {
      const expl = buildMonthlyExplanation({
        activity,
        healthScore: null,
        formatMoney,
      });
      const flexible = expl.commitmentGroups.find((g) => g.id === "flexible");
      const essential = expl.commitmentGroups.find((g) => g.id === "essential");
      const financial = expl.commitmentGroups.find((g) => g.id === "financial");
      return {
        body: (
          <>
            {expl.headline} Essential commitments:{" "}
            {formatMoney(essential?.total ?? 0, currency)}. Debt and financing:{" "}
            {formatMoney(financial?.total ?? 0, currency)}. Flexible spending:{" "}
            {formatMoney(flexible?.total ?? 0, currency)}.
            {expl.topFactors.length
              ? ` Largest areas: ${expl.topFactors
                  .map(
                    (f) =>
                      `${f.label} (${formatMoney(f.total, currency)})`
                  )
                  .join("; ")}.`
              : ""}
          </>
        ),
      };
    }
    case "save": {
      const scenario10 = buildSpendingScenario({
        activity,
        percent: 10,
        formatMoney,
      });
      const flexibleBase = scenario10.flexibleBase;
      return {
        body: (
          <>
            Brainy can only illustrate changes to flexible spending (currently{" "}
            {formatMoney(flexibleBase, currency)}). Try the 5%, 10%, or 15%
            scenarios above—those are examples, not promised savings. Possible
            subscriptions to recognize separately: {args.possibleCount}{" "}
            (confirmed: {args.confirmedCount}). Housing, utilities, insurance,
            and debt payments are not treated as cancelable savings.
          </>
        ),
      };
    }
    case "subscriptions":
      return {
        body: (
          <>
            Confirmed subscriptions: {args.confirmedCount}. Possible
            subscriptions (recurrence not confirmed): {args.possibleCount}.
            This count is not the same as every digital purchase—services like
            one-off developer tools stay as digital charges, not subscriptions.
            Debt and financing payments are kept out of this list.
          </>
        ),
        openDetails: true,
      };
    case "bills": {
      const groups = activity.billProviderGroups;
      if (!groups.length) {
        return {
          body: (
            <>
              Brainy did not separate household bill providers on this upload.
              Open details to scan related categories.
            </>
          ),
          openDetails: true,
        };
      }
      return {
        body: (
          <>
            Brainy found {groups.length} bill provider
            {groups.length === 1 ? "" : "s"} on this statement
            {groups
              .slice(0, 3)
              .map(
                (g) =>
                  ` · ${g.providerName} ${formatMoney(g.totalObserved, g.currency)}${
                    g.serviceCount > 1 ? ` (${g.serviceCount} charges)` : ""
                  }`
              )
              .join("")}
            . These are household costs to review—not framed as waste.
          </>
        ),
        openDetails: true,
      };
    }
    case "changed": {
      if (
        args.comparison &&
        args.comparison.status !== "unavailable" &&
        args.comparison.status !== "same_statement"
      ) {
        return {
          body: (
            <>
              {answerComparisonQuestion(args.comparison, "what_changed")}
            </>
          ),
          actionLabel: "Jump to comparison details",
          onAction: args.onRequestComparison,
        };
      }
      if (args.comparison?.status === "same_statement") {
        return {
          body: <>{args.comparison.statusReason}</>,
          actionLabel: "Upload a different previous statement",
          onAction: args.onRequestComparison,
        };
      }
      return {
        body: (
          <>
            To see what changed, upload the previous statement from the same
            account. Brainy compares money received, money spent, bills, and
            possible subscriptions only after both PDFs are analyzed in this
            session.
          </>
        ),
        actionLabel: "Compare with another statement",
        onAction: args.onRequestComparison,
      };
    }
    case "unusual": {
      const otherCount = activity.uncategorized.length;
      const attentionCount = args.findings.length;
      return {
        body: (
          <>
            Brainy flagged {attentionCount} attention item
            {attentionCount === 1 ? "" : "s"} and {otherCount} other /
            unclassified charge{otherCount === 1 ? "" : "s"}. Open the detailed
            analysis to review them one by one.
          </>
        ),
        openDetails: true,
      };
    }
    case "buy":
      return {
        body: (
          <>
            Shopping Assistant can help you find a product while keeping your
            lifestyle in mind. This uses a separate shopping flow—not statement
            service comparisons.
          </>
        ),
        href: "/shopping-assistant",
        linkLabel: "Open Shopping Assistant",
      };
    default:
      return null;
  }
}

function SnapshotMetric({
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
      <dt className="text-xs uppercase tracking-wider text-white/40">{label}</dt>
      <dd className="mt-1.5 text-lg font-semibold tabular-nums text-white">
        {value}
      </dd>
      {note ? (
        <p className="mt-1 text-xs leading-relaxed text-white/35">{note}</p>
      ) : null}
    </div>
  );
}

function DetailedLedgerBlock({
  activity,
  formatMoney,
}: {
  activity: StatementActivitySummary;
  formatMoney: (n: number, c: string) => string;
}) {
  const { currency } = activity;
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-widest text-white/50">
        Ledger reconciliation
      </h3>
      <dl className="mt-3 grid gap-2 text-sm text-white/65 sm:grid-cols-2">
        <div className="flex justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
          <dt>Bank deposits</dt>
          <dd className="tabular-nums">
            {activity.ledger.reportedDeposits != null
              ? formatMoney(activity.ledger.reportedDeposits, currency)
              : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
          <dt>Parsed credits</dt>
          <dd className="tabular-nums">
            {formatMoney(activity.moneyIn, currency)}
          </dd>
        </div>
        <div className="flex justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
          <dt>Bank withdrawals</dt>
          <dd className="tabular-nums">
            {activity.ledger.reportedWithdrawals != null
              ? formatMoney(activity.ledger.reportedWithdrawals, currency)
              : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
          <dt>Parsed debits</dt>
          <dd className="tabular-nums">
            {formatMoney(activity.moneyOut, currency)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function DetailedMoneyIn({
  activity,
  formatMoney,
}: {
  activity: StatementActivitySummary;
  formatMoney: (n: number, c: string) => string;
}) {
  const rows = activity.moneyInCategories.filter((c) => c.transactionCount > 0);
  if (!rows.length) return null;
  return (
    <div id="money-received">
      <h3 className="text-sm font-semibold uppercase tracking-widest text-white/50">
        Money received breakdown
      </h3>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {rows.map((cat) => (
          <li
            key={cat.id}
            className="rounded-2xl border border-sky-400/15 bg-sky-500/[0.05] p-4"
          >
            <p className="font-semibold text-white">{cat.label}</p>
            <p className="mt-1 text-sm tabular-nums text-white/70">
              {formatMoney(cat.total, activity.currency)} ·{" "}
              {cat.transactionCount} deposit
              {cat.transactionCount === 1 ? "" : "s"}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetailedBills({
  activity,
  formatMoney,
}: {
  activity: StatementActivitySummary;
  formatMoney: (n: number, c: string) => string;
}) {
  if (!activity.billProviderGroups.length && !activity.billCards.length) {
    return null;
  }
  return (
    <div id="expected-bills-detail">
      <h3 className="text-sm font-semibold uppercase tracking-widest text-white/50">
        Detailed bills
      </h3>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {activity.billProviderGroups.length
          ? activity.billProviderGroups.map((group) => (
              <li
                key={group.id}
                className="rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.05] p-4"
              >
                <p className="font-semibold text-white">{group.providerName}</p>
                <p className="mt-1 text-sm tabular-nums text-white/70">
                  {formatMoney(group.totalObserved, group.currency)} total
                  observed
                </p>
                <p className="mt-2 text-xs leading-relaxed text-white/45">
                  {group.observationNote}
                </p>
                <ul className="mt-3 space-y-2 border-t border-white/10 pt-3">
                  {group.services.map((svc) => (
                    <li key={svc.id} className="text-sm">
                      <p className="text-white/90">{svc.serviceLabel}</p>
                      <p className="tabular-nums text-white/60">
                        {formatMoney(svc.observedAmount, svc.currency)}
                      </p>
                      {svc.merchant ? (
                        <p
                          className="mt-0.5 truncate text-[10px] text-white/35"
                          title={svc.merchant}
                        >
                          Bank text: {svc.merchant}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))
          : activity.billCards.map((bill) => (
              <li
                key={bill.id}
                className="rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.05] p-4"
              >
                <p className="font-semibold text-white">
                  {bill.serviceLabel || bill.normalizedName}
                </p>
                <p className="mt-1 text-sm tabular-nums text-white/70">
                  {formatMoney(bill.observedAmount, bill.currency)}
                </p>
              </li>
            ))}
      </ul>
    </div>
  );
}

function DetailedSubscriptions({
  confirmed,
  possible,
  formatMoney,
}: {
  confirmed: StatementActivitySummary["subscriptionCards"];
  possible: StatementActivitySummary["subscriptionCards"];
  formatMoney: (n: number, c: string) => string;
}) {
  return (
    <div id="subscriptions-detail">
      <h3 className="text-sm font-semibold uppercase tracking-widest text-white/50">
        Subscription evidence
      </h3>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <SubList
          title="Confirmed"
          empty="None with enough repeat evidence yet."
          items={confirmed}
          formatMoney={formatMoney}
        />
        <SubList
          title="Possible"
          empty="No possible subscriptions in this window."
          items={possible}
          formatMoney={formatMoney}
        />
      </div>
    </div>
  );
}

function SubList({
  title,
  empty,
  items,
  formatMoney,
}: {
  title: string;
  empty: string;
  items: StatementActivitySummary["subscriptionCards"];
  formatMoney: (n: number, c: string) => string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-sm font-semibold text-white">{title}</p>
      {items.length ? (
        <ul className="mt-3 space-y-2">
          {items.map((sub) => (
            <li
              key={sub.id}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
            >
              <p className="font-medium text-white">{sub.normalizedName}</p>
              <p className="mt-0.5 text-xs text-white/50">
                {sub.chargeCount} charge{sub.chargeCount === 1 ? "" : "s"} ·{" "}
                {formatMoney(sub.periodTotal, sub.currency)}
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

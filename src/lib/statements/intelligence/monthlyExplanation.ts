/**
 * Deterministic month-explanation and educational debt guidance view-models.
 * Presentation-only — does not alter totals, Health Score, or reconciliation.
 */

import type { StatementPeriod } from "../types";
import type {
  StatementActivitySummary,
  StatementDebitCategoryId,
} from "./statementActivity";

export const ESSENTIAL_CATEGORY_IDS: StatementDebitCategoryId[] = [
  "housing",
  "bills",
  "insurance",
];

export const FINANCIAL_COMMITMENT_IDS: StatementDebitCategoryId[] = [
  "debt_financing",
];

/** Eligible for illustrative flexible-spending scenarios only. */
export const FLEXIBLE_SCENARIO_IDS: StatementDebitCategoryId[] = [
  "shopping",
  "dining",
  "food_delivery_rideshare",
  "fuel",
  "software_services",
  "subscriptions",
];

const NEVER_FLEXIBLE = new Set<StatementDebitCategoryId>([
  "housing",
  "bills",
  "insurance",
  "debt_financing",
  "transfers_payments",
  "fees",
]);

export type CashFlowOutcome =
  | "negative"
  | "positive"
  | "near_zero"
  | "unreliable"
  | "no_income"
  | "incomplete";

export type SpendingFactor = {
  id: string;
  label: string;
  total: number;
};

export type CommitmentGroup = {
  id: "essential" | "financial" | "flexible";
  title: string;
  description: string;
  total: number;
  transactionCount: number;
  lines: Array<{ label: string; total: number; count: number }>;
};

export type MonthlyExplanation = {
  outcome: CashFlowOutcome;
  headline: string;
  supportingLines: string[];
  topFactors: SpendingFactor[];
  periodNote: string | null;
  healthCashFlowClarification: string | null;
  /** Extra block for reliable negative months. */
  whyNegative: {
    title: string;
    paragraphs: string[];
  } | null;
  subscriptionSummary: {
    confirmedCount: number;
    possibleCount: number;
    otherDigitalChargeCount: number;
    summaryLine: string;
  };
  commitmentGroups: CommitmentGroup[];
  compareLastMonth: {
    ctaLabel: string;
    message: string;
    comparisonCalculated: boolean;
  };
};

export type SpendingScenarioPercent = 5 | 10 | 15;

export type SpendingScenario = {
  percent: SpendingScenarioPercent;
  flexibleBase: number;
  illustrativeAmount: number;
  originalNet: number | null;
  remainingNet: number | null;
  arithmeticLines: string[];
  closesDeficit: boolean;
  eligible: boolean;
  disclaimer: string;
  exclusionNote: string;
  periodScopeNote: string;
};

export type DebtCreditor = {
  name: string;
  total: number;
  count: number;
};

export type DebtGuidance = {
  totalPaid: number;
  transactionCount: number;
  creditors: DebtCreditor[];
  recurrenceNote: string | null;
  educationalOptions: string[];
  legalDisclaimer: string;
  refinanceTotalCostWarning: string;
  callScript: string;
  callScriptSafetyNote: string;
  compareChecklist: string[];
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function catTotal(
  activity: StatementActivitySummary,
  id: StatementDebitCategoryId
): number {
  return activity.categories.find((c) => c.id === id)?.total ?? 0;
}

function catCount(
  activity: StatementActivitySummary,
  id: StatementDebitCategoryId
): number {
  return activity.categories.find((c) => c.id === id)?.transactionCount ?? 0;
}

function sumIds(
  activity: StatementActivitySummary,
  ids: StatementDebitCategoryId[]
): { total: number; count: number } {
  let total = 0;
  let count = 0;
  for (const id of ids) {
    total += catTotal(activity, id);
    count += catCount(activity, id);
  }
  return { total: roundMoney(total), count };
}

export function periodLengthDays(
  period: StatementPeriod | null | undefined
): number | null {
  if (!period?.start || !period?.end) return null;
  const a = Date.parse(`${period.start}T00:00:00Z`);
  const b = Date.parse(`${period.end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

export function periodLengthNote(
  period: StatementPeriod | null | undefined
): string | null {
  const days = periodLengthDays(period);
  if (days == null) return null;
  if (days < 25) {
    return `This statement covers about ${days} days—shorter than a typical month.`;
  }
  if (days > 40) {
    return `This statement covers about ${days} days—longer than a typical month.`;
  }
  return null;
}

function formatUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Build plain-English month explanation from exclusive statement categories.
 */
export function buildMonthlyExplanation(input: {
  activity: StatementActivitySummary;
  statementPeriod?: StatementPeriod | null;
  healthScore?: number | null;
  formatMoney?: (n: number, currency: string) => string;
}): MonthlyExplanation {
  const { activity } = input;
  const money = input.formatMoney ?? ((n) => formatUsd(n));
  const currency = activity.currency || "USD";
  const periodNote = periodLengthNote(input.statementPeriod ?? null);

  const essential = sumIds(activity, ESSENTIAL_CATEGORY_IDS);
  const debt = sumIds(activity, FINANCIAL_COMMITMENT_IDS);
  const shopping = catTotal(activity, "shopping");
  const food =
    catTotal(activity, "dining") + catTotal(activity, "food_delivery_rideshare");
  const fuel = catTotal(activity, "fuel");
  const digital = roundMoney(
    catTotal(activity, "software_services") + catTotal(activity, "subscriptions")
  );

  const factorCandidates: SpendingFactor[] = [
    {
      id: "essential",
      label: "Housing and essential bills",
      total: essential.total,
    },
    {
      id: "debt",
      label: "Debt and financing payments",
      total: debt.total,
    },
    { id: "shopping", label: "Shopping", total: roundMoney(shopping) },
    {
      id: "food",
      label: "Food and dining",
      total: roundMoney(food),
    },
    {
      id: "fuel",
      label: "Fuel and transportation",
      total: roundMoney(fuel),
    },
    {
      id: "digital",
      label: "Subscriptions and digital services",
      total: digital,
    },
  ].filter((f) => f.total > 0);

  const topFactors = [...factorCandidates]
    .sort((a, b) => b.total - a.total)
    .slice(0, 4);

  const commitmentGroups = buildCommitmentGroups(activity);
  const compareLastMonth = {
    ctaLabel: "Compare with another statement",
    message:
      "Upload the previous statement from the same account below. Brainy will compare money in, money out, bills, subscriptions, debt payments and flexible spending. Both PDFs stay in this browser session only.",
    comparisonCalculated: false as boolean,
  };

  const reliable =
    activity.cashFlowReliable &&
    activity.ledger.status === "reconciled" &&
    activity.netCashFlow != null;

  let outcome: CashFlowOutcome;
  let headline: string;
  const supportingLines: string[] = [];

  if (!reliable) {
    outcome =
      activity.ledger.status === "unreconciled" || !activity.cashFlowReliable
        ? "unreliable"
        : "incomplete";
    headline =
      "Brainy cannot reliably explain the full monthly difference yet because some statement activity may be missing or misclassified.";
    supportingLines.push(
      "No definitive cause is shown until money in and money out line up with the bank summary."
    );
  } else if (activity.moneyIn <= 0 && activity.moneyOut > 0) {
    outcome = "no_income";
    headline = `Brainy did not detect money received on this statement, while spending totaled ${money(activity.moneyOut, currency)}.`;
    supportingLines.push(
      "Without detected deposits, Brainy cannot explain a full income-versus-spending difference for this window."
    );
  } else {
    const net = activity.netCashFlow!;
    const abs = Math.abs(net);
    const near =
      abs < 25 || (activity.moneyOut > 0 && abs / activity.moneyOut < 0.01);

    if (near) {
      outcome = "near_zero";
      headline =
        "Money received and money spent were nearly even during this statement period.";
    } else if (net < 0) {
      outcome = "negative";
      headline = `You spent ${money(abs, currency)} more than you received during this statement period.`;
    } else {
      outcome = "positive";
      headline = `You received ${money(abs, currency)} more than you spent during this statement period.`;
    }

    if (topFactors.length) {
      supportingLines.push("Your largest spending areas were:");
    }
  }

  if (periodNote) supportingLines.push(periodNote);

  const health = input.healthScore ?? null;
  const healthCashFlowClarification =
    reliable &&
    activity.netCashFlow != null &&
    activity.netCashFlow < 0 &&
    health != null &&
    health >= 85
      ? "Statement Health measures detected fees and patterns. Cash flow compares money received with money spent. A high Statement Health score does not mean the month had a positive cash flow."
      : null;

  const confirmedCount = activity.subscriptionCards.filter(
    (s) => s.status === "confirmed"
  ).length;
  const possibleCount = activity.subscriptionCards.filter(
    (s) => s.status === "possible"
  ).length;
  const otherDigitalChargeCount = countOtherDigitalCharges(activity);

  const whyNegative =
    reliable && outcome === "negative" && activity.netCashFlow != null
      ? buildWhyNegative({
          activity,
          money,
          currency,
          essentialTotal: essential.total,
          debtTotal: debt.total,
          flexibleTotal: sumIds(activity, FLEXIBLE_SCENARIO_IDS).total,
          absDiff: Math.abs(activity.netCashFlow),
          shopping,
          food,
          fuel,
          digital,
        })
      : null;

  return {
    outcome,
    headline,
    supportingLines,
    topFactors: reliable ? topFactors : [],
    periodNote,
    healthCashFlowClarification,
    whyNegative,
    subscriptionSummary: {
      confirmedCount,
      possibleCount,
      otherDigitalChargeCount,
      summaryLine: formatSubscriptionSummaryLine(
        confirmedCount,
        possibleCount,
        otherDigitalChargeCount
      ),
    },
    commitmentGroups,
    compareLastMonth,
  };
}

function formatSubscriptionSummaryLine(
  confirmed: number,
  possible: number,
  otherDigital: number
): string {
  if (otherDigital > 0) {
    return `${confirmed} confirmed subscription${confirmed === 1 ? "" : "s"} · ${possible} possible · ${otherDigital} other digital/service charge${otherDigital === 1 ? "" : "s"} (recurrence not confirmed for possible items).`;
  }
  return `${confirmed} confirmed subscription${confirmed === 1 ? "" : "s"} · ${possible} possible (recurrence not confirmed for possible items).`;
}

function countOtherDigitalCharges(activity: StatementActivitySummary): number {
  const software = activity.categories.find((c) => c.id === "software_services");
  if (!software) return 0;
  const possibleNames = new Set(
    activity.subscriptionCards
      .filter((s) => s.status === "possible" || s.status === "confirmed")
      .map((s) => s.normalizedName.trim().toUpperCase())
  );
  return software.transactions.filter(
    (t) => !possibleNames.has(t.normalizedName.trim().toUpperCase())
  ).length;
}

function buildWhyNegative(args: {
  activity: StatementActivitySummary;
  money: (n: number, c: string) => string;
  currency: string;
  essentialTotal: number;
  debtTotal: number;
  flexibleTotal: number;
  absDiff: number;
  shopping: number;
  food: number;
  fuel: number;
  digital: number;
}): { title: string; paragraphs: string[] } {
  const {
    money,
    currency,
    essentialTotal,
    debtTotal,
    flexibleTotal,
    absDiff,
    shopping,
    food,
    fuel,
    digital,
  } = args;
  const flexibleParts = [
    { label: "shopping", total: shopping },
    { label: "food and dining", total: food },
    { label: "fuel", total: fuel },
    { label: "digital services", total: digital },
  ]
    .filter((p) => p.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  const flexList = flexibleParts
    .map((p) => `${p.label} (${money(p.total, currency)})`)
    .join(", ");

  return {
    title: "Why this period ended negative",
    paragraphs: [
      `You spent ${money(absDiff, currency)} more than was received.`,
      `Essential commitments were ${money(essentialTotal, currency)} and debt/financing payments were ${money(debtTotal, currency)}—together a large share of money received.`,
      flexibleParts.length
        ? `The largest flexible areas observed were ${flexList}, totaling ${money(flexibleTotal, currency)} in flexible spending.`
        : `Flexible spending totaled ${money(flexibleTotal, currency)}.`,
      "This explains the cash-flow difference. It does not mean you are financially unhealthy.",
    ],
  };
}

export function buildCommitmentGroups(
  activity: StatementActivitySummary
): CommitmentGroup[] {
  const essentialLines = [
    { id: "housing" as const, label: "Housing" },
    { id: "bills" as const, label: "Utilities / phone / internet" },
    { id: "insurance" as const, label: "Insurance" },
  ]
    .map((row) => ({
      label: row.label,
      total: catTotal(activity, row.id),
      count: catCount(activity, row.id),
    }))
    .filter((r) => r.count > 0);

  const essentialSum = sumIds(activity, ESSENTIAL_CATEGORY_IDS);

  const debtCat = activity.categories.find((c) => c.id === "debt_financing");
  const financialLines = (debtCat?.topMerchants ?? []).map((m) => ({
    label: m.name,
    total: m.total,
    count: m.count,
  }));
  const financialSum = sumIds(activity, FINANCIAL_COMMITMENT_IDS);

  const flexibleLines = [
    { id: "shopping" as const, label: "Shopping" },
    { id: "dining" as const, label: "Dining" },
    { id: "food_delivery_rideshare" as const, label: "Delivery / rideshare" },
    { id: "fuel" as const, label: "Fuel" },
  ]
    .map((row) => ({
      label: row.label,
      total: catTotal(activity, row.id),
      count: catCount(activity, row.id),
    }))
    .filter((r) => r.count > 0);

  const digitalTotal = roundMoney(
    catTotal(activity, "software_services") + catTotal(activity, "subscriptions")
  );
  const digitalCount =
    catCount(activity, "software_services") +
    catCount(activity, "subscriptions");
  if (digitalCount > 0) {
    flexibleLines.push({
      label: "Digital services & subscriptions",
      total: digitalTotal,
      count: digitalCount,
    });
  }

  const flexibleSum = sumIds(activity, FLEXIBLE_SCENARIO_IDS);

  return [
    {
      id: "essential",
      title: "Essential commitments",
      description: "Housing, utilities, phone/internet, and insurance.",
      total: essentialSum.total,
      transactionCount: essentialSum.count,
      lines: essentialLines,
    },
    {
      id: "financial",
      title: "Financial commitments",
      description: "Credit cards, installment payments, loans, and financing.",
      total: financialSum.total,
      transactionCount: financialSum.count,
      lines: financialLines,
    },
    {
      id: "flexible",
      title: "Flexible spending",
      description:
        "Shopping, dining, delivery/rideshare, fuel, and optional services you may choose to review.",
      total: flexibleSum.total,
      transactionCount: flexibleSum.count,
      lines: flexibleLines,
    },
  ];
}

/**
 * Illustrative % change on flexible categories only.
 * Never annualizes from a single statement window.
 */
export function buildSpendingScenario(input: {
  activity: StatementActivitySummary;
  percent: SpendingScenarioPercent;
  formatMoney?: (n: number, currency: string) => string;
}): SpendingScenario {
  const { activity, percent } = input;
  void input.formatMoney;

  const exclusionNote =
    "Excludes housing, utilities, insurance, debt payments, transfers, fees already charged, and income.";

  const periodScopeNote =
    "This figure applies only to the flexible spending observed in this statement period—not a monthly or annual projection.";

  const disclaimer = "Illustrative scenario — not guaranteed savings.";

  const reliable =
    activity.cashFlowReliable && activity.ledger.status === "reconciled";

  if (!reliable) {
    return {
      percent,
      flexibleBase: 0,
      illustrativeAmount: 0,
      originalNet: null,
      remainingNet: null,
      arithmeticLines: [],
      closesDeficit: false,
      eligible: false,
      disclaimer,
      exclusionNote,
      periodScopeNote:
        "Scenarios are hidden while statement totals are not yet reliable.",
    };
  }

  // Guard: never include never-flexible ids
  const ids = FLEXIBLE_SCENARIO_IDS.filter((id) => !NEVER_FLEXIBLE.has(id));
  const { total: flexibleBase } = sumIds(activity, ids);
  const illustrativeAmount = roundMoney(flexibleBase * (percent / 100));
  const originalNet =
    activity.netCashFlow != null ? roundMoney(activity.netCashFlow) : null;
  const remainingNet =
    originalNet != null
      ? roundMoney(originalNet + illustrativeAmount)
      : null;
  const closesDeficit =
    originalNet != null &&
    originalNet < 0 &&
    remainingNet != null &&
    remainingNet >= 0;

  const arithmeticLines =
    flexibleBase > 0
      ? [
          `${percent}% of ${flexibleBase.toFixed(2)} = ${illustrativeAmount.toFixed(2)}`,
          originalNet != null
            ? `Original difference: ${originalNet.toFixed(2)}`
            : "",
          remainingNet != null
            ? `Illustrative difference after reduction: ${remainingNet.toFixed(2)}`
            : "",
        ].filter(Boolean)
      : [];

  return {
    percent,
    flexibleBase,
    illustrativeAmount,
    originalNet,
    remainingNet,
    arithmeticLines,
    closesDeficit,
    eligible: flexibleBase > 0,
    disclaimer,
    exclusionNote,
    periodScopeNote,
  };
}

/** Child flexible lines must sum to the group total (no silent omissions). */
export function flexibleChildTotalsMatchGroup(
  group: CommitmentGroup
): boolean {
  if (group.id !== "flexible") return true;
  const sum = roundMoney(group.lines.reduce((s, l) => s + l.total, 0));
  return Math.abs(sum - group.total) < 0.01;
}

export function summarizeAttProvider(activity: StatementActivitySummary): {
  total: number;
  chargeCount: number;
  amounts: number[];
  note: string;
} | null {
  const group = activity.billProviderGroups.find((g) => g.providerKey === "att");
  if (!group) return null;
  return {
    total: group.totalObserved,
    chargeCount: group.serviceCount,
    amounts: group.services.map((s) => s.observedAmount),
    note:
      group.serviceCount > 1
        ? "Two AT&T service charges were detected. Service type not fully confirmed."
        : "AT&T charge observed on this statement.",
  };
}

export const DEBT_LEGAL_DISCLAIMER =
  "Educational information only. Brainy does not provide legal, credit, debt-settlement, tax, or financial advice. Eligibility and outcomes depend on the provider and your circumstances.";

export const DEBT_REFINANCE_WARNING =
  "A lower monthly payment can result from a longer repayment term and may increase the total amount paid. Compare APR, fees, term length and total repayment—not only the monthly payment.";

export const DEBT_CALL_SCRIPT = `Hello, I’m reviewing my monthly expenses and would like to understand whether my account has any options for lowering its cost. Could you please explain:

- My current interest rate and fees
- Whether I qualify for a lower rate
- Whether any recent fee can be reviewed
- Whether I can change my due date
- Whether you offer a hardship or payment-assistance program
- How any change would affect my total repayment cost

Please provide the terms in writing before I agree to any change.`;

export const DEBT_CALL_SAFETY =
  "Do not share passwords, PINs, one-time security codes or full account numbers.";

export const DEBT_COMPARE_CHECKLIST = [
  "APR",
  "Origination or transfer fees",
  "Promotional-rate expiration",
  "Monthly payment",
  "Number of payments",
  "Total repayment amount",
  "Variable vs fixed rate",
  "Late-payment consequences",
  "Prepayment penalty",
  "Effect of closing an account, when applicable",
] as const;

export const DEBT_EDUCATIONAL_OPTIONS = [
  "Ask about a lower interest rate",
  "Ask whether a fee can be waived",
  "Ask about changing the due date",
  "Ask whether a hardship or payment-assistance plan exists",
  "Compare consolidation, refinancing or balance-transfer options",
] as const;

/**
 * Observed debt facts only — never invents APR, balance, or eligibility.
 */
export function buildDebtGuidance(
  activity: StatementActivitySummary
): DebtGuidance | null {
  const debt = activity.categories.find((c) => c.id === "debt_financing");
  if (!debt || debt.total <= 0 || debt.transactionCount <= 0) return null;

  const creditors: DebtCreditor[] = debt.topMerchants.map((m) => ({
    name: m.name,
    total: m.total,
    count: m.count,
  }));

  // Recurrence only when multiple charges for same creditor in this window
  const recurring = creditors.filter((c) => c.count >= 2);
  const recurrenceNote =
    recurring.length > 0
      ? `More than one payment appeared for: ${recurring
          .map((c) => c.name)
          .join(", ")}. That suggests repeated financing activity in this window—not a confirmed long-term schedule.`
      : null;

  return {
    totalPaid: debt.total,
    transactionCount: debt.transactionCount,
    creditors,
    recurrenceNote,
    educationalOptions: [...DEBT_EDUCATIONAL_OPTIONS],
    legalDisclaimer: DEBT_LEGAL_DISCLAIMER,
    refinanceTotalCostWarning: DEBT_REFINANCE_WARNING,
    callScript: DEBT_CALL_SCRIPT,
    callScriptSafetyNote: DEBT_CALL_SAFETY,
    compareChecklist: [...DEBT_COMPARE_CHECKLIST],
  };
}

/** Assert scenario base never includes excluded categories. */
export function flexibleScenarioExcludesProtectedCategories(): boolean {
  return FLEXIBLE_SCENARIO_IDS.every((id) => !NEVER_FLEXIBLE.has(id));
}

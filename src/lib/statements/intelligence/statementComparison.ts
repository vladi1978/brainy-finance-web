/**
 * Deterministic two-statement comparison view-model.
 * Presentation-only — does not alter totals, Health Score formulas,
 * reconciliation, or parser output.
 */

import type { StatementPeriod } from "../types";
import { presentationMerchantDisplayName } from "../presentationMerchantDisplay";
import type {
  StatementActivitySummary,
  StatementDebitCategoryId,
  StatementSubscriptionCard,
} from "./statementActivity";
import {
  ESSENTIAL_CATEGORY_IDS,
  FLEXIBLE_SCENARIO_IDS,
  FINANCIAL_COMMITMENT_IDS,
} from "./monthlyExplanation";

/**
 * Materiality and percentage-baseline gates (documented for UX Step 4).
 *
 * - MIN_DOLLAR_DELTA: ignore tiny absolute moves in ranked findings.
 * - MIN_PERCENT_DELTA: when a safe baseline exists, also require this relative move.
 * - MIN_PERCENT_BASELINE: never compute % when previous amount is below this.
 * - MIN_ACTIVITY_TRANSACTIONS: both statements need at least this many accepted txns.
 * - NEAR_UNCHANGED_SPEND: spending treated as “nearly unchanged” under this abs delta.
 * - BILL_MATERIAL_DOLLAR / SUB_MATERIAL_DOLLAR: merchant/provider highlight floors.
 */
export const COMPARISON_MATERIALITY = {
  MIN_DOLLAR_DELTA: 25,
  MIN_PERCENT_DELTA: 0.08,
  MIN_PERCENT_BASELINE: 50,
  MIN_ACTIVITY_TRANSACTIONS: 3,
  NEAR_UNCHANGED_SPEND: 15,
  BILL_MATERIAL_DOLLAR: 15,
  SUB_MATERIAL_DOLLAR: 5,
  FLEXIBLE_REVIEW_DOLLAR: 40,
} as const;

export type ComparisonStatus =
  | "ready"
  | "same_statement"
  | "provisional"
  | "unavailable";

export type ComparisonConfidence = "high" | "medium" | "low" | "none";

export type ChangeDirection =
  | "increased"
  | "decreased"
  | "unchanged"
  | "new"
  | "no-longer-observed";

export type MoneyDelta = {
  previous: number;
  current: number;
  dollarDelta: number;
  /** Null when previous baseline is too small / zero. */
  percentDelta: number | null;
  direction: ChangeDirection;
};

export type CategoryChange = {
  id: StatementDebitCategoryId | "digital_combined";
  label: string;
  previous: number;
  current: number;
  dollarDelta: number;
  percentDelta: number | null;
  previousCount: number;
  currentCount: number;
  direction: ChangeDirection;
  evidence: string;
  isFlexible: boolean;
  isEssential: boolean;
  isDebt: boolean;
};

export type MerchantChangeKind =
  | "bill_increased"
  | "bill_decreased"
  | "bill_new"
  | "bill_not_observed"
  | "subscription_new"
  | "subscription_not_observed"
  | "subscription_amount_changed"
  | "flexible_merchant";

export type MerchantChange = {
  id: string;
  kind: MerchantChangeKind;
  displayName: string;
  previous: number | null;
  current: number | null;
  dollarDelta: number | null;
  evidence: string;
  nextStep: string | null;
};

export type RankedFinding = {
  id: string;
  title: string;
  previous: number | null;
  current: number | null;
  dollarDelta: number | null;
  evidence: string;
  nextStep: string | null;
  priority: number;
};

export type StatementHealthSnapshot = {
  score: number;
  label: string;
  provisional?: boolean;
  displayMode?: "numeric" | "provisional" | "suppressed";
};

export type StatementComparisonInput = {
  /**
   * Upload-slot sides. Labels do not imply chronology — Brainy reorders by
   * normalized period dates before any delta is computed.
   */
  previous: StatementActivitySummary;
  current: StatementActivitySummary;
  previousPeriod: StatementPeriod | null;
  currentPeriod: StatementPeriod | null;
  /** Display-only — never recomputed or combined. */
  previousHealth?: StatementHealthSnapshot | null;
  currentHealth?: StatementHealthSnapshot | null;
};

export type ChronologyOrderedSide = {
  activity: StatementActivitySummary;
  period: StatementPeriod;
  health: StatementHealthSnapshot | null;
};

export type ChronologyResolution =
  | {
      ok: true;
      earlier: ChronologyOrderedSide;
      later: ChronologyOrderedSide;
      /** False when the upload "previous" slot was actually the later period. */
      uploadMatchedChronology: boolean;
    }
  | {
      ok: false;
      reason: string;
    };

export type StatementComparisonResult = {
  status: ComparisonStatus;
  confidence: ComparisonConfidence;
  statusReason: string;
  previousPeriod: StatementPeriod | null;
  currentPeriod: StatementPeriod | null;
  previousDays: number | null;
  currentDays: number | null;
  previousFingerprint: string;
  currentFingerprint: string;
  /** True when upload slots already matched earlier→later chronology. */
  uploadMatchedChronology: boolean;
  chronologyNote: string | null;
  moneyReceived: MoneyDelta;
  moneySpent: MoneyDelta;
  netCashFlow: {
    available: boolean;
    previous: number | null;
    current: number | null;
    dollarDelta: number | null;
    percentDelta: number | null;
    direction: ChangeDirection | null;
    unavailableReason: string | null;
  };
  categories: CategoryChange[];
  merchantChanges: MerchantChange[];
  rankedFindings: RankedFinding[];
  summarySentence: string;
  healthNote: string;
  previousHealth: StatementHealthSnapshot | null;
  currentHealth: StatementHealthSnapshot | null;
  provisionalNotes: string[];
  educationalFlexibleNotes: string[];
};

const COMPARISON_CATEGORY_ORDER: Array<{
  id: StatementDebitCategoryId;
  label: string;
}> = [
  { id: "housing", label: "Housing" },
  { id: "bills", label: "Bills & utilities" },
  { id: "insurance", label: "Insurance" },
  { id: "debt_financing", label: "Debt & financing" },
  { id: "shopping", label: "Shopping" },
  { id: "dining", label: "Dining" },
  { id: "food_delivery_rideshare", label: "Delivery / rideshare" },
  { id: "fuel", label: "Fuel / transportation" },
  { id: "software_services", label: "Digital services" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "transfers_payments", label: "Transfers" },
  { id: "fees", label: "Fees" },
  { id: "other", label: "Other / unclassified" },
  { id: "professional_services", label: "Professional services" },
];

const ESSENTIAL_SET = new Set<string>(ESSENTIAL_CATEGORY_IDS);
const FLEXIBLE_SET = new Set<string>(FLEXIBLE_SCENARIO_IDS);
const DEBT_SET = new Set<string>(FINANCIAL_COMMITMENT_IDS);

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function periodDays(period: StatementPeriod | null): number | null {
  if (!period?.start || !period?.end) return null;
  const a = Date.parse(`${period.start}T12:00:00Z`);
  const b = Date.parse(`${period.end}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const days = Math.floor(Math.abs(b - a) / 86_400_000) + 1;
  return days > 0 ? days : null;
}

function hasValidPeriod(period: StatementPeriod | null): boolean {
  return Boolean(period?.start && period?.end && period.start <= period.end);
}

/** Normalize so start ≤ end without inventing missing dates. */
export function normalizePeriodBounds(
  period: StatementPeriod | null
): StatementPeriod | null {
  if (!period?.start || !period?.end) return null;
  if (period.start <= period.end) {
    return { start: period.start, end: period.end };
  }
  return { start: period.end, end: period.start };
}

function inclusiveOverlapDays(a: StatementPeriod, b: StatementPeriod): number {
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  if (start > end) return 0;
  const ms =
    Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`);
  if (!Number.isFinite(ms)) return 0;
  return Math.floor(ms / 86_400_000) + 1;
}

/**
 * Resolve earlier/later sides from period dates. Upload slot order is ignored.
 * Overlapping, identical, or unorderable periods fail closed.
 */
export function resolveComparisonChronology(
  input: StatementComparisonInput
): ChronologyResolution {
  const slotPrevious = normalizePeriodBounds(input.previousPeriod);
  const slotCurrent = normalizePeriodBounds(input.currentPeriod);

  if (!slotPrevious || !slotCurrent) {
    return {
      ok: false,
      reason:
        "Both statements need a detectable start and end date before Brainy can order them chronologically.",
    };
  }

  if (
    slotPrevious.start === slotCurrent.start &&
    slotPrevious.end === slotCurrent.end
  ) {
    return {
      ok: false,
      reason:
        "These statement periods look the same, so Brainy cannot tell which is earlier. Upload two different periods.",
    };
  }

  const overlap = inclusiveOverlapDays(slotPrevious, slotCurrent);
  if (overlap > 0) {
    return {
      ok: false,
      reason:
        "These statement periods overlap, so Brainy cannot safely decide which is earlier or later. Upload two non-overlapping periods.",
    };
  }

  // Strict chronological order: earlier ends before later starts.
  const previousEndsBeforeCurrent = slotPrevious.end < slotCurrent.start;
  const currentEndsBeforePrevious = slotCurrent.end < slotPrevious.start;

  if (previousEndsBeforeCurrent) {
    return {
      ok: true,
      uploadMatchedChronology: true,
      earlier: {
        activity: input.previous,
        period: slotPrevious,
        health: input.previousHealth ?? null,
      },
      later: {
        activity: input.current,
        period: slotCurrent,
        health: input.currentHealth ?? null,
      },
    };
  }

  if (currentEndsBeforePrevious) {
    return {
      ok: true,
      uploadMatchedChronology: false,
      earlier: {
        activity: input.current,
        period: slotCurrent,
        health: input.currentHealth ?? null,
      },
      later: {
        activity: input.previous,
        period: slotPrevious,
        health: input.previousHealth ?? null,
      },
    };
  }

  return {
    ok: false,
    reason:
      "Brainy could not safely order these statement periods by date. Upload two clearly sequential periods.",
  };
}

/**
 * Sanitized deterministic fingerprint — no raw PDF bytes.
 * Uses period, counts, totals, and stable sorted transaction facts.
 */
export function buildStatementFingerprint(
  activity: StatementActivitySummary,
  period: StatementPeriod | null
): string {
  const facts: string[] = [];
  for (const cat of activity.categories) {
    for (const t of cat.transactions) {
      facts.push(
        `d|${t.date}|${roundMoney(t.amount).toFixed(2)}|${sanitizeFactKey(t.normalizedName)}|${t.categoryId}`
      );
    }
  }
  for (const cat of activity.moneyInCategories) {
    for (const t of cat.transactions) {
      facts.push(
        `c|${t.date}|${roundMoney(t.amount).toFixed(2)}|${sanitizeFactKey(t.normalizedName)}|${t.categoryId}`
      );
    }
  }
  facts.sort();
  const payload = [
    `p:${period?.start ?? ""}:${period?.end ?? ""}`,
    `n:${activity.transactionCount}`,
    `in:${roundMoney(activity.moneyIn).toFixed(2)}`,
    `out:${roundMoney(activity.moneyOut).toFixed(2)}`,
    ...facts,
  ].join("\n");
  return simpleHash(payload);
}

function sanitizeFactKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, " ")
    .trim()
    .slice(0, 48);
}

/** FNV-1a 32-bit hex — deterministic, no crypto dependency. */
function simpleHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function evaluateComparisonEligibility(input: {
  previous: StatementActivitySummary;
  current: StatementActivitySummary;
  previousPeriod: StatementPeriod | null;
  currentPeriod: StatementPeriod | null;
}): {
  status: ComparisonStatus;
  confidence: ComparisonConfidence;
  reason: string;
  previousFingerprint: string;
  currentFingerprint: string;
  provisionalNotes: string[];
} {
  const previousFingerprint = buildStatementFingerprint(
    input.previous,
    input.previousPeriod
  );
  const currentFingerprint = buildStatementFingerprint(
    input.current,
    input.currentPeriod
  );

  if (
    !hasValidPeriod(input.previousPeriod) ||
    !hasValidPeriod(input.currentPeriod)
  ) {
    return {
      status: "unavailable",
      confidence: "none",
      reason:
        "Both statements need a detectable start and end date before Brainy can compare them.",
      previousFingerprint,
      currentFingerprint,
      provisionalNotes: [],
    };
  }

  if (previousFingerprint === currentFingerprint) {
    return {
      status: "same_statement",
      confidence: "none",
      reason:
        "These uploads look like the same statement. Upload a different previous period to compare.",
      previousFingerprint,
      currentFingerprint,
      provisionalNotes: [],
    };
  }

  const prevCount = input.previous.transactionCount;
  const currCount = input.current.transactionCount;
  if (
    prevCount < COMPARISON_MATERIALITY.MIN_ACTIVITY_TRANSACTIONS ||
    currCount < COMPARISON_MATERIALITY.MIN_ACTIVITY_TRANSACTIONS
  ) {
    return {
      status: "unavailable",
      confidence: "none",
      reason:
        "One or both statements do not have enough accepted activity to support a useful comparison.",
      previousFingerprint,
      currentFingerprint,
      provisionalNotes: [],
    };
  }

  const prevOk =
    input.previous.cashFlowReliable &&
    input.previous.ledger.status === "reconciled";
  const currOk =
    input.current.cashFlowReliable &&
    input.current.ledger.status === "reconciled";

  const provisionalNotes: string[] = [];
  if (!prevOk) {
    provisionalNotes.push(
      `Previous statement ledger is ${input.previous.ledger.status} — differences are observed carefully, not definitive causes.`
    );
  }
  if (!currOk) {
    provisionalNotes.push(
      `Current statement ledger is ${input.current.ledger.status} — differences are observed carefully, not definitive causes.`
    );
  }

  if (prevOk && currOk) {
    return {
      status: "ready",
      confidence: "high",
      reason: "Both statements reconciled with enough activity for a reliable comparison.",
      previousFingerprint,
      currentFingerprint,
      provisionalNotes: [],
    };
  }

  // Partially reconciled: allow careful observed diffs.
  if (
    input.previous.ledger.status !== "unreconciled" ||
    input.current.ledger.status !== "unreconciled"
  ) {
    return {
      status: "provisional",
      confidence: "medium",
      reason:
        "At least one statement is not fully reconciled. Brainy shows observed differences without definitive cause language.",
      previousFingerprint,
      currentFingerprint,
      provisionalNotes,
    };
  }

  return {
    status: "provisional",
    confidence: "low",
    reason:
      "Ledger totals do not fully line up on one or both statements. Comparison is provisional.",
    previousFingerprint,
    currentFingerprint,
    provisionalNotes,
  };
}

function moneyDelta(previous: number, current: number): MoneyDelta {
  const dollarDelta = roundMoney(current - previous);
  const percentDelta =
    Math.abs(previous) >= COMPARISON_MATERIALITY.MIN_PERCENT_BASELINE
      ? roundMoney((dollarDelta / Math.abs(previous)) * 100)
      : null;
  let direction: ChangeDirection = "unchanged";
  if (previous <= 0 && current > 0) direction = "new";
  else if (previous > 0 && current <= 0) direction = "no-longer-observed";
  else if (dollarDelta > 0.009) direction = "increased";
  else if (dollarDelta < -0.009) direction = "decreased";
  return { previous, current, dollarDelta, percentDelta, direction };
}

function catTotal(
  activity: StatementActivitySummary,
  id: StatementDebitCategoryId
): { total: number; count: number } {
  const cat = activity.categories.find((c) => c.id === id);
  return { total: cat?.total ?? 0, count: cat?.transactionCount ?? 0 };
}

function isMaterialChange(
  previous: number,
  dollarDelta: number,
  percentDelta: number | null
): boolean {
  const abs = Math.abs(dollarDelta);
  if (abs < COMPARISON_MATERIALITY.MIN_DOLLAR_DELTA) return false;
  if (Math.abs(previous) < COMPARISON_MATERIALITY.MIN_PERCENT_BASELINE) {
    return abs >= COMPARISON_MATERIALITY.MIN_DOLLAR_DELTA;
  }
  if (percentDelta == null) return abs >= COMPARISON_MATERIALITY.MIN_DOLLAR_DELTA;
  return (
    abs >= COMPARISON_MATERIALITY.MIN_DOLLAR_DELTA &&
    Math.abs(percentDelta) / 100 >= COMPARISON_MATERIALITY.MIN_PERCENT_DELTA
  );
}

function buildCategoryChanges(
  previous: StatementActivitySummary,
  current: StatementActivitySummary
): CategoryChange[] {
  const rows: CategoryChange[] = [];
  for (const def of COMPARISON_CATEGORY_ORDER) {
    const prev = catTotal(previous, def.id);
    const curr = catTotal(current, def.id);
    if (prev.count === 0 && curr.count === 0) continue;
    const delta = moneyDelta(prev.total, curr.total);
    let direction = delta.direction;
    if (prev.total <= 0 && curr.total > 0) direction = "new";
    if (prev.total > 0 && curr.total <= 0) direction = "no-longer-observed";
    rows.push({
      id: def.id,
      label: def.label,
      previous: prev.total,
      current: curr.total,
      dollarDelta: delta.dollarDelta,
      percentDelta: delta.percentDelta,
      previousCount: prev.count,
      currentCount: curr.count,
      direction,
      evidence: `${prev.count} charge${prev.count === 1 ? "" : "s"} previously → ${curr.count} now.`,
      isFlexible: FLEXIBLE_SET.has(def.id),
      isEssential: ESSENTIAL_SET.has(def.id),
      isDebt: DEBT_SET.has(def.id),
    });
  }
  return rows;
}

function providerKey(name: string): string {
  return presentationMerchantDisplayName(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, "")
    .slice(0, 32);
}

function buildMerchantChanges(
  previous: StatementActivitySummary,
  current: StatementActivitySummary
): MerchantChange[] {
  const out: MerchantChange[] = [];

  const prevBills = new Map(
    previous.billProviderGroups.map((g) => [g.providerKey, g])
  );
  const currBills = new Map(
    current.billProviderGroups.map((g) => [g.providerKey, g])
  );
  const billKeys = new Set([...prevBills.keys(), ...currBills.keys()]);

  for (const key of [...billKeys].sort()) {
    const p = prevBills.get(key);
    const c = currBills.get(key);
    const name = c?.providerName ?? p?.providerName ?? key;
    const displayName = presentationMerchantDisplayName(name);
    if (p && !c) {
      out.push({
        id: `bill-gone:${key}`,
        kind: "bill_not_observed",
        displayName,
        previous: p.totalObserved,
        current: null,
        dollarDelta: null,
        evidence: `Not observed in the current period (was ${p.totalObserved.toFixed(2)} ${p.currency}).`,
        nextStep: "Confirm whether the bill posts on a different date or account.",
      });
      continue;
    }
    if (!p && c) {
      out.push({
        id: `bill-new:${key}`,
        kind: "bill_new",
        displayName,
        previous: null,
        current: c.totalObserved,
        dollarDelta: c.totalObserved,
        evidence: `Newly observed in this period · ${c.totalObserved.toFixed(2)} ${c.currency}.`,
        nextStep: "Check whether this is an expected household bill for this period.",
      });
      continue;
    }
    if (p && c) {
      const dollarDelta = roundMoney(c.totalObserved - p.totalObserved);
      if (Math.abs(dollarDelta) < COMPARISON_MATERIALITY.BILL_MATERIAL_DOLLAR) {
        continue;
      }
      out.push({
        id: `bill-chg:${key}`,
        kind: dollarDelta > 0 ? "bill_increased" : "bill_decreased",
        displayName,
        previous: p.totalObserved,
        current: c.totalObserved,
        dollarDelta,
        evidence: `Amount changed by ${dollarDelta > 0 ? "+" : ""}${dollarDelta.toFixed(2)} ${c.currency}.`,
        nextStep:
          dollarDelta > 0
            ? "Review the bill details to see whether the change was expected."
            : null,
      });
    }
  }

  const prevSubs = indexSubs(previous.subscriptionCards);
  const currSubs = indexSubs(current.subscriptionCards);
  const subKeys = new Set([...prevSubs.keys(), ...currSubs.keys()]);
  for (const key of [...subKeys].sort()) {
    const p = prevSubs.get(key);
    const c = currSubs.get(key);
    const displayName = presentationMerchantDisplayName(
      c?.normalizedName ?? p?.normalizedName ?? key
    );
    if (p && !c) {
      out.push({
        id: `sub-gone:${key}`,
        kind: "subscription_not_observed",
        displayName,
        previous: p.periodTotal,
        current: null,
        dollarDelta: null,
        evidence: "Not observed in the current period.",
        nextStep: null,
      });
      continue;
    }
    if (!p && c) {
      out.push({
        id: `sub-new:${key}`,
        kind: "subscription_new",
        displayName,
        previous: null,
        current: c.periodTotal,
        dollarDelta: c.periodTotal,
        evidence: `Newly observed in this period · ${c.chargeCount} charge${c.chargeCount === 1 ? "" : "s"} · recurrence not confirmed.`,
        nextStep: "You decide whether this service still provides value.",
      });
      continue;
    }
    if (p && c) {
      const dollarDelta = roundMoney(c.periodTotal - p.periodTotal);
      if (Math.abs(dollarDelta) < COMPARISON_MATERIALITY.SUB_MATERIAL_DOLLAR) {
        continue;
      }
      out.push({
        id: `sub-chg:${key}`,
        kind: "subscription_amount_changed",
        displayName,
        previous: p.periodTotal,
        current: c.periodTotal,
        dollarDelta,
        evidence: `Amount changed by ${dollarDelta > 0 ? "+" : ""}${dollarDelta.toFixed(2)}.`,
        nextStep: null,
      });
    }
  }

  return out;
}

function indexSubs(
  cards: StatementSubscriptionCard[]
): Map<string, StatementSubscriptionCard> {
  const map = new Map<string, StatementSubscriptionCard>();
  for (const c of cards) {
    const key = providerKey(c.normalizedName || c.merchant);
    const prev = map.get(key);
    if (!prev || c.periodTotal > prev.periodTotal) map.set(key, c);
  }
  return map;
}

function buildRankedFindings(args: {
  status: ComparisonStatus;
  net: StatementComparisonResult["netCashFlow"];
  categories: CategoryChange[];
  merchants: MerchantChange[];
  moneySpent: MoneyDelta;
}): RankedFinding[] {
  const findings: RankedFinding[] = [];
  const definitive = args.status === "ready";

  if (
    definitive &&
    args.net.available &&
    args.net.dollarDelta != null &&
    args.net.dollarDelta < -COMPARISON_MATERIALITY.MIN_DOLLAR_DELTA
  ) {
    const currNet = args.net.current ?? 0;
    const prevNet = args.net.previous ?? 0;
    const title =
      currNet < 0 && prevNet >= 0
        ? "Net cash flow turned negative"
        : currNet < 0
          ? "Net cash flow moved further negative"
          : "Net cash flow decreased";
    findings.push({
      id: "net-worse",
      title,
      previous: args.net.previous,
      current: args.net.current,
      dollarDelta: args.net.dollarDelta,
      evidence: "Reliable net from both reconciled statements.",
      nextStep: "Review the biggest spending and income changes below.",
      priority: 10,
    });
  }

  for (const m of args.merchants) {
    if (m.kind === "bill_new" || m.kind === "bill_increased") {
      findings.push({
        id: m.id,
        title:
          m.kind === "bill_new"
            ? `${m.displayName} appeared as a new bill charge`
            : `${m.displayName} bill amount increased`,
        previous: m.previous,
        current: m.current,
        dollarDelta: m.dollarDelta,
        evidence: m.evidence,
        nextStep: m.nextStep,
        priority: m.kind === "bill_new" ? 20 : 21,
      });
    }
  }

  for (const m of args.merchants) {
    if (m.kind === "subscription_new") {
      findings.push({
        id: m.id,
        title: `${m.displayName} appeared as a possible subscription`,
        previous: m.previous,
        current: m.current,
        dollarDelta: m.dollarDelta,
        evidence: m.evidence,
        nextStep: m.nextStep,
        priority: 30,
      });
    }
  }

  for (const cat of args.categories) {
    if (!cat.isFlexible && !cat.isEssential) continue;
    if (cat.direction !== "increased" && cat.direction !== "new") continue;
    if (!isMaterialChange(cat.previous, cat.dollarDelta, cat.percentDelta)) {
      continue;
    }
    findings.push({
      id: `cat-up:${cat.id}`,
      title: `${cat.label} increased`,
      previous: cat.previous,
      current: cat.current,
      dollarDelta: cat.dollarDelta,
      evidence: cat.evidence,
      nextStep: cat.isFlexible
        ? `This category increased by ${Math.abs(cat.dollarDelta).toFixed(2)}. Reviewing the largest merchants could help you decide whether the change was expected.`
        : "Essential bills are shown for awareness—not as cancelable savings.",
      priority: cat.isEssential ? 22 : 40,
    });
  }

  const fee = args.categories.find((c) => c.id === "fees");
  if (
    fee &&
    (fee.direction === "new" || fee.direction === "increased") &&
    Math.abs(fee.dollarDelta) >= COMPARISON_MATERIALITY.MIN_DOLLAR_DELTA
  ) {
    findings.push({
      id: "fees-up",
      title: "Bank fees appeared or increased",
      previous: fee.previous,
      current: fee.current,
      dollarDelta: fee.dollarDelta,
      evidence: fee.evidence,
      nextStep: "Review fee lines on the current statement with your bank if unexpected.",
      priority: 50,
    });
  }

  for (const cat of args.categories) {
    if (!cat.isFlexible) continue;
    if (cat.direction !== "decreased") continue;
    if (!isMaterialChange(cat.previous, cat.dollarDelta, cat.percentDelta)) {
      continue;
    }
    findings.push({
      id: `cat-down:${cat.id}`,
      title: `${cat.label} decreased`,
      previous: cat.previous,
      current: cat.current,
      dollarDelta: cat.dollarDelta,
      evidence: cat.evidence,
      nextStep: null,
      priority: 60,
    });
  }

  // Stable deterministic order: priority asc, then abs dollar desc, then id.
  findings.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const ad = Math.abs(a.dollarDelta ?? 0);
    const bd = Math.abs(b.dollarDelta ?? 0);
    if (ad !== bd) return bd - ad;
    return a.id.localeCompare(b.id);
  });

  // De-dupe by id and cap at 5
  const seen = new Set<string>();
  const top: RankedFinding[] = [];
  for (const f of findings) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    top.push(f);
    if (top.length >= 5) break;
  }
  return top;
}

function buildSummarySentence(args: {
  status: ComparisonStatus;
  moneyReceived: MoneyDelta;
  moneySpent: MoneyDelta;
  net: StatementComparisonResult["netCashFlow"];
}): string {
  if (args.status === "same_statement") {
    return "Brainy cannot compare these uploads because they look like the same statement.";
  }
  if (args.status === "unavailable") {
    return "Brainy cannot produce a reliable comparison from these two uploads yet.";
  }

  const careful = args.status === "provisional" ? "Observed: " : "";
  const recv = args.moneyReceived;
  const spent = args.moneySpent;
  const near =
    Math.abs(spent.dollarDelta) < COMPARISON_MATERIALITY.NEAR_UNCHANGED_SPEND;

  if (near && Math.abs(recv.dollarDelta) < COMPARISON_MATERIALITY.NEAR_UNCHANGED_SPEND) {
    return `${careful}Your spending and money received were nearly unchanged versus the previous statement.`;
  }
  if (near) {
    if (recv.direction === "increased") {
      return `${careful}You received $${Math.abs(recv.dollarDelta).toFixed(2)} more and spending was nearly unchanged.`;
    }
    if (recv.direction === "decreased") {
      return `${careful}You received $${Math.abs(recv.dollarDelta).toFixed(2)} less and spending was nearly unchanged.`;
    }
    return `${careful}Your spending was nearly unchanged.`;
  }

  const spentPart =
    spent.direction === "increased"
      ? `spent $${Math.abs(spent.dollarDelta).toFixed(2)} more`
      : spent.direction === "decreased"
        ? `spent $${Math.abs(spent.dollarDelta).toFixed(2)} less`
        : "spent about the same";

  if (
    Math.abs(recv.dollarDelta) >= COMPARISON_MATERIALITY.NEAR_UNCHANGED_SPEND &&
    recv.direction !== "unchanged"
  ) {
    const recvPart =
      recv.direction === "increased"
        ? `received $${Math.abs(recv.dollarDelta).toFixed(2)} more`
        : `received $${Math.abs(recv.dollarDelta).toFixed(2)} less`;
    return `${careful}You ${recvPart} and ${spentPart} than in the previous statement.`;
  }

  return `${careful}You ${spentPart} than in the previous statement.`;
}

/**
 * Pure comparison entry point.
 * Upload-slot names are ignored for chronology — earlier/later come from dates.
 */
export function buildStatementComparison(
  input: StatementComparisonInput
): StatementComparisonResult {
  const healthNote =
    "Statement Health is calculated independently for each document and is not a measure of overall financial wellbeing.";

  const emptyMoney = moneyDelta(0, 0);
  const previousFingerprint = buildStatementFingerprint(
    input.previous,
    input.previousPeriod
  );
  const currentFingerprint = buildStatementFingerprint(
    input.current,
    input.currentPeriod
  );

  if (previousFingerprint === currentFingerprint) {
    return {
      status: "same_statement",
      confidence: "none",
      statusReason:
        "These uploads look like the same statement. Upload a different previous period to compare.",
      previousPeriod: normalizePeriodBounds(input.previousPeriod),
      currentPeriod: normalizePeriodBounds(input.currentPeriod),
      previousDays: periodDays(normalizePeriodBounds(input.previousPeriod)),
      currentDays: periodDays(normalizePeriodBounds(input.currentPeriod)),
      previousFingerprint,
      currentFingerprint,
      uploadMatchedChronology: true,
      chronologyNote: null,
      moneyReceived: emptyMoney,
      moneySpent: emptyMoney,
      netCashFlow: {
        available: false,
        previous: null,
        current: null,
        dollarDelta: null,
        percentDelta: null,
        direction: null,
        unavailableReason:
          "Net cash-flow comparison is hidden until both statements are distinct and reliably reconciled.",
      },
      categories: [],
      merchantChanges: [],
      rankedFindings: [],
      summarySentence:
        "Brainy cannot compare these uploads because they look like the same statement.",
      healthNote,
      previousHealth: input.previousHealth ?? null,
      currentHealth: input.currentHealth ?? null,
      provisionalNotes: [],
      educationalFlexibleNotes: [],
    };
  }

  const chronology = resolveComparisonChronology(input);

  if (!chronology.ok) {
    return {
      status: "unavailable",
      confidence: "none",
      statusReason: chronology.reason,
      previousPeriod: normalizePeriodBounds(input.previousPeriod),
      currentPeriod: normalizePeriodBounds(input.currentPeriod),
      previousDays: periodDays(normalizePeriodBounds(input.previousPeriod)),
      currentDays: periodDays(normalizePeriodBounds(input.currentPeriod)),
      previousFingerprint,
      currentFingerprint,
      uploadMatchedChronology: true,
      chronologyNote: null,
      moneyReceived: emptyMoney,
      moneySpent: emptyMoney,
      netCashFlow: {
        available: false,
        previous: null,
        current: null,
        dollarDelta: null,
        percentDelta: null,
        direction: null,
        unavailableReason: chronology.reason,
      },
      categories: [],
      merchantChanges: [],
      rankedFindings: [],
      summarySentence:
        "Brainy cannot produce a reliable comparison until both statement periods can be ordered by date.",
      healthNote,
      previousHealth: input.previousHealth ?? null,
      currentHealth: input.currentHealth ?? null,
      provisionalNotes: [],
      educationalFlexibleNotes: [],
    };
  }

  const orderedInput: StatementComparisonInput = {
    previous: chronology.earlier.activity,
    current: chronology.later.activity,
    previousPeriod: chronology.earlier.period,
    currentPeriod: chronology.later.period,
    previousHealth: chronology.earlier.health,
    currentHealth: chronology.later.health,
  };

  const eligibility = evaluateComparisonEligibility(orderedInput);
  const moneyReceived = moneyDelta(
    orderedInput.previous.moneyIn,
    orderedInput.current.moneyIn
  );
  const moneySpent = moneyDelta(
    orderedInput.previous.moneyOut,
    orderedInput.current.moneyOut
  );

  const bothNetReliable =
    orderedInput.previous.cashFlowReliable &&
    orderedInput.current.cashFlowReliable &&
    orderedInput.previous.netCashFlow != null &&
    orderedInput.current.netCashFlow != null &&
    eligibility.status === "ready";

  const netCashFlow: StatementComparisonResult["netCashFlow"] = bothNetReliable
    ? (() => {
        const previous = roundMoney(orderedInput.previous.netCashFlow!);
        const current = roundMoney(orderedInput.current.netCashFlow!);
        const delta = moneyDelta(previous, current);
        return {
          available: true,
          previous,
          current,
          dollarDelta: delta.dollarDelta,
          percentDelta: delta.percentDelta,
          direction: delta.direction,
          unavailableReason: null,
        };
      })()
    : {
        available: false,
        previous: orderedInput.previous.netCashFlow,
        current: orderedInput.current.netCashFlow,
        dollarDelta: null,
        percentDelta: null,
        direction: null,
        unavailableReason:
          eligibility.status === "ready"
            ? "Net cash flow needs reliable totals on both statements."
            : "Net cash-flow comparison is hidden until both statements are reliably reconciled.",
      };

  const categories =
    eligibility.status === "unavailable" ||
    eligibility.status === "same_statement"
      ? []
      : buildCategoryChanges(orderedInput.previous, orderedInput.current);

  const merchantChanges =
    eligibility.status === "unavailable" ||
    eligibility.status === "same_statement"
      ? []
      : buildMerchantChanges(orderedInput.previous, orderedInput.current);

  const rankedFindings =
    eligibility.status === "unavailable" ||
    eligibility.status === "same_statement"
      ? []
      : buildRankedFindings({
          status: eligibility.status,
          net: netCashFlow,
          categories,
          merchants: merchantChanges,
          moneySpent,
        });

  const educationalFlexibleNotes: string[] = [];
  if (
    eligibility.status === "ready" ||
    eligibility.status === "provisional"
  ) {
    for (const cat of categories) {
      if (!cat.isFlexible) continue;
      if (cat.direction !== "increased" && cat.direction !== "new") continue;
      if (Math.abs(cat.dollarDelta) < COMPARISON_MATERIALITY.FLEXIBLE_REVIEW_DOLLAR) {
        continue;
      }
      educationalFlexibleNotes.push(
        `${cat.label} increased by $${Math.abs(cat.dollarDelta).toFixed(2)}. Reviewing the largest merchants could help you decide whether the change was expected.`
      );
    }
  }

  const chronologyNote = chronology.uploadMatchedChronology
    ? null
    : "Brainy ordered these statements by date. Previous is the earlier period; current is the later period—upload order does not change the comparison.";

  return {
    status: eligibility.status,
    confidence: eligibility.confidence,
    statusReason: eligibility.reason,
    previousPeriod: orderedInput.previousPeriod,
    currentPeriod: orderedInput.currentPeriod,
    previousDays: periodDays(orderedInput.previousPeriod),
    currentDays: periodDays(orderedInput.currentPeriod),
    previousFingerprint: eligibility.previousFingerprint,
    currentFingerprint: eligibility.currentFingerprint,
    uploadMatchedChronology: chronology.uploadMatchedChronology,
    chronologyNote,
    moneyReceived,
    moneySpent,
    netCashFlow,
    categories,
    merchantChanges,
    rankedFindings,
    summarySentence: buildSummarySentence({
      status: eligibility.status,
      moneyReceived,
      moneySpent,
      net: netCashFlow,
    }),
    healthNote,
    previousHealth: orderedInput.previousHealth ?? null,
    currentHealth: orderedInput.currentHealth ?? null,
    provisionalNotes: eligibility.provisionalNotes,
    educationalFlexibleNotes,
  };
}

/** Ask-Brainy helpers — pure strings from comparison model. */
export function answerComparisonQuestion(
  comparison: StatementComparisonResult,
  question:
    | "why_spent_more"
    | "bills_changed"
    | "subscriptions_appeared"
    | "spent_less"
    | "review_first"
    | "what_changed"
): string {
  if (
    comparison.status === "unavailable" ||
    comparison.status === "same_statement"
  ) {
    return comparison.statusReason;
  }

  const prefix =
    comparison.status === "provisional"
      ? "Observed carefully (not fully reconciled): "
      : "";

  switch (question) {
    case "what_changed":
      return `${prefix}${comparison.summarySentence} ${
        comparison.rankedFindings[0]
          ? `Biggest noted change: ${comparison.rankedFindings[0].title}.`
          : ""
      }`.trim();
    case "why_spent_more": {
      if (comparison.moneySpent.dollarDelta <= 0) {
        return `${prefix}Spending did not increase versus the previous statement.`;
      }
      const ups = comparison.categories
        .filter((c) => c.dollarDelta > 0)
        .sort((a, b) => b.dollarDelta - a.dollarDelta)
        .slice(0, 3)
        .map((c) => `${c.label} (+$${c.dollarDelta.toFixed(2)})`);
      return `${prefix}You spent $${comparison.moneySpent.dollarDelta.toFixed(2)} more. Largest category increases: ${ups.join("; ") || "none separated"}.`;
    }
    case "bills_changed": {
      const bills = comparison.merchantChanges.filter((m) =>
        m.kind.startsWith("bill_")
      );
      if (!bills.length) {
        return `${prefix}No material bill provider changes were separated between these statements.`;
      }
      return `${prefix}${bills
        .slice(0, 4)
        .map((b) => `${b.displayName}: ${b.evidence}`)
        .join(" ")}`;
    }
    case "subscriptions_appeared": {
      const news = comparison.merchantChanges.filter(
        (m) => m.kind === "subscription_new"
      );
      if (!news.length) {
        return `${prefix}No newly observed possible subscriptions were separated in the current statement.`;
      }
      return `${prefix}${news
        .map((n) => `${n.displayName} — ${n.evidence}`)
        .join(" ")}`;
    }
    case "spent_less": {
      const downs = comparison.categories
        .filter((c) => c.dollarDelta < -COMPARISON_MATERIALITY.MIN_DOLLAR_DELTA)
        .sort((a, b) => a.dollarDelta - b.dollarDelta)
        .slice(0, 4)
        .map((c) => `${c.label} (−$${Math.abs(c.dollarDelta).toFixed(2)})`);
      if (!downs.length) {
        return `${prefix}No material category decreases were observed.`;
      }
      return `${prefix}Categories with lower observed spending: ${downs.join("; ")}.`;
    }
    case "review_first": {
      if (!comparison.rankedFindings.length) {
        return `${prefix}No high-priority changes crossed the materiality gates.`;
      }
      return `${prefix}Start with: ${comparison.rankedFindings
        .map((f) => f.title)
        .join("; ")}.`;
    }
    default:
      return comparison.summarySentence;
  }
}

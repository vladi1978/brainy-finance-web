import {
  OPTIMIZATION_HIGH_FRACTION,
  OPTIMIZATION_LOW_FRACTION,
} from "../intelligence/financialCategories";
import { annualizePeriodAmount } from "../intelligence/period";
import type { IntelligenceInput } from "../intelligence/types";
import type {
  CopilotFeedItem,
  OptimizationPotentialRange,
  PriorityScores,
  TimelineSignal,
} from "./types";
import { signalSeverity } from "./detectSignals";

function urgencyForKind(signal: TimelineSignal): number {
  switch (signal.kind) {
    case "overdraft_pattern":
      return 95;
    case "fee_escalation":
      return 88;
    case "unusual_spike":
      return 72;
    case "subscription_growth":
      return 65;
    case "spending_increase":
      return signal.tags.includes("priority") ? 58 : 48;
    case "recurring_monthly":
      return signal.id === "telecom-recurring-high" ? 55 : 42;
    case "recurring_weekly":
      return 40;
    case "spending_decrease":
      return 25;
    default:
      return 35;
  }
}

function effortScore(signal: TimelineSignal): number {
  switch (signal.kind) {
    case "overdraft_pattern":
    case "fee_escalation":
      return 25;
    case "subscription_growth":
      return 35;
    case "spending_increase":
      return 45;
    case "unusual_spike":
      return 30;
    case "recurring_monthly":
      return 55;
    default:
      return 50;
  }
}

function savingsFromSignal(
  signal: TimelineSignal,
  input: IntelligenceInput
): { monthly: number; yearly: number } {
  const { statementPeriod } = input;
  let yearly = annualizePeriodAmount(signal.amount, statementPeriod);

  if (signal.kind === "overdraft_pattern" || signal.kind === "fee_escalation") {
    yearly = Math.round(yearly * 0.85 * 100) / 100;
  }
  if (signal.kind === "subscription_growth" && signal.categoryKey === "streaming") {
    yearly = Math.round(yearly * 0.15 * 100) / 100;
  }
  if (signal.kind === "spending_increase" && signal.categoryKey === "restaurants") {
    yearly = Math.round(yearly * 0.1 * 100) / 100;
  }
  if (signal.kind === "spending_decrease") {
    yearly = 0;
  }

  const monthly = Math.round((yearly / 12) * 100) / 100;
  return { monthly, yearly };
}

export function scoreCopilotPriority(
  signal: TimelineSignal,
  input: IntelligenceInput
): PriorityScores {
  const urgency = urgencyForKind(signal);
  const { yearly } = savingsFromSignal(signal, input);
  const savingsImpact = Math.min(100, Math.round(yearly / 50));
  const confidence = Math.round(signal.baseConfidence * 100);
  const effort = effortScore(signal);
  const overall = Math.round(
    0.35 * urgency +
      0.35 * savingsImpact +
      0.2 * confidence +
      0.1 * (100 - effort)
  );

  return {
    urgency,
    savingsImpact,
    confidence,
    effort,
    overall: Math.min(100, Math.max(0, overall)),
  };
}

export function toCopilotFeedItem(
  signal: TimelineSignal,
  input: IntelligenceInput,
  narrative: { title: string; insight: string; recommendation: string }
): CopilotFeedItem {
  const priority = scoreCopilotPriority(signal, input);
  const { monthly, yearly } = savingsFromSignal(signal, input);

  return {
    id: `copilot-${signal.id}`,
    signalId: signal.id,
    title: narrative.title,
    insight: narrative.insight,
    recommendation: narrative.recommendation,
    estimatedMonthlySavings: yearly > 0 ? monthly : undefined,
    estimatedYearlySavings: yearly > 0 ? yearly : undefined,
    currency: signal.currency,
    severity: signalSeverity(signal.kind),
    tags: signal.tags,
    priority,
  };
}

const OPTIMIZATION_SIGNAL_PREFIXES = [
  "subscription",
  "spending",
  "telecom",
  "streaming",
  "dining",
  "convenience",
  "recurring",
  "insurance",
];

function isOptimizationFeedItem(item: CopilotFeedItem): boolean {
  if (item.tags.includes("fee")) return false;
  if (item.signalId.includes("overdraft") || item.signalId.includes("fee")) {
    return false;
  }
  return (
    item.tags.includes("trend") ||
    item.tags.includes("subscription") ||
    OPTIMIZATION_SIGNAL_PREFIXES.some((p) => item.signalId.includes(p))
  );
}

export function estimateOptimizationRange(
  items: CopilotFeedItem[]
): OptimizationPotentialRange {
  const seen = new Set<string>();
  const yearlyEstimates: number[] = [];
  const confidences: number[] = [];

  for (const item of items) {
    if (!isOptimizationFeedItem(item)) continue;
    if (!item.estimatedYearlySavings || item.estimatedYearlySavings <= 0) continue;
    const key = item.signalId.split("-")[0] ?? item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    yearlyEstimates.push(item.estimatedYearlySavings);
    confidences.push(item.priority.confidence / 100);
  }

  if (!yearlyEstimates.length) {
    return { yearlyLow: 0, yearlyHigh: 0, confidence: 0 };
  }

  const yearlyLow = Math.round(
    yearlyEstimates.reduce((s, y) => s + y * OPTIMIZATION_LOW_FRACTION, 0) * 100
  ) / 100;
  const yearlyHigh = Math.round(
    yearlyEstimates.reduce((s, y) => s + y * OPTIMIZATION_HIGH_FRACTION, 0) * 100
  ) / 100;
  const confidence =
    Math.round(
      (confidences.reduce((s, c) => s + c, 0) / confidences.length) * 100
    ) / 100;

  return { yearlyLow, yearlyHigh, confidence };
}

/** @deprecated Inflated single-number estimate — use estimateOptimizationRange */
export function estimateYearlyPotential(
  items: CopilotFeedItem[],
  _existingYearlySavings: number
): number {
  const range = estimateOptimizationRange(items);
  return range.yearlyHigh;
}

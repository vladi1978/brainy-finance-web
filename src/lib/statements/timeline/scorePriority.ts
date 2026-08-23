import {
  OPTIMIZATION_HIGH_FRACTION,
  OPTIMIZATION_LOW_FRACTION,
} from "../intelligence/financialCategories";
import type { IntelligenceInput } from "../intelligence/types";
import { buildSavingsOpportunities } from "../intelligence/savings";
import { canAnnualizeFeePattern, resolveChargeCount } from "../evidenceGuarded";
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

/**
 * Map timeline signals onto the same guarded savings opportunities used by
 * Financial Intelligence / recommendations — never re-annualize signal.amount.
 */
function savingsFromSignal(
  signal: TimelineSignal,
  input: IntelligenceInput
): { monthly: number; yearly: number } {
  const opps = buildSavingsOpportunities(input);
  const byCluster = new Map(input.clusters.map((c) => [c.id, c]));

  if (signal.kind === "overdraft_pattern" || signal.kind === "fee_escalation") {
    const feeOpp = opps.find((o) => o.id === "reduce-fees");
    if (feeOpp) {
      return {
        monthly: feeOpp.monthlySavings,
        yearly: feeOpp.yearlySavings,
      };
    }
    const fees = [...input.recurringExpenses, ...input.spendingInsights].filter(
      (r) => r.categoryKey === "fees" || r.kind === "fee"
    );
    const chargeCount = fees.reduce(
      (n, r) =>
        n +
        resolveChargeCount({
          cluster: byCluster.get(r.clusterId),
          periodTotal: r.totalSpentInPeriod,
          latestCharge: r.amount,
        }),
      0
    );
    if (!canAnnualizeFeePattern(chargeCount)) {
      return { monthly: signal.amount, yearly: 0 };
    }
  }

  if (signal.kind === "subscription_growth") {
    const match =
      opps.find((o) => o.id === "streaming-bundle") ??
      opps.find((o) => o.id === "review-flagged-subs");
    if (match) {
      return { monthly: match.monthlySavings, yearly: match.yearlySavings };
    }
    return { monthly: 0, yearly: 0 };
  }

  if (signal.kind === "recurring_monthly") {
    return { monthly: signal.amount > 0 ? signal.amount : 0, yearly: 0 };
  }

  if (signal.kind === "spending_increase") {
    const match =
      opps.find((o) => o.id === "reduce-delivery") ??
      opps.find((o) => o.id === "convenience-cut");
    if (match) {
      return { monthly: match.monthlySavings, yearly: match.yearlySavings };
    }
    return { monthly: 0, yearly: 0 };
  }

  if (signal.kind === "spending_decrease" || signal.kind === "unusual_spike") {
    return { monthly: 0, yearly: 0 };
  }

  return { monthly: 0, yearly: 0 };
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

export function estimateOptimizationRange(
  _items: CopilotFeedItem[]
): OptimizationPotentialRange {
  // Copilot feed must not invent its own optimization band.
  return { yearlyLow: 0, yearlyHigh: 0, confidence: 0 };
}

/** @deprecated Use financial summary optimization only. */
export function estimateYearlyPotential(
  _items: CopilotFeedItem[],
  _existingYearlySavings: number
): number {
  return 0;
}

// Re-export fractions so callers that previously derived bands locally stay type-compatible.
export { OPTIMIZATION_HIGH_FRACTION, OPTIMIZATION_LOW_FRACTION };

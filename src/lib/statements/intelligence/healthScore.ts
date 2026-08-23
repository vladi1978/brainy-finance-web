import type { HealthScoreLabel, HealthScoreResult, IntelligenceInput } from "./types";
import { buildSavingsOpportunities } from "./savings";
import { buildGuardedSubscriptionTotals } from "../evidenceGuarded";
import { collectDedupedFees } from "../feeDedupe";

function labelForScore(score: number): HealthScoreLabel {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 55) return "Fair";
  return "Needs Attention";
}

function weeklyDebitTotals(clusters: IntelligenceInput["clusters"]): number[] {
  const byWeek = new Map<string, number>();
  for (const c of clusters) {
    for (const ch of c.charges) {
      if (ch.type !== "debit") continue;
      const d = Date.parse(ch.date + "T00:00:00Z");
      if (!Number.isFinite(d)) continue;
      const dt = new Date(d);
      const weekKey = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-W${String(Math.ceil(dt.getUTCDate() / 7)).padStart(2, "0")}`;
      byWeek.set(weekKey, (byWeek.get(weekKey) ?? 0) + ch.amount);
    }
  }
  return [...byWeek.values()];
}

function spendingGrowthPenalty(weekTotals: number[]): number {
  if (weekTotals.length < 3) return 0;
  const mid = Math.floor(weekTotals.length / 2);
  const first = weekTotals.slice(0, mid);
  const second = weekTotals.slice(mid);
  const avg = (a: number[]) =>
    a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const a0 = avg(first);
  if (a0 < 25) return 0;
  const ratio = avg(second) / a0;
  if (ratio > 1.35) return 12;
  if (ratio > 1.15) return 6;
  return 0;
}

function consistencyBonus(weekTotals: number[]): number {
  if (weekTotals.length < 3) return 0;
  const mean = weekTotals.reduce((s, x) => s + x, 0) / weekTotals.length;
  if (mean <= 0) return 0;
  const variance =
    weekTotals.reduce((s, x) => s + (x - mean) ** 2, 0) / weekTotals.length;
  const cv = Math.sqrt(variance) / mean;
  if (cv < 0.35) return 5;
  return 0;
}

export function buildHealthScore(input: IntelligenceInput): HealthScoreResult {
  let score = 100;
  const factors: HealthScoreResult["factors"] = [];
  const byCluster = new Map(input.clusters.map((c) => [c.id, c]));
  const guarded = buildGuardedSubscriptionTotals(
    input.subscriptions,
    byCluster
  );

  const feeSet = collectDedupedFees({
    recurringExpenses: input.recurringExpenses,
    spendingInsights: input.spendingInsights,
    clusters: input.clusters,
  });
  if (feeSet.observedPeriodTotal > 0) {
    // One consolidated fee penalty — do not stack bank-fee + overdraft for the same events.
    const impact = Math.min(
      25,
      8 + feeSet.observedPeriodTotal / 15 + (feeSet.hasOverdraft ? 4 : 0)
    );
    score -= impact;
    factors.push({
      id: "fees",
      label: feeSet.hasOverdraft
        ? "Overdraft / bank fees"
        : "Bank and account fees",
      impact: -Math.round(impact),
    });
  }

  const subMonthly = guarded.confirmedMonthlySpend;
  if (subMonthly > 250) {
    const impact = Math.min(18, Math.round((subMonthly - 250) / 25));
    score -= impact;
    factors.push({
      id: "subscription-load",
      label: "Confirmed subscription load",
      impact: -impact,
    });
  } else if (guarded.confirmedCount > 0 && subMonthly <= 120) {
    score += 3;
    factors.push({
      id: "subscription-load",
      label: "Moderate confirmed subscription load",
      impact: 3,
    });
  }

  const weekTotals = weeklyDebitTotals(input.clusters);
  const growthPenalty = spendingGrowthPenalty(weekTotals);
  if (growthPenalty > 0) {
    score -= growthPenalty;
    factors.push({
      id: "spending-growth",
      label: "Spending was higher in the second half",
      impact: -growthPenalty,
    });
  }

  const consistency = consistencyBonus(weekTotals);
  if (consistency > 0) {
    score += consistency;
    factors.push({
      id: "consistency",
      label: "Stable weekly spending",
      impact: consistency,
    });
  }

  const savings = buildSavingsOpportunities(input).filter(
    (s) => s.yearlySavings > 0 || s.category === "avoidable_fees"
  );
  const actionableYearly = savings
    .filter((s) => s.category === "confirmed" || s.category === "avoidable_fees")
    .reduce((n, s) => n + s.yearlySavings, 0);

  if (savings.length >= 3 && actionableYearly > 0) {
    score -= Math.min(10, savings.length * 2);
    factors.push({
      id: "savings-opps",
      label: "Several evidence-backed savings opportunities",
      impact: -Math.min(10, savings.length * 2),
    });
  } else if (actionableYearly === 0 && feeSet.observedPeriodTotal === 0) {
    score += 4;
    factors.push({
      id: "clean-ledger",
      label: "Few avoidable fees detected",
      impact: 4,
    });
  }

  if (guarded.confirmedCount >= 2) {
    score += 2;
    factors.push({
      id: "confirmed-bills",
      label: "High-confidence recurring bills",
      impact: 2,
    });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    label: labelForScore(score),
    factors,
  };
}

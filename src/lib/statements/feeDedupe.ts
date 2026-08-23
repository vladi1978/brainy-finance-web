/**
 * Deduplicated fee collection shared by savings, recommendations, health, and insights.
 * One underlying fee event must never be counted twice across surfaces.
 */

import type { MerchantCluster, SpendingInsight } from "./types";
import {
  canAnnualizeFeePattern,
  resolveChargeCount,
} from "./recurrenceEvidence";

export type FeeSpendRow = Pick<
  SpendingInsight,
  | "clusterId"
  | "merchant"
  | "normalizedName"
  | "amount"
  | "totalSpentInPeriod"
  | "lastCharged"
  | "categoryKey"
  | "kind"
  | "currency"
>;

export type DedupedFeeEvent = {
  key: string;
  clusterId: string;
  merchant: string;
  normalizedName: string;
  amount: number;
  date: string;
  currency: string;
  isOverdraft: boolean;
};

export type DedupedFeeSet = {
  events: DedupedFeeEvent[];
  /** Unique fee events (deduped). */
  chargeCount: number;
  /** Sum of unique fee amounts in the statement window. */
  observedPeriodTotal: number;
  overdraftCount: number;
  hasOverdraft: boolean;
  /** True when ≥2 unique fee charges support cadence annualization. */
  annualizeEligible: boolean;
  currency: string;
};

function isOverdraftText(text: string): boolean {
  return /\b(OVERDRAFT|OVERDR\.?|OD\s+F(?:EE|E)|NSF\b|NON[-\s]*SUF|INSUFFICIENT\s+FUNDS)\b/ui.test(
    text
  );
}

function feeEventKey(args: {
  clusterId: string;
  date: string;
  amount: number;
  normalizedName: string;
}): string {
  const amt = args.amount.toFixed(2);
  const name = args.normalizedName.toUpperCase().replace(/\s+/g, " ").trim();
  // Prefer cluster + date + amount; fall back includes merchant for cross-row collisions.
  return `${args.clusterId}|${args.date}|${amt}|${name}`;
}

function rowFeeDate(
  row: FeeSpendRow,
  cluster: MerchantCluster | undefined
): string {
  if (row.lastCharged) return row.lastCharged;
  const debits = (cluster?.charges ?? []).filter((c) => c.type === "debit");
  if (debits.length === 1) return debits[0]!.date;
  if (debits.length > 1) {
    return [...debits].map((d) => d.date).sort().at(-1) ?? "";
  }
  return "";
}

/**
 * Collect fee rows from recurring + insights, dedupe by clusterId then
 * merchant/date/amount so one $68 charge cannot become $136.
 */
export function collectDedupedFees(args: {
  recurringExpenses: FeeSpendRow[];
  spendingInsights: FeeSpendRow[];
  clusters: MerchantCluster[];
}): DedupedFeeSet {
  const byCluster = new Map(args.clusters.map((c) => [c.id, c]));
  const seenCluster = new Set<string>();
  const seenEvent = new Set<string>();
  const events: DedupedFeeEvent[] = [];

  const rows = [...args.recurringExpenses, ...args.spendingInsights].filter(
    (r) => r.categoryKey === "fees" || r.kind === "fee"
  );

  for (const row of rows) {
    // Same cluster appearing in both recurring + insights → keep once.
    if (seenCluster.has(row.clusterId)) continue;
    seenCluster.add(row.clusterId);

    const cluster = byCluster.get(row.clusterId);
    const debitCount = resolveChargeCount({
      cluster,
      periodTotal: row.totalSpentInPeriod,
      latestCharge: row.amount,
    });

    if (cluster && debitCount >= 1) {
      const debits = cluster.charges.filter((c) => c.type === "debit");
      for (const d of debits) {
        const key = feeEventKey({
          clusterId: row.clusterId,
          date: d.date,
          amount: d.amount,
          normalizedName: row.normalizedName || row.merchant,
        });
        if (seenEvent.has(key)) continue;
        seenEvent.add(key);
        const blob = `${row.merchant} ${row.normalizedName}`;
        events.push({
          key,
          clusterId: row.clusterId,
          merchant: row.merchant,
          normalizedName: row.normalizedName,
          amount: d.amount,
          date: d.date,
          currency: row.currency?.length === 3 ? row.currency : "USD",
          isOverdraft: isOverdraftText(blob),
        });
      }
    } else {
      const date = rowFeeDate(row, cluster);
      const key = feeEventKey({
        clusterId: row.clusterId,
        date,
        amount: row.amount,
        normalizedName: row.normalizedName || row.merchant,
      });
      if (seenEvent.has(key)) continue;
      seenEvent.add(key);
      const blob = `${row.merchant} ${row.normalizedName}`;
      events.push({
        key,
        clusterId: row.clusterId,
        merchant: row.merchant,
        normalizedName: row.normalizedName,
        amount: row.amount > 0 ? row.amount : row.totalSpentInPeriod,
        date,
        currency: row.currency?.length === 3 ? row.currency : "USD",
        isOverdraft: isOverdraftText(blob),
      });
    }
  }

  const observedPeriodTotal = round2(
    events.reduce((s, e) => s + e.amount, 0)
  );
  const overdraftCount = events.filter((e) => e.isOverdraft).length;
  const chargeCount = events.length;
  const currency =
    events.find((e) => e.currency)?.currency ??
    (rows[0]?.currency?.length === 3 ? rows[0]!.currency : "USD");

  return {
    events,
    chargeCount,
    observedPeriodTotal,
    overdraftCount,
    hasOverdraft: overdraftCount > 0,
    annualizeEligible: canAnnualizeFeePattern(chargeCount),
    currency,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

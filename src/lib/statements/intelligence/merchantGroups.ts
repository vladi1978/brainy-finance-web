import { clusterMerchantPresentation } from "../merchantNormalization";
import type { MerchantNormalizationResult } from "../merchantNormalization";
import type { MerchantCluster, SpendingInsight } from "../types";
import type { MerchantGroupSummary } from "./types";
import { rowConfidence } from "./confidence";

/** Strip store/terminal suffixes for display grouping (e.g. Kafeneleas D02-0). */
export function merchantGroupKey(name: string): string {
  let s = name
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();

  s = s.replace(/\b(?:STORE|ST|LOC|UNIT)\s*#?\s*\d+\b/giu, " ");
  s = s.replace(/\b[A-Z]?\d{1,3}[-\s]\d{1,4}\b/gu, " ");
  s = s.replace(/\s+#\s*\d+\b/gu, " ");
  s = s.replace(/\s+\d{3,5}\s*$/gu, " ");
  s = s.replace(/\s+/gu, " ").trim();

  return s.length >= 2 ? s : name.trim();
}

export function buildMerchantGroups(args: {
  clusters: MerchantCluster[];
  spendingRows: SpendingInsight[];
  merchantNormByClusterId?: Map<string, MerchantNormalizationResult>;
}): MerchantGroupSummary[] {
  const rowByCluster = new Map(
    args.spendingRows.map((r) => [r.clusterId, r])
  );
  const clusterById = new Map(args.clusters.map((c) => [c.id, c]));

  const groups = new Map<
    string,
    {
      displayName: string;
      clusterIds: string[];
      transactionCount: number;
      totalAmount: number;
      currency: string;
      recurringPatternScore: number;
      categoryKeys: Set<string>;
    }
  >();

  for (const cluster of args.clusters) {
    const row = rowByCluster.get(cluster.id);
    const debits = cluster.charges.filter((c) => c.type === "debit");
    if (debits.length < 1) continue;

    const rowNorm = row?.normalizedName;
    const presentation =
      rowNorm && rowNorm.length >= 2
        ? {
            normalizedName: rowNorm,
            merchant: rowNorm,
          }
        : clusterMerchantPresentation(
            cluster,
            args.merchantNormByClusterId?.get(cluster.id)
          );

    const gKey = merchantGroupKey(presentation.normalizedName).toUpperCase();
    const displayName = merchantGroupKey(presentation.normalizedName);
    const total = debits.reduce((s, c) => s + c.amount, 0);
    const patternScore = row ? rowConfidence(row) : 0;
    const currency = debits[debits.length - 1]?.currency || "USD";
    const categoryKey = row?.categoryKey ?? "other";

    let bucket = groups.get(gKey);
    if (!bucket) {
      bucket = {
        displayName,
        clusterIds: [],
        transactionCount: 0,
        totalAmount: 0,
        currency,
        recurringPatternScore: 0,
        categoryKeys: new Set(),
      };
      groups.set(gKey, bucket);
    }

    bucket.clusterIds.push(cluster.id);
    bucket.transactionCount += debits.length;
    bucket.totalAmount += total;
    bucket.recurringPatternScore = Math.max(
      bucket.recurringPatternScore,
      patternScore
    );
    bucket.categoryKeys.add(categoryKey);
    if (!clusterById.has(cluster.id)) {
      /* cluster always present */
    }
  }

  return [...groups.values()]
    .filter((g) => g.transactionCount >= 2 || g.clusterIds.length >= 2)
    .map((g) => ({
      groupKey: g.displayName.toUpperCase(),
      displayName: g.displayName,
      clusterIds: g.clusterIds,
      transactionCount: g.transactionCount,
      totalAmount: Math.round(g.totalAmount * 100) / 100,
      currency: g.currency,
      recurringPatternScore: g.recurringPatternScore,
      categoryKeys: [...g.categoryKeys],
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 64);
}

import type { MerchantCluster } from "../types";
import { deriveMerchantPresentation } from "../merchantNormalize";
import type { SubscriptionCategory } from "../types";
import { normalizeAmbiguousMerchantsWithOpenAI } from "./openai";
import {
  isAmbiguousMerchantNormalization,
  normalizeMerchantDeterministic,
} from "./rules";
import type {
  MerchantNormalizationDiagnostic,
  MerchantNormalizationResult,
} from "./types";

export type { MerchantNormalizationDiagnostic, MerchantNormalizationResult } from "./types";

export function clusterMerchantPresentation(
  cluster: MerchantCluster,
  normalization?: MerchantNormalizationResult | null
): {
  merchant: string;
  normalizedName: string;
  category: SubscriptionCategory;
} {
  const base = deriveMerchantPresentation({
    primaryDescription: cluster.descriptions[0] ?? cluster.key,
    clusterKeyUpper: cluster.key,
  });

  if (!normalization) return base;

  return {
    merchant: normalization.normalizedName,
    normalizedName: normalization.normalizedName,
    category: base.category,
  };
}

function logMerchantNormalization(row: MerchantNormalizationDiagnostic): void {
  console.log("[statements/merchant-normalize]", {
    clusterId: row.clusterId,
    rawMerchant: row.rawMerchant,
    normalizedMerchant: row.normalizedName,
    confidence: row.confidence,
    reason: row.reason,
    source: row.source,
  });
}

export async function buildMerchantNormalizationMap(args: {
  clusters: MerchantCluster[];
  signal?: AbortSignal;
}): Promise<Map<string, MerchantNormalizationResult>> {
  const map = new Map<string, MerchantNormalizationResult>();
  const ambiguous = new Map<string, MerchantNormalizationResult>();

  for (const cluster of args.clusters) {
    const debits = cluster.charges.filter((c) => c.type === "debit");
    if (debits.length < 1) continue;

    const rawExamples = cluster.descriptions.length
      ? cluster.descriptions
      : [cluster.key];

    const deterministic = normalizeMerchantDeterministic({
      rawExamples,
      clusterKey: cluster.key,
    });

    map.set(cluster.id, deterministic);

    if (isAmbiguousMerchantNormalization(deterministic, cluster.key)) {
      ambiguous.set(cluster.id, deterministic);
    }

    logMerchantNormalization({
      clusterId: cluster.id,
      rawMerchant: rawExamples[0] ?? cluster.key,
      ...deterministic,
    });
  }

  if (ambiguous.size > 0) {
    const { updated, error } = await normalizeAmbiguousMerchantsWithOpenAI({
      clusters: args.clusters,
      pending: ambiguous,
      signal: args.signal,
    });

    if (error) {
      console.warn("[statements/merchant-normalize] OpenAI skipped:", error);
    }

    for (const [clusterId, result] of ambiguous) {
      map.set(clusterId, result);
      const cluster = args.clusters.find((c) => c.id === clusterId);
      if (!cluster) continue;
      if (result.source === "openai" || updated > 0) {
        logMerchantNormalization({
          clusterId,
          rawMerchant: cluster.descriptions[0] ?? cluster.key,
          ...result,
        });
      }
    }
  }

  return map;
}

export function merchantNormalizationDiagnostics(
  clusters: MerchantCluster[],
  map: Map<string, MerchantNormalizationResult>
): MerchantNormalizationDiagnostic[] {
  return clusters
    .filter((c) => map.has(c.id))
    .map((c) => ({
      clusterId: c.id,
      rawMerchant: c.descriptions[0] ?? c.key,
      ...map.get(c.id)!,
    }))
    .sort((a, b) => a.normalizedName.localeCompare(b.normalizedName));
}

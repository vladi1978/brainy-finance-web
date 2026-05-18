import { clusteringMerchantKey } from "./merchantNormalize";
import type { MerchantCluster, Transaction } from "./types";

export function normalizeMerchantKey(description: string): string {
  return clusteringMerchantKey(description).slice(0, 48);
}

export function buildMerchantClusters(
  transactions: Transaction[]
): MerchantCluster[] {
  const map = new Map<
    string,
    {
      key: string;
      descriptions: Set<string>;
      charges: MerchantCluster["charges"];
    }
  >();

  let id = 0;
  for (const t of transactions) {
    if (t.type !== "debit") continue;
    const key = normalizeMerchantKey(t.description);
    if (key.length < 4) continue;

    let bucket = map.get(key);
    if (!bucket) {
      bucket = { key, descriptions: new Set(), charges: [] };
      map.set(key, bucket);
    }
    bucket.descriptions.add(t.description.trim());
    bucket.charges.push({
      date: t.date,
      amount: t.amount,
      type: t.type,
      currency: t.currency,
    });
  }

  const clusters: MerchantCluster[] = [];
  for (const b of map.values()) {
    if (b.charges.length < 1) continue;
    b.charges.sort((a, c) => a.date.localeCompare(c.date));
    clusters.push({
      id: String(id++),
      key: b.key,
      descriptions: [...b.descriptions],
      charges: b.charges,
    });
  }

  clusters.sort((a, b) => b.charges.length - a.charges.length);
  return clusters;
}

export function chunkClusters<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

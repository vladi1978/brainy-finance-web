import OpenAI from "openai";
import { chunkClusters } from "./clusters";
import { excludeClusterFromSubscriptions } from "./heuristics";
import { clusterLooksSubscriptionMerchant } from "./subscriptionSignals";
import type { MerchantCluster } from "./types";

const MODEL_DEFAULT = "gpt-4o";
const CHUNK = 45;

type AiSubscriptionRaw = {
  clusterId: string;
  merchant: string;
  normalizedName: string;
  category: string;
  amount: number;
  currency: string;
  frequency: string;
  lastCharged: string;
  monthlyEquivalent: number;
  annualEquivalent: number;
  confidence: number;
  flags: {
    forgotten: boolean;
    duplicate: boolean;
    priceIncreased: boolean;
    trialConverted: boolean;
    suspicious: boolean;
  };
};

function parseSubscriptionsJson(content: string): AiSubscriptionRaw[] {
  const trimmed = content.trim();
  const parsed = JSON.parse(trimmed) as {
    subscriptions?: AiSubscriptionRaw[];
  };
  if (!parsed || !Array.isArray(parsed.subscriptions)) return [];
  return parsed.subscriptions.filter(
    (s) =>
      s &&
      typeof s.clusterId === "string" &&
      typeof s.merchant === "string" &&
      typeof s.normalizedName === "string"
  );
}

function clusterPayload(clusters: MerchantCluster[]) {
  return clusters.map((c) => ({
    clusterId: c.id,
    merchantHints: c.descriptions.slice(0, 3),
    debitCharges: c.charges
      .filter((x) => x.type === "debit")
      .map((x) => ({
        date: x.date,
        amount: x.amount,
        currency: x.currency,
      })),
  }));
}

export async function analyzeClustersWithOpenAI(
  clusters: MerchantCluster[],
  signal: AbortSignal
): Promise<{ items: AiSubscriptionRaw[]; error: string | null }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { items: [], error: "OPENAI_API_KEY is not set" };
  }

  const model =
    process.env.OPENAI_SUBSCRIPTIONS_MODEL?.trim() || MODEL_DEFAULT;

  const client = new OpenAI({ apiKey });

  const eligible = clusters.filter((c) => {
    const debits = c.charges.filter((x) => x.type === "debit").length;
    if (debits < 1) return false;
    if (excludeClusterFromSubscriptions(c)) return false;
    return debits >= 2 || clusterLooksSubscriptionMerchant(c);
  });

  const parts = chunkClusters(eligible, CHUNK);

  const merged: AiSubscriptionRaw[] = [];

  for (const part of parts) {
    const payload = clusterPayload(part);
    if (!payload.length) continue;

    const completion = await client.chat.completions.create(
      {
        model,
        temperature: 0.15,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You identify TRUE recurring subscriptions and recurring bills only: streaming (Netflix, Peacock, etc.), music, gyms, recognizable SaaS/cloud suites, insurance premiums (State Farm, Geico-style ACH strings), telecom/wireless/ISP utilities, phone bills, software memberships. " +
              'Return ONLY compact JSON {\"subscriptions\":[...]} with ZERO markdown scaffolding. ' +
              "Do NOT label groceries, liquor stores, restaurants, cafés, general retail (Target, Dollar General), gas stations, Venmo/Zelle transfers, payroll, bank fees, or one-off purchases as subscriptions—even when two charges look similar. Those belong elsewhere; omit them entirely from this JSON. " +
              "Prefer conservative outputs: emit a row only when narration matches subscription/billing rails OR cadence clearly aligns with monthly/annual billing plus merchant hints.",
          },
          {
            role: "user",
            content: [
              "Each chunk cluster lists merchantHints plus debitCharges. Emit one subscription object ONLY for genuine recurring bills/subscriptions supported by merchant text or stable cadence.",
              "Each object needs clusterId verbatim from payload, readable merchant/normalizedName, category ∈ streaming|music|fitness|insurance|software|shopping|utilities|other,",
              "numeric amount anchored to freshest meaningful debit, ISO currency letters, frequency ∈ monthly|annual|weekly|unknown,",
              "lastCharged as YYYY-MM-DD, reconcile monthlyEquivalent + annualEquivalent numerically vs frequency guesses, confidence floats 0-1 with ≥0.75 only when cadence AND merchant clearly indicate recurring billing.",
              "flags booleans forgotten|duplicate|priceIncreased|trialConverted|suspicious inferred strictly from deltas present inside debitCharges.",
              "Normalize tokens pragmatically—APPLE.COM/BILL style strings may collapse to concise consumer labels without inventing absent brands.",
              JSON.stringify({ clusters: payload }),
            ].join("\n"),
          },
        ],
      },
      { signal }
    );

    const content = completion.choices[0]?.message?.content;
    if (!content) continue;
    try {
      merged.push(...parseSubscriptionsJson(content));
    } catch {
      /* ignore malformed chunk */
    }
  }

  return { items: merged, error: null };
}

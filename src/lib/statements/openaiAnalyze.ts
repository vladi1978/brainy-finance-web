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
              "You categorize consumer discretionary recurring spend (streaming, SaaS bundles, gyms, MSP/cloud portals, recognizable insurance ACH strings, telecom add-ons). " +
              'Return ONLY compact JSON {\"subscriptions\":[...]} with ZERO markdown scaffolding. ' +
              "Lean inclusive with moderate-confidence rows whenever narration resembles subscription rails—cloud/video/office suites, gyms, MSP—even if cadence rests on roughly two charges or only one unmistakable bill. " +
              "Strictly omit payroll/direct deposit wording, paycheck deposits, outbound/inbound generic wires framed as TRANSFER/ZELLE/SPEI reimbursements lacking branded merchants, bounced/returned checks, refunds/reversal lines, ATM cash, taxes without recognizable SaaS, amortizing mortgages/auto/student/personal payoff rails absent SaaS narration, NSF/overdraft chatter, nondescriptive MAINT/SERVICE/ACCOUNT fee blobs lacking recognizable merchant banners.",
          },
          {
            role: "user",
            content: [
              "Each chunk cluster lists merchantHints plus debitCharges. Emit one subscription object whenever evidence supports discretionary recurring-ish spend—even if inferred cadence stays unknown.",
              "Each object needs clusterId verbatim from payload, readable merchant/normalizedName, category ∈ streaming|music|fitness|insurance|software|shopping|utilities|other,",
              "numeric amount anchored to freshest meaningful debit, ISO currency letters, frequency ∈ monthly|annual|weekly|unknown,",
              "lastCharged as YYYY-MM-DD, reconcile monthlyEquivalent + annualEquivalent numerically vs frequency guesses, calibrated confidence floats 0-1 aiming ≥0.8 when cadence+narrative lock, roughly 0.55-0.79 for unmistakable storefront tokens with limited history.",
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

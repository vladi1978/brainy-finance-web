import OpenAI from "openai";
import { getOpenAiApiKeyIfEnabled } from "@/lib/ai/openaiEnrichmentGate";
import type { MerchantCluster } from "../types";
import type { MerchantNormalizationResult } from "./types";

const MODEL_DEFAULT = "gpt-4o-mini";
const CHUNK = 40;

type AiMerchantRow = {
  clusterId: string;
  normalizedName: string;
  confidence: number;
  reason: string;
};

function parseMerchantsJson(content: string): AiMerchantRow[] {
  const parsed = JSON.parse(content.trim()) as { merchants?: AiMerchantRow[] };
  if (!parsed?.merchants || !Array.isArray(parsed.merchants)) return [];
  return parsed.merchants.filter(
    (r) =>
      r &&
      typeof r.clusterId === "string" &&
      typeof r.normalizedName === "string" &&
      r.normalizedName.trim().length >= 2
  );
}

export async function normalizeAmbiguousMerchantsWithOpenAI(args: {
  clusters: MerchantCluster[];
  pending: Map<string, MerchantNormalizationResult>;
  signal?: AbortSignal;
}): Promise<{ updated: number; error: string | null }> {
  const apiKey = getOpenAiApiKeyIfEnabled();
  if (!apiKey || args.pending.size === 0) {
    return {
      updated: 0,
      error: apiKey
        ? null
        : "OpenAI enrichment is disabled (set OPENAI_ENRICHMENT_ENABLED=true)",
    };
  }

  const model =
    process.env.OPENAI_MERCHANT_NORMALIZE_MODEL?.trim() ||
    process.env.OPENAI_SUBSCRIPTIONS_MODEL?.trim() ||
    MODEL_DEFAULT;

  const clusterById = new Map(args.clusters.map((c) => [c.id, c]));
  const entries = [...args.pending.entries()].filter(([id]) => clusterById.has(id));
  if (!entries.length) return { updated: 0, error: null };

  const client = new OpenAI({ apiKey });
  const chunks: Array<Array<[string, MerchantNormalizationResult]>> = [];
  for (let i = 0; i < entries.length; i += CHUNK) {
    chunks.push(entries.slice(i, i + CHUNK));
  }

  let updated = 0;

  for (const chunk of chunks) {
    const payload = chunk.map(([clusterId, draft]) => {
      const cluster = clusterById.get(clusterId)!;
      return {
        clusterId,
        merchantStrings: draft.rawExamples.slice(0, 6),
        heuristicGuess: draft.normalizedName,
        clusterKey: cluster.key.slice(0, 64),
      };
    });

    try {
      const completion = await client.chat.completions.create(
        {
          model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You normalize bank/credit-card merchant descriptors into clean consumer-facing merchant names. " +
                'Return ONLY JSON {"merchants":[{"clusterId":string,"normalizedName":string,"confidence":0-1,"reason":string}]}. ' +
                "Collapse variants (NETFLIX.COM, NFLX → Netflix; APPLE.COM/BILL → Apple; OPENAI *CHATGPT → OpenAI ChatGPT; ATT DES → AT&T; DOORDASH → DoorDash; BP#1310000GRAB-N → BP). " +
                "Strip transaction IDs, dates, store numbers, auth codes, and location suffixes. Never invent brands not implied by the strings.",
            },
            {
              role: "user",
              content: JSON.stringify({ clusters: payload }),
            },
          ],
        },
        { signal: args.signal }
      );

      const content = completion.choices[0]?.message?.content;
      if (!content) continue;

      const rows = parseMerchantsJson(content);
      for (const row of rows) {
        const prev = args.pending.get(row.clusterId);
        if (!prev) continue;
        const name = row.normalizedName.trim().slice(0, 80);
        if (name.length < 2) continue;

        args.pending.set(row.clusterId, {
          normalizedName: name,
          rawExamples: prev.rawExamples,
          confidence: Math.min(1, Math.max(0.55, Number(row.confidence) || 0.78)),
          reason: row.reason?.trim() || "OpenAI merchant normalization",
          source: "openai",
        });
        updated += 1;
      }
    } catch (e) {
      if (args.signal?.aborted) break;
      console.warn(
        "[statements/merchant-normalize] OpenAI chunk failed:",
        e instanceof Error ? e.message : e
      );
    }
  }

  return { updated, error: null };
}

import OpenAI from "openai";
import { chunkClusters } from "./clusters";
import type { MerchantCluster } from "./types";

const MODEL_DEFAULT = "gpt-4o-mini";
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
    return { items: [], error: "OPENAI_API_KEY no configurada" };
  }

  const model =
    process.env.OPENAI_SUBSCRIPTIONS_MODEL?.trim() || MODEL_DEFAULT;

  const client = new OpenAI({ apiKey });

  const parts = chunkClusters(
    clusters.filter((c) => c.charges.filter((x) => x.type === "debit").length >= 2),
    CHUNK
  );

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
              "Eres un analista financiero. Identifica suscripciones recurrentes de consumo (streaming, música, SaaS). Responde SOLO JSON válido con {\"subscriptions\":[...]} — sin markdown. " +
              "Excluye nómina/payroll y depósitos de salario, devoluciones de cheques rechazadas, cargos NSF y overdraft salvo algo claramente un plan recurrente tipo suscripción bancaria. " +
              "Excluye bares cafeterías vinaterías y liquor stores salvo cargos muy regulares típicos de suscripción estable. Servicios conocidos tipo Netflix o Spotify están bien cuando encajan.",
          },
          {
            role: "user",
            content: [
              "Analiza estos grupos de transacciones (solo débitos). Para cada suscripción detectada devuelve un objeto con:",
              "clusterId (string, debe coincidir con el input), merchant, normalizedName, category (streaming|music|fitness|insurance|software|shopping|utilities|other),",
              "amount (último cargo relevante en número), currency (código ISO tres letras o símbolo normalizado), frequency (monthly|annual|weekly|unknown),",
              "lastCharged (YYYY-MM-DD), monthlyEquivalent, annualEquivalent (números), confidence (0-1),",
              "flags: { forgotten, duplicate, priceIncreased, trialConverted, suspicious } todos boolean.",
              "Si un grupo no es recurrente, omitirlo. merchant debe ser legible para el usuario.",
              "No incluir: transferencias ACH de sueldo, ADP/Gusto/Paychex típicos como suscripción; chargebacks/check returns; cargos NSF/OD/overdraft;",
              "licorerías/coffee shops genéricos/micro-bares solo si aparecen cargos repetidos y homogéneos en fecha y monto típicos de suscripción (si no, omitir). normalizedName debe ser una marca conocida cuando aplique (Netflix, Spotify, Apple, Adobe, etc.).",
              "",
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

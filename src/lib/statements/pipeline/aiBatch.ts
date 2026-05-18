import OpenAI from "openai";
import type { Transaction } from "../types";

const MODEL_DEFAULT = "gpt-4o";
const MAX_BATCH = 24;
const MAX_LINE_CHARS = 400;

type AiResultRow = {
  lineIndex: number;
  isTransaction: boolean;
  date: string | null;
  merchant: string | null;
  amount: number | null;
  type: "debit" | "credit" | null;
  currency: string | null;
  recurringLikelihood: number;
  subscriptionLikelihood: number;
};

function coerceBatchTransaction(
  row: AiResultRow,
  fallbackYear: number
): Transaction | null {
  if (!row.isTransaction) return null;
  const date = typeof row.date === "string" ? row.date.trim() : "";
  const description =
    typeof row.merchant === "string" ? row.merchant.trim() : "";
  const amount =
    typeof row.amount === "number" ? row.amount : Number(row.amount);
  const type = row.type === "credit" || row.type === "debit" ? row.type : null;
  const currency =
    typeof row.currency === "string" && row.currency.trim()
      ? row.currency.trim().toUpperCase()
      : "USD";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!description || description.length > 500) return null;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) return null;
  if (!type) return null;

  if (Number(date.slice(0, 4)) < 1990 || Number(date.slice(0, 4)) > fallbackYear + 1)
    return null;

  return {
    date,
    description,
    amount: Math.abs(amount),
    type,
    currency,
  };
}

/**
 * Classifies ambiguous statement lines. Structured JSON only.
 */
export async function disambiguateLineBatches(
  payloads: Array<{ globalIndex: number; text: string }>,
  fallbackYear: number,
  signal: AbortSignal
): Promise<{ transactions: Transaction[]; error: string | null }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || !payloads.length) {
    return { transactions: [], error: null };
  }

  const model =
    process.env.OPENAI_TRANSACTIONS_MODEL?.trim() || MODEL_DEFAULT;
  const client = new OpenAI({ apiKey });

  const batches: (typeof payloads)[] = [];
  for (let i = 0; i < payloads.length; i += MAX_BATCH) {
    batches.push(payloads.slice(i, i + MAX_BATCH));
  }

  const merged: Transaction[] = [];

  for (const batch of batches) {
    const body = batch
      .map(
        (p, i) =>
          `${i}. ${p.text.slice(0, MAX_LINE_CHARS).replace(/\n/gu, " ")}`
      )
      .join("\n");

    try {
      const completion = await client.chat.completions.create(
        {
          model,
          temperature: 0.05,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: [
                "You classify lines from bank or card statement plain text.",
                "Return ONLY valid JSON: {\"results\":[{\"lineIndex\":number,\"isTransaction\":boolean,",
                "\"date\":\"YYYY-MM-DD\"|null,\"merchant\":string|null,\"amount\":number|null,",
                "\"type\":\"debit\"|\"credit\"|null,\"currency\":\"ISO4217\"|null,",
                "\"recurringLikelihood\":0-1 number,\"subscriptionLikelihood\":0-1 number}]}",
                "lineIndex MUST be the index number shown before each line (0-based within this batch).",
                "isTransaction true only for a single purchase, fee, refund, or payment line with a clear amount.",
                "Use debit for charges/purchases/withdrawals; credit for refunds/credits/reversed debits.",
                "Never output balances, statement totals, interest summaries, legal text, addresses, or page headers.",
                "If uncertain, set isTransaction false. Prefer false positives rejection.",
              ].join(" "),
            },
            {
              role: "user",
              content: `Default year context: ${fallbackYear}\n\nLines:\n${body}`,
            },
          ],
        },
        { signal }
      );

      const content = completion.choices[0]?.message?.content?.trim();
      if (!content) continue;

      const parsed = JSON.parse(content) as { results?: AiResultRow[] };
      const rows = Array.isArray(parsed.results) ? parsed.results : [];

      for (const r of rows) {
        const tx = coerceBatchTransaction(r, fallbackYear);
        if (tx) merged.push(tx);
      }
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "AI batch disambiguation failed";
      return { transactions: merged, error: msg };
    }
  }

  return { transactions: merged, error: null };
}

import OpenAI from "openai";
import { sanitizeStatementTransactions } from "./parseTransactions";
import type { Transaction } from "./types";

const MODEL_DEFAULT = "gpt-4o-mini";
const MAX_CHARS = 14_000;

function coerceTransaction(raw: unknown): Transaction | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const date = typeof o.date === "string" ? o.date.trim() : "";
  const description =
    typeof o.description === "string" ? o.description.trim() : "";
  const amount = typeof o.amount === "number" ? o.amount : Number(o.amount);
  const type = o.type === "credit" || o.type === "debit" ? o.type : null;
  const currency =
    typeof o.currency === "string" && o.currency.trim()
      ? o.currency.trim().toUpperCase()
      : "USD";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!description || description.length > 500) return null;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) return null;
  if (!type) return null;

  return { date, description, amount: Math.abs(amount), type, currency };
}

function inferSanitizeYear(rows: Transaction[]): number {
  if (!rows.length) return new Date().getFullYear();
  const y = Number(rows[0].date.slice(0, 4));
  return Number.isFinite(y) && y >= 1990 ? y : new Date().getFullYear();
}

/**
 * When heuristic parsing finds zero rows, ask the model once for structured rows.
 * Uses the same OPENAI_API_KEY as subscription analysis.
 */
export async function extractTransactionsViaOpenAI(
  fullText: string,
  signal: AbortSignal
): Promise<{ transactions: Transaction[]; error: string | null }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { transactions: [], error: null };
  }

  const model =
    process.env.OPENAI_TRANSACTIONS_MODEL?.trim() || MODEL_DEFAULT;
  const snippet = fullText.slice(0, MAX_CHARS);

  const client = new OpenAI({ apiKey });

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
              "You extract banking/credit-card transactions from statement plain text. " +
              "Return ONLY JSON: {\"transactions\":[{\"date\":\"YYYY-MM-DD\",\"description\":\"string\",\"amount\":positive number,\"type\":\"debit\"|\"credit\",\"currency\":\"USD\"}]}. " +
              "Use debit for purchases/withdrawals/fees and credit for refunds/deposits/payments-received when sign is ambiguous. " +
              "Normalize dates to ISO. Omit page headers/footers, account numbers, addresses, routing numbers, " +
              "beginning/ending balances, summary totals (deposits+additions, withdrawals+subtractions), payroll lines, legal/marketing/disclosure paragraphs, phone numbers, and customer-service blurbs.",
          },
          {
            role: "user",
            content:
              "Extract all transactions from this statement fragment:\n\n" +
              snippet,
          },
        ],
      },
      { signal }
    );

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) return { transactions: [], error: null };

    const parsed = JSON.parse(content) as { transactions?: unknown[] };
    const rows = Array.isArray(parsed.transactions)
      ? parsed.transactions
      : [];

    const coerced = rows
      .map(coerceTransaction)
      .filter((x): x is Transaction => Boolean(x));
    const transactions = sanitizeStatementTransactions(
      coerced,
      inferSanitizeYear(coerced)
    );

    transactions.sort((a, b) => a.date.localeCompare(b.date));

    return { transactions, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "OpenAI transaction fallback failed";
    return { transactions: [], error: msg };
  }
}

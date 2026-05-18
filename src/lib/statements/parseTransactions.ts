import { runTransactionPipeline } from "./pipeline/runPipeline";
export { sanitizeStatementTransactions } from "./pipeline/validateRow";
export type { ParsePipelineDebug } from "./types";

import type { ParsePipelineDebug, Transaction } from "./types";

/**
 * Full multi-stage pipeline: normalize → reconstruct → score → regex extract → AI batches → optional full-text AI.
 */
export async function parseTransactionsFromText(
  text: string,
  signal: AbortSignal
): Promise<{ transactions: Transaction[]; debug: ParsePipelineDebug }> {
  return runTransactionPipeline(text, signal);
}

export function deriveStatementPeriod(
  transactions: Transaction[]
): { start: string; end: string } | null {
  if (!transactions.length) return null;
  let start = transactions[0].date;
  let end = transactions[0].date;
  for (const t of transactions) {
    if (t.date < start) start = t.date;
    if (t.date > end) end = t.date;
  }
  return { start, end };
}

import { runTransactionPipeline } from "./pipeline/runPipeline";
export { sanitizeStatementTransactions } from "./pipeline/validateRow";
export type { ParsePipelineDebug } from "./types";
export {
  deriveStatementPeriod,
  deriveStatementPeriodFromDates,
  isValidTransactionDate,
  normalizeStatementPeriod,
} from "./intelligence/period";

import type { ParsePipelineDebug } from "./types";

/**
 * Full multi-stage pipeline: normalize → reconstruct → score → regex extract → AI batches → optional full-text AI.
 */
export async function parseTransactionsFromText(
  text: string,
  signal: AbortSignal
): Promise<{ transactions: import("./types").Transaction[]; debug: ParsePipelineDebug }> {
  return runTransactionPipeline(text, signal);
}

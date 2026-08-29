/**
 * Paid OpenAI *statement explanation* must be explicitly opt-in.
 * Independent from OPENAI_ENRICHMENT_ENABLED — neither flag enables the other.
 *
 * Enable with: OPENAI_STATEMENT_EXPLANATION_ENABLED=true (and OPENAI_API_KEY).
 */

const TRUE_FLAGS = new Set(["1", "true", "yes"]);

function flagEnabled(raw: string | undefined): boolean {
  const flag = raw?.trim().toLowerCase();
  return flag != null && TRUE_FLAGS.has(flag);
}

/** True only when explanation is explicitly enabled and a key is present. */
export function isOpenAiStatementExplanationEnabled(): boolean {
  if (!flagEnabled(process.env.OPENAI_STATEMENT_EXPLANATION_ENABLED)) {
    return false;
  }
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/** API key only when statement explanation is enabled; otherwise null. */
export function getOpenAiApiKeyForStatementExplanation(): string | null {
  if (!isOpenAiStatementExplanationEnabled()) return null;
  return process.env.OPENAI_API_KEY?.trim() || null;
}

export function getStatementExplanationModel(): string {
  const model = process.env.OPENAI_STATEMENT_EXPLANATION_MODEL?.trim();
  return model || "gpt-4o-mini";
}

export function getStatementExplanationTimeoutMs(): number {
  const raw = Number(process.env.OPENAI_STATEMENT_EXPLANATION_TIMEOUT_MS?.trim());
  if (Number.isFinite(raw) && raw >= 1_000 && raw <= 60_000) {
    return Math.floor(raw);
  }
  return 12_000;
}

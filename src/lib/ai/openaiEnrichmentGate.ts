/**
 * Paid OpenAI enrichment must be explicitly opt-in.
 * Setting OPENAI_API_KEY alone never enables statement or shopping AI calls.
 *
 * Enable with: OPENAI_ENRICHMENT_ENABLED=true (and OPENAI_API_KEY).
 */
export function isOpenAiEnrichmentEnabled(): boolean {
  const flag = process.env.OPENAI_ENRICHMENT_ENABLED?.trim().toLowerCase();
  if (flag !== "1" && flag !== "true" && flag !== "yes") {
    return false;
  }
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/** Returns the API key only when enrichment is explicitly enabled; otherwise null. */
export function getOpenAiApiKeyIfEnabled(): string | null {
  if (!isOpenAiEnrichmentEnabled()) return null;
  return process.env.OPENAI_API_KEY?.trim() || null;
}

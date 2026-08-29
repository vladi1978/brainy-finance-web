/** Hard limits for the sanitized explanation fact contract and AI response. */

export const EXPLANATION_MAX_CATEGORIES = 8;
export const EXPLANATION_MAX_FINDINGS = 5;
export const EXPLANATION_MAX_FACTS = 48;
export const EXPLANATION_MAX_NOTICES = 6;
export const EXPLANATION_MAX_PROVIDERS = 4;

export const EXPLANATION_MAX_LABEL_CHARS = 80;
export const EXPLANATION_MAX_NOTICE_CHARS = 180;
export const EXPLANATION_MAX_PROVIDER_CHARS = 40;
export const EXPLANATION_MAX_FACT_ID_CHARS = 64;

export const EXPLANATION_HEADLINE_MAX = 100;
export const EXPLANATION_SUMMARY_MAX = 500;
export const EXPLANATION_MAX_OBSERVATIONS = 4;
export const EXPLANATION_MAX_QUESTIONS = 3;
export const EXPLANATION_MAX_OBSERVATION_CHARS = 280;
export const EXPLANATION_MAX_QUESTION_CHARS = 160;
export const EXPLANATION_MAX_FACT_IDS_PER_OBS = 6;

/** Soft rate limit (per-instance memory — see docs). */
export const EXPLANATION_RATE_LIMIT_WINDOW_MS = 60_000;
export const EXPLANATION_RATE_LIMIT_MAX = 8;
/** Cap distinct client keys retained in memory after expiry eviction. */
export const EXPLANATION_RATE_LIMIT_KEY_CAP = 2_000;

/** Hard OpenAI completion budget for explanation JSON. */
export const EXPLANATION_OPENAI_MAX_OUTPUT_TOKENS = 700;
export const EXPLANATION_OPENAI_TEMPERATURE = 0.2;

export const AI_EXPLANATION_DISCLOSURE =
  "AI explains Brainy’s verified statement facts. It does not change transactions, totals, categories, Statement Health, or comparison calculations.";

export const AI_EXPLANATION_EDUCATIONAL_DISCLAIMER =
  "Educational explanation only — not financial, legal, tax, credit, debt-settlement, or accounting advice. Brainy’s deterministic totals remain authoritative.";

/** Shown when the explanation feature flag is off (not a provider failure). */
export const AI_EXPLANATION_DISABLED_SUMMARY_LABEL =
  "AI explanation is off — showing Brainy’s verified summary.";

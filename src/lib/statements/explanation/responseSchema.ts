/**
 * Strict runtime validation for statement AI explanation responses.
 * No external schema dependency — small allowlist validator.
 */

import {
  EXPLANATION_HEADLINE_MAX,
  EXPLANATION_MAX_FACT_IDS_PER_OBS,
  EXPLANATION_MAX_OBSERVATION_CHARS,
  EXPLANATION_MAX_OBSERVATIONS,
  EXPLANATION_MAX_QUESTION_CHARS,
  EXPLANATION_MAX_QUESTIONS,
  EXPLANATION_SUMMARY_MAX,
} from "./constants";

export type ExplanationObservation = {
  factIds: string[];
  explanation: string;
};

export type ExplanationAiResponse = {
  headline: string;
  summary: string;
  observations: ExplanationObservation[];
  questionsToConsider: string[];
};

const ALLOWED_TOP = new Set([
  "headline",
  "summary",
  "observations",
  "questionsToConsider",
]);
const ALLOWED_OBS = new Set(["factIds", "explanation"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function asTrimmedString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > max) return null;
  return t;
}

export type SchemaValidationResult =
  | { ok: true; value: ExplanationAiResponse }
  | { ok: false; reason: string };

export function parseExplanationAiResponse(
  raw: unknown
): SchemaValidationResult {
  if (!isPlainObject(raw)) return { ok: false, reason: "not_object" };

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_TOP.has(key)) {
      return { ok: false, reason: `unknown_field:${key}` };
    }
  }

  const headline = asTrimmedString(raw.headline, EXPLANATION_HEADLINE_MAX);
  const summary = asTrimmedString(raw.summary, EXPLANATION_SUMMARY_MAX);
  if (!headline) return { ok: false, reason: "bad_headline" };
  if (!summary) return { ok: false, reason: "bad_summary" };

  if (!Array.isArray(raw.observations)) {
    return { ok: false, reason: "bad_observations" };
  }
  if (raw.observations.length > EXPLANATION_MAX_OBSERVATIONS) {
    return { ok: false, reason: "too_many_observations" };
  }

  const observations: ExplanationObservation[] = [];
  for (const obs of raw.observations) {
    if (!isPlainObject(obs)) return { ok: false, reason: "bad_observation" };
    for (const key of Object.keys(obs)) {
      if (!ALLOWED_OBS.has(key)) {
        return { ok: false, reason: `unknown_obs_field:${key}` };
      }
    }
    if (!Array.isArray(obs.factIds) || obs.factIds.length < 1) {
      return { ok: false, reason: "missing_fact_ids" };
    }
    if (obs.factIds.length > EXPLANATION_MAX_FACT_IDS_PER_OBS) {
      return { ok: false, reason: "too_many_fact_ids" };
    }
    const factIds: string[] = [];
    for (const id of obs.factIds) {
      if (typeof id !== "string" || !/^[a-z][a-z0-9._-]*$/i.test(id)) {
        return { ok: false, reason: "bad_fact_id" };
      }
      factIds.push(id);
    }
    const explanation = asTrimmedString(
      obs.explanation,
      EXPLANATION_MAX_OBSERVATION_CHARS
    );
    if (!explanation) return { ok: false, reason: "bad_observation_text" };
    observations.push({ factIds, explanation });
  }

  if (!Array.isArray(raw.questionsToConsider)) {
    return { ok: false, reason: "bad_questions" };
  }
  if (raw.questionsToConsider.length > EXPLANATION_MAX_QUESTIONS) {
    return { ok: false, reason: "too_many_questions" };
  }

  const questionsToConsider: string[] = [];
  for (const q of raw.questionsToConsider) {
    const text = asTrimmedString(q, EXPLANATION_MAX_QUESTION_CHARS);
    if (!text) return { ok: false, reason: "bad_question" };
    questionsToConsider.push(text);
  }

  return {
    ok: true,
    value: { headline, summary, observations, questionsToConsider },
  };
}

export function parseExplanationAiJson(
  content: string
): SchemaValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, reason: "malformed_json" };
  }
  return parseExplanationAiResponse(parsed);
}

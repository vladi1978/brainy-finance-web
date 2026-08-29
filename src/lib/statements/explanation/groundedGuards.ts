/**
 * Grounded-output guards for statement AI explanations.
 * Fail closed — prompt instructions are not sufficient alone.
 */

import type { ExplanationFactContract } from "./factContract";
import { allowedNumericLiterals, factIdSet } from "./factContract";
import type { ExplanationAiResponse } from "./responseSchema";
import { containsProhibitedSensitiveResidue } from "./redaction";

const PROHIBITED_CLAIM_RE =
  /\b(?:guaranteed?\s+savings?|you\s+will\s+save|cancel(?:lation)?\s+(?:is\s+)?(?:free|easy)|eligible\s+for|you\s+are\s+eligible|pre-?approved|approval\s+guaranteed|legal\s+right|your\s+rights?\s+under|exact\s+APR|APR\s+of\s+\d|interest\s+rate\s+of\s+\d|provider\s+(?:promises?|guarantees?)|we\s+guarantee|debt\s+settlement\s+will|forgive(?:ness)?\s+of\s+debt)\b/iu;

const STOP_PAYING_DEBT_RE =
  /\b(?:stop\s+paying\s+(?:your\s+)?debt|don'?t\s+pay\s+(?:your\s+)?(?:creditors?|debt)|default\s+on\s+your\s+(?:loan|debt)|ignore\s+your\s+(?:creditors?|collections?))\b/iu;

const DEFINITIVE_COMPARISON_RE =
  /\b(?:definitely|certainly|conclusively|proven\s+that|this\s+proves|without\s+(?:any\s+)?doubt|the\s+sole\s+cause|caused\s+entirely)\b/iu;

const CURRENCY_RE =
  /(?:USD\s*)?\$?\s*-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\b-?\d+\.\d{2}\b/gu;
const PERCENT_RE = /-?\d+(?:\.\d+)?\s*%/gu;

export type GroundingResult =
  | { ok: true }
  | { ok: false; reason: string };

function normalizeAmountToken(raw: string): string[] {
  const cleaned = raw.replace(/[$,\s]|USD/giu, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return [];
  const r = Math.round(n * 100) / 100;
  return [
    r.toFixed(2),
    String(r),
    Math.abs(r).toFixed(2),
    String(Math.abs(r)),
    String(Number(r.toFixed(2))),
  ];
}

function allResponseText(response: ExplanationAiResponse): string {
  const parts = [
    response.headline,
    response.summary,
    ...response.observations.map((o) => o.explanation),
    ...response.questionsToConsider,
  ];
  return parts.join("\n");
}

export function assertGroundedExplanation(
  response: ExplanationAiResponse,
  contract: ExplanationFactContract
): GroundingResult {
  const ids = factIdSet(contract);
  for (const obs of response.observations) {
    for (const id of obs.factIds) {
      if (!ids.has(id)) {
        return { ok: false, reason: `unknown_fact_id:${id}` };
      }
    }
  }

  const text = allResponseText(response);
  if (containsProhibitedSensitiveResidue(text)) {
    return { ok: false, reason: "sensitive_residue" };
  }
  if (PROHIBITED_CLAIM_RE.test(text)) {
    return { ok: false, reason: "prohibited_claim" };
  }
  if (STOP_PAYING_DEBT_RE.test(text)) {
    return { ok: false, reason: "stop_paying_debt" };
  }
  if (contract.isProvisional && DEFINITIVE_COMPARISON_RE.test(text)) {
    return { ok: false, reason: "definitive_on_provisional" };
  }

  const { amounts, percents } = allowedNumericLiterals(contract);

  const currencyMatches = text.match(CURRENCY_RE) ?? [];
  for (const match of currencyMatches) {
    const variants = normalizeAmountToken(match);
    if (!variants.length) continue;
    const allowed = variants.some((v) => amounts.has(v));
    // Ignore lone integers that are year-like / small ordinals without decimals
    // when they don't look like money (no $ and no .xx)
    if (!/\$/.test(match) && !/\.\d{2}\b/.test(match) && !/,/.test(match)) {
      const n = Number(match.replace(/[^\d.-]/g, ""));
      if (Number.isFinite(n) && Math.abs(n) < 100 && Number.isInteger(n)) {
        continue;
      }
    }
    if (!allowed) {
      return { ok: false, reason: `invented_currency:${match}` };
    }
  }

  const percentMatches = text.match(PERCENT_RE) ?? [];
  for (const match of percentMatches) {
    const num = match.replace(/%/g, "").trim();
    const n = Number(num);
    if (!Number.isFinite(n)) {
      return { ok: false, reason: `invented_percent:${match}` };
    }
    const variants = [
      String(n),
      n.toFixed(1),
      n.toFixed(2),
      String(Math.abs(n)),
      Math.abs(n).toFixed(1),
    ];
    if (!variants.some((v) => percents.has(v))) {
      return { ok: false, reason: `invented_percent:${match}` };
    }
  }

  return { ok: true };
}

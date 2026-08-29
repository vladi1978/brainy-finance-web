/**
 * Grounded-output guards for statement AI explanations.
 * Fail closed — prompt instructions are not sufficient alone.
 */

import type { ExplanationFactContract } from "./factContract";
import { allowedNumericLiterals, factIdSet } from "./factContract";
import type { ExplanationAiResponse } from "./responseSchema";
import { containsProhibitedSensitiveResidue } from "./redaction";

const PROHIBITED_CLAIM_RE =
  /\b(?:guaranteed?\s+savings?|you\s+will\s+save|cancel(?:lation)?\s+(?:is\s+)?(?:free|easy)|you\s+should\s+cancel|eligible\s+for|you\s+are\s+eligible|pre-?approved|approval\s+guaranteed|legal\s+(?:right|advice)|your\s+rights?\s+under|tax\s+advice|accounting\s+advice|credit\s+advice|debt[- ]settlement(?:\s+advice)?|exact\s+APR|APR\s+of\s+\d|interest\s+rate\s+of\s+\d|provider\s+(?:promises?|guarantees?)|we\s+guarantee|debt\s+settlement\s+will|forgive(?:ness)?\s+of\s+debt)\b/iu;

const STOP_PAYING_DEBT_RE =
  /\b(?:stop\s+paying\s+(?:your\s+)?debt|don'?t\s+pay\s+(?:your\s+)?(?:creditors?|debt)|default\s+on\s+your\s+(?:loan|debt)|ignore\s+your\s+(?:creditors?|collections?))\b/iu;

const DEFINITIVE_COMPARISON_RE =
  /\b(?:definitely|certainly|conclusively|proven\s+that|this\s+proves|without\s+(?:any\s+)?doubt|the\s+sole\s+cause|caused\s+entirely)\b/iu;

/**
 * Currency forms that look like money — never bare years or ISO date fragments.
 * Requires $, USD prefix, thousands separators, or exact .xx cents.
 * `$` amounts use `\d+` so `$1500.25` is not truncated to `$150`.
 */
const CURRENCY_RE =
  /(?:USD\s*)?\$\s*-?\d+(?:,\d{3})*(?:\.\d{1,2})?|\b-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b|\b-?\d+\.\d{2}\b/gu;

const PERCENT_RE = /-?\d+(?:\.\d+)?\s*%/gu;

/** Worded amounts / percents — reject (model must use numeric fact values). */
const WORDED_MONEY_RE =
  /\b(?:(?:a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)(?:[\s-]+(?:a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion))*)\s+dollars?\b|\b\d[\d,]*(?:\.\d+)?\s+dollars?\b/iu;

const WORDED_PERCENT_RE =
  /\b(?:(?:a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)(?:[\s-]+(?:a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred))*)\s+percent\b|\b\d+(?:\.\d+)?\s+percent\b/iu;

const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/gu;

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

/** Mask ISO dates so currency scanners cannot misread year fragments. */
export function maskIsoDatesForGrounding(text: string): string {
  return text.replace(ISO_DATE_RE, "[date]");
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
  if (WORDED_MONEY_RE.test(text)) {
    return { ok: false, reason: "worded_currency" };
  }
  if (WORDED_PERCENT_RE.test(text)) {
    return { ok: false, reason: "worded_percent" };
  }

  const { amounts, percents } = allowedNumericLiterals(contract);
  const scanText = maskIsoDatesForGrounding(text);

  const currencyMatches = scanText.match(CURRENCY_RE) ?? [];
  for (const match of currencyMatches) {
    const variants = normalizeAmountToken(match);
    if (!variants.length) continue;
    const allowed = variants.some((v) => amounts.has(v));
    if (!allowed) {
      return { ok: false, reason: `invented_currency:${match}` };
    }
  }

  const percentMatches = scanText.match(PERCENT_RE) ?? [];
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

import { AMOUNT_TOKEN } from "./constants";
import {
  ACCOUNT_NUM_LIKE_LINE,
  ACCOUNT_SUMMARY_WORDING,
  BANK_MARKETING_BLURB,
  DROP_LINE_METADATA,
  LEGAL_SENTENCE_GUARD,
  NOISE_DESCRIPTION,
  OVERDRAFT_NOTICE,
  PAGE_HEADER_SIMPLE,
  ROUTING_ROUTING_IDS,
  SKIP_LINE,
  SOFT_BOILERPLATE,
  STREET_PLUS_ZIP,
  SUPPORT_LEGAL_BOILERPLATE,
} from "./noise";
import { matchDateSubstring, stripLeadingNoise } from "./dates";
import {
  countParsableMoneyTokens,
  parseAmountFragment,
} from "./amounts";

const TXN_KEYWORD =
  /\b(?:purchase|payment|pmt|debit|credit|withdrawal|transfer|pos|card|compra|pago|cargo|abono|retrait|paiement|acquisto|zahlung)\b/ui;

const RECURRING_KEYWORD =
  /\b(?:subscription|recurring|monthly|annual|weekly|renews|auto-?pay|membership|suscripci|abono\s+automatic|prélèvement)\b/ui;

export type CandidateScoreResult = {
  score: number;
  reasons: string[];
  hasDate: boolean;
  hasAmount: boolean;
  dateEarly: boolean;
  amountAtEnd: boolean;
};

const MAX_REASONABLE_TXN_LEN = 200;
const PARAGRAPH_LEN = 160;

function descriptionLetters(text: string): number {
  return text.replace(/[^a-zA-Z\u00C0-\u024f]/gu, "").length;
}

export function scoreTransactionCandidate(
  line: string,
  defaultYear: number
): CandidateScoreResult {
  const reasons: string[] = [];
  let score = 0.35;
  const t = stripLeadingNoise(line.trim());
  const tUpper = t.toUpperCase();

  if (!t.length) {
    return {
      score: 0,
      reasons: ["vacía"],
      hasDate: false,
      hasAmount: false,
      dateEarly: false,
      amountAtEnd: false,
    };
  }

  if (SKIP_LINE.test(t) || PAGE_HEADER_SIMPLE.test(t)) {
    reasons.push("encabezado/página");
    return {
      score: 0.05,
      reasons,
      hasDate: false,
      hasAmount: false,
      dateEarly: false,
      amountAtEnd: false,
    };
  }

  const dh = matchDateSubstring(t, defaultYear);
  const hasDate = Boolean(dh);
  let dateEarly = false;
  if (dh) {
    if (dh.start <= 6) {
      score += 0.22;
      dateEarly = true;
      reasons.push("+fecha al inicio");
    } else if (dh.start <= 36) {
      score += 0.14;
      reasons.push("+fecha en la línea");
    } else {
      score += 0.06;
      reasons.push("+fecha tardía");
    }
  } else {
    reasons.push("sin fecha reconocible");
  }

  AMOUNT_TOKEN.lastIndex = 0;
  const amountMatches = [...t.matchAll(AMOUNT_TOKEN)];
  const parsedParts = amountMatches
    .map((m) => ({ m, p: parseAmountFragment(m[0]) }))
    .filter((x) => x.p && Math.abs(x.p.value) > 1e-9);
  const hasAmount = parsedParts.length > 0;
  let amountAtEnd = false;
  if (parsedParts.length) {
    const last = parsedParts[parsedParts.length - 1];
    const endIdx = last.m.index! + last.m[0].length;
    if (t.trimEnd().length - endIdx <= 6) {
      score += 0.2;
      amountAtEnd = true;
      reasons.push("+importe al final");
    } else {
      score += 0.08;
      reasons.push("+importe en línea");
    }
  } else {
    reasons.push("sin importe reconocible");
  }

  const moneyCount = countParsableMoneyTokens(t);
  if (moneyCount > 2) {
    score -= 0.18;
    reasons.push("-varios importes (posible resumen)");
  }

  const letters = descriptionLetters(t);
  if (letters >= 4 && t.length >= 6 && t.length <= MAX_REASONABLE_TXN_LEN) {
    score += 0.12;
    reasons.push("+texto tipo comercio");
  }

  if (TXN_KEYWORD.test(t)) {
    score += 0.06;
    reasons.push("+palabra de cargo");
  }

  if (RECURRING_KEYWORD.test(t)) {
    score += 0.04;
    reasons.push("+posible recurrente");
  }

  if (t.length > PARAGRAPH_LEN) {
    score -= 0.12;
    reasons.push("-línea larga (párrafo)");
  }

  if (t.length > MAX_REASONABLE_TXN_LEN) {
    score -= 0.08;
    reasons.push("-exceso de longitud");
  }

  if (NOISE_DESCRIPTION.test(t) || DROP_LINE_METADATA.test(t)) {
    score -= 0.28;
    reasons.push("-balance o resumen");
  }

  if (ACCOUNT_SUMMARY_WORDING.test(t)) {
    score -= 0.22;
    reasons.push("-texto de resumen de cuenta");
  }

  if (SUPPORT_LEGAL_BOILERPLATE.test(t) || LEGAL_SENTENCE_GUARD.test(t)) {
    score -= 0.18;
    reasons.push("-legal/soporte");
  }

  if (OVERDRAFT_NOTICE.test(t)) {
    score -= 0.12;
    reasons.push("-overdraft/NSF explicación");
  }

  if (BANK_MARKETING_BLURB.test(t) || SOFT_BOILERPLATE.test(t)) {
    score -= 0.1;
    reasons.push("-marketing/boilerplate");
  }

  if (STREET_PLUS_ZIP.test(t)) {
    score -= 0.15;
    reasons.push("-dirección postal");
  }

  if (ROUTING_ROUTING_IDS.test(t) || ACCOUNT_NUM_LIKE_LINE.test(t)) {
    score -= 0.2;
    reasons.push("-datos de cuenta/routing");
  }

  const upperRatio =
    letters > 0
      ? (tUpper.replace(/[^A-Z]/gu, "").length / letters)
      : 0;
  if (t.length > 40 && upperRatio > 0.88) {
    score -= 0.08;
    reasons.push("-texto todo mayúsculas");
  }

  score = Math.max(0, Math.min(1, score));

  return {
    score,
    reasons,
    hasDate,
    hasAmount,
    dateEarly,
    amountAtEnd,
  };
}

/** Minimum signals for any automated extraction attempt */
export function candidateMeetsHardGate(cs: CandidateScoreResult): boolean {
  return cs.hasDate && cs.hasAmount && cs.score >= 0.28;
}

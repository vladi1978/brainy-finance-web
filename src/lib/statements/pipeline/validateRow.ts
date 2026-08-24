import { DROP_LINE_METADATA, NOISE_DESCRIPTION, PHONE_PRIMARY } from "./noise";
import type { ParsedRow } from "./extractRow";
import type { Transaction } from "../types";
import { matchDateSubstring, stripLeadingNoise } from "./dates";
import { isValidTransactionDate } from "../intelligence/period";

export const LARGE_TXN_AMOUNT = 25_000;
export const HIGH_PARSE_CONFIDENCE = 0.82;

const IGNORE_KEYWORDS =
  /\b(?:balance|\b(?:account|acct)\b|customers?\s+service|important\s+information|privacy\s+(?:notice|policy)|\bbanking\b|\bsummary\b|\b(?:bank\s+)?statement\b|deposit\s+accounts|online\s+banking|total\s+overdraft\s+fees|total\s+service\s+fees|total\s+nsf|calculated\s+on\s+a\s+purchase|preferred\s+rewards|customer\s+bonus)\b/ui;

const BANK_DESCRIPTOR =
  /\b(CHECKCARD|DEBIT\s+CARD|POS\b|PURCHASE|MOBILE\s+PURCHASE|DES:|INDN:|CO ID:|PMNT|WEB\b|CHECK\s+CARD)\b/ui;

function descriptionLooksMerchantLike(description: string): boolean {
  const d = description.trim().replace(/\s+/gu, " ");
  if (d.length < 3 || d.length > 400) return false;
  const letters = d.replace(/[^a-zA-Z\u00C0-\u024f]/gu, "").length;
  if (letters < 3) return false;
  if (NOISE_DESCRIPTION.test(d) || DROP_LINE_METADATA.test(d)) return false;
  const tokenish = d.split(/\s+/u).filter((w) => /[A-Za-z\u00C0-\u024f]{3,}/u.test(w));
  if (!tokenish.length) return false;
  return true;
}

function isDominantUppercaseLegalText(text: string): boolean {
  if (BANK_DESCRIPTOR.test(text)) return false;
  const letters = text.replace(/[^a-zA-Z]/gu, "");
  if (letters.length < 26) return false;
  const up = letters.replace(/[^A-Z]/gu, "").length;
  return up / letters.length > 0.88;
}

function containsAccountNumberSignals(text: string): boolean {
  if (/\b(?:acct|account)\s+(?:number|no\.|#)/ui.test(text)) return true;
  if (/\*{3,}\d{3,}/u.test(text)) return true;
  // Long card-auth reference numbers are not account numbers.
  if (/\b\d{17,}\b/u.test(text) && !BANK_DESCRIPTOR.test(text)) return true;
  return false;
}

function parseRowConfidence(
  block: string,
  row: ParsedRow,
  defaultYear: number
): number {
  let c = 0.48;
  const b = stripLeadingNoise(block.trim());
  const dh = matchDateSubstring(b, defaultYear);
  if (dh && dh.start <= 8) c += 0.2;

  if (row.strategy.includes("dual-column")) c += 0.12;
  else if (row.strategy.includes("labeled")) c += 0.08;
  else if (row.strategy.includes("fallback")) c -= 0.07;
  else if (row.strategy.includes("ai-batch")) c -= 0.04;

  if (descriptionLooksMerchantLike(row.description)) c += 0.14;

  const L = row.description.length;
  if (L >= 5 && L <= 92) c += 0.06;

  if (row.amount > 0 && row.amount <= 2500) c += 0.05;
  if (row.amount > LARGE_TXN_AMOUNT) c -= 0.12;

  return Math.min(1, Math.max(0, c));
}

export function passesPostParseValidation(
  block: string,
  row: ParsedRow,
  defaultYear: number,
  sourcePenalty = 0
): boolean {
  if (!descriptionLooksMerchantLike(row.description)) return false;
  if (!isValidTransactionDate(row.date)) return false;
  if (containsAccountNumberSignals(row.description)) return false;
  if (isDominantUppercaseLegalText(row.description)) return false;

  if (IGNORE_KEYWORDS.test(row.description)) return false;

  if (PHONE_PRIMARY.test(row.description) && row.description.length < 48) {
    return false;
  }

  if (row.amount <= 0 || row.amount > 1e7) return false;

  let conf = parseRowConfidence(block, row, defaultYear) + sourcePenalty;
  conf = Math.min(1, conf);
  if (row.amount > LARGE_TXN_AMOUNT && conf < HIGH_PARSE_CONFIDENCE) return false;
  return true;
}

/** Drop AI-derived rows that still look like summaries or legal noise */
export function sanitizeStatementTransactions(
  rows: Transaction[],
  fallbackYear?: number
): Transaction[] {
  const y =
    fallbackYear ??
    (rows[0] && rows[0].date.length >= 4
      ? Number(rows[0].date.slice(0, 4))
      : new Date().getFullYear());
  return rows.filter((t) => {
    const proxy: ParsedRow = { ...t, strategy: "ai-fallback" };
    return passesPostParseValidation(
      `${t.date} ${t.description}`,
      proxy,
      y,
      0.03
    );
  });
}

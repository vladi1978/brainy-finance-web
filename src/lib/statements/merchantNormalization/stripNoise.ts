import { normalizeMerchantText } from "../merchantNormalize";

const NOISE_RE =
  /\b(PURCHASE|CHECKCARD|CHK\s*CARD|POS|DEBIT|CREDIT|AUTHORIZATION|PUR\s+AUTH|MOTO|\bCARD\b|E\s*-?\s*COMMERCE|MERC\s+H|\bATM\b|ELECTRONIC|ACH\s+DEBIT|ACH\s+PAY|ELECT\b|WWW\.?\s*WWW|BILL\s+PAY|BILLPAY|RECURRING|SUBSCRIPTION|SUBSCR|MEMBERSHIP|SERVICES?|PAYMENT|PMT|PAY)\b/giu;

const DATE_RE =
  /\b(?:\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}|(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*\d{1,2})\b/giu;

/** Strip statement noise while preserving brand tokens for normalization. */
export function stripMerchantDescriptorNoise(description: string): string {
  let s = normalizeMerchantText(description);
  s = s.replace(/[/\\]+/gu, " ");
  s = s.replace(/\b([A-Za-z][A-Za-z0-9+&]*)\s*\.\s*(COM|NET|ORG)\b/giu, "$1");

  for (let i = 0; i < 2; i++) {
    s = s.replace(NOISE_RE, " ");
    s = s.replace(DATE_RE, " ");
  }

  s = s.replace(/\*+\s*\d{2,}\b/gu, " ");
  s = s.replace(/\b\d{9,}\b/gu, " ");
  s = s.replace(/\b\d{6,}\b/gu, " ");
  s = s.replace(/\b\d{4}\s+\d{4}\s+\d{4}\s+\d{4}\b/gu, " ");
  s = s.replace(/\b(?:STORE|ST|LOC|UNIT)\s*#?\s*\d+\b/giu, " ");
  s = s.replace(/\b[A-Z]?\d{1,3}[-\s]\d{1,4}\b/gu, " ");
  s = s.replace(/\b(?:AUTH|APPROVAL|TRACE|REF|SEQ|TRAN)\s*#?\s*[A-Z0-9]+\b/giu, " ");
  s = s.replace(/\b(?:ID|REF)\s+[A-Z0-9]{4,}\b/giu, " ");
  s = s.replace(/\s+[A-Z]{2}\s*$/gu, " ");
  s = s.replace(/\*|#/gu, " ");
  s = s.replace(/\s+/gu, " ").trim();

  return s;
}

export function descriptorNoiseScore(text: string): number {
  const raw = text.replace(/\s+/gu, "");
  if (!raw.length) return 1;
  const digits = (raw.match(/\d/gu) ?? []).length;
  const letters = (raw.match(/[A-Za-z]/gu) ?? []).length;
  const symbols = raw.length - digits - letters;
  return Math.min(1, (digits * 0.55 + symbols * 0.35) / Math.max(1, raw.length));
}

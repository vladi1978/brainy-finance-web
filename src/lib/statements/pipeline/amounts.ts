import { AMOUNT_TOKEN } from "./constants";

/**
 * True money tokens have currency shape (decimals or short integers).
 * Long bare digit runs are auth/ID references, not amounts.
 */
export function isPlausibleMoneyToken(raw: string): boolean {
  const trimmed = raw.trim().replace(/\u2212/gu, "-");
  if (!trimmed) return false;
  const digitRuns = trimmed.match(/\d+/g) ?? [];
  const digitCount = digitRuns.reduce((n, r) => n + r.length, 0);
  const hasDecimal = /[.,]\d{1,2}(?:\b|$)/u.test(trimmed);
  // Bare 6+ digit runs are store/auth/IDs (e.g. MARATHON 184085), not amounts.
  if (!hasDecimal && digitCount >= 6) return false;
  const parsed = parseAmountFragment(trimmed);
  if (!parsed || Math.abs(parsed.value) < 1e-9) return false;
  if (Math.abs(parsed.value) > 1e7) return false;
  return true;
}

export function detectCurrency(amountRaw: string): string {
  if (/€|EUR/i.test(amountRaw)) return "EUR";
  if (/£|GBP/i.test(amountRaw)) return "GBP";
  if (/¥|JPY|JP¥/iu.test(amountRaw)) return "JPY";
  if (/₹|INR/i.test(amountRaw)) return "INR";
  if (/MXN|\$/i.test(amountRaw) && /MXN/i.test(amountRaw)) return "MXN";
  if (/R\$/i.test(amountRaw) || /\bBRL\b/i.test(amountRaw)) return "BRL";
  if (/AUD|A\$/i.test(amountRaw)) return "AUD";
  if (/NZD|NZ\$/i.test(amountRaw)) return "NZD";
  if (/CHF/i.test(amountRaw)) return "CHF";
  if (/\$/u.test(amountRaw) || /USD/i.test(amountRaw)) return "USD";
  return "USD";
}

export function parseAmountFragment(fragment: string): {
  value: number;
  currency: string;
} | null {
  const trimmed = fragment.trim().replace(/\u2212/gu, "-");
  if (!trimmed || /^[*\-–—]+$/.test(trimmed)) return null;

  const currency = detectCurrency(trimmed);
  let s = trimmed.replace(/[^\d.,()+-]/gu, "");
  const negParen = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, "");
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    const parts = s.split(",");
    if (parts.length === 2 && parts[1].length <= 2 && parts[1].length >= 1) {
      s = parts[0].replace(/\./g, "") + "." + parts[1];
    } else {
      s = s.replace(/,/g, "");
    }
  } else {
    s = s.replace(/,/g, "");
  }

  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  const signed = negParen ? -Math.abs(n) : n;
  return { value: signed, currency };
}

export function countParsableMoneyTokens(line: string): number {
  const rx = new RegExp(AMOUNT_TOKEN.source, AMOUNT_TOKEN.flags);
  let n = 0;
  for (const m of line.matchAll(rx)) {
    if (isPlausibleMoneyToken(m[0])) n++;
  }
  return n;
}

export function peelTrailingAmounts(
  rest: string,
  max = 2
): { amounts: string[]; prefix: string } {
  const amounts: string[] = [];
  let cur = rest.trimEnd();
  const peelRe =
    /^([\s\S]+?)(\s+([\u2212+-]?\(?[\p{Sc}]?\s*\d[\d.,]*(?:\.\d{1,2})?\s*\)?(?:\s*(?:USD|EUR|GBP|MXN|CAD|INR|JPY|AUD|NZD|CHF|CR|DR))?))$/iu;

  for (let i = 0; i < max; i++) {
    const mm = cur.match(peelRe);
    if (!mm) break;
    const candidate = mm[2].trim();
    if (!isPlausibleMoneyToken(candidate)) break;
    amounts.unshift(candidate);
    cur = mm[1].trimEnd();
  }

  return { amounts, prefix: cur };
}

export function peelTrailingAmountsTight(rest: string): {
  amounts: string[];
  prefix: string;
} {
  const amounts: string[] = [];
  let cur = rest.trimEnd();
  const peelRe =
    /^([\s\S]+?)(\s*([\u2212+-]?\(?[\p{Sc}]?\s*\d[\d.,]*(?:\.\d{1,2})?\s*\)?(?:\s*(?:USD|EUR|GBP|MXN|CAD|INR|JPY|AUD|NZD|CHF|CR|DR))?))$/iu;

  for (let i = 0; i < 2; i++) {
    const mm = cur.match(peelRe);
    if (!mm) break;
    const candidate = mm[2].trim();
    if (!isPlausibleMoneyToken(candidate)) break;
    amounts.unshift(candidate);
    cur = mm[1].trimEnd();
  }

  return { amounts, prefix: cur };
}

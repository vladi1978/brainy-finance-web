import type { Transaction } from "./types";

const LOG_PREFIX = "[statement-parser]";

/** Month names for universal locale-ish statements */
const MONTH_WORD =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

/** Loose amount token: unicode minus, currency symbols, commas, decimals, negatives, parentheses, trailing CR/DR */
const AMOUNT_TOKEN =
  /[\u2212+-]?\(?[\p{Sc}]?\s*\d[\d.,]*(?:\.\d{1,2})?\s*\)?(?:\s*(?:USD|EUR|GBP|MXN|CAD|INR|JPY|AUD|NZD|CHF|CNY|KRW|BRL|CR|DR))?/giu;

/** Lines that are clearly not transaction rows */
const SKIP_LINE =
  /^(?:page\s+\d|continued|statement\s+period|account\s+(?:number|ending)|routing|total\s+(?:debits|credits)|balance\s+carried|previous\s+balance|new\s+balance)/i;

const NOISE_DESCRIPTION =
  /\b(?:beginning\s+balance|ending\s+balance|opening\s+balance|closing\s+balance|previous\s+balance|available\s+balance|daily\s+balance|minimum\s+payment|payment\s+due|interest\s+(?:charged|earned)|annual\s+percentage)\b/i;

type ParsedRow = Transaction & { strategy: string };

function normalizeRawText(text: string): string {
  return text
    .replace(/\u00a0/gu, " ")
    .replace(/[\u2000-\u200b\u202f\u205f\u3000]/gu, " ")
    .replace(/\r\n?/gu, "\n");
}

function splitPhysicalLines(text: string): string[] {
  return text
    .split(/\n/u)
    .map((l) =>
      l
        .replace(/\t+/gu, " ")
        .replace(/[ \u00a0]{2,}/gu, " ")
        .trim()
    )
    .filter(Boolean);
}

function stripLeadingNoise(line: string): string {
  return line.replace(/^[\s*•●○◦\-–—#|]+\s*/u, "").trimStart();
}

function inferStatementYear(lines: string[]): number {
  const re = /\b(19|20)\d{2}\b/g;
  const counts = new Map<number, number>();
  for (const line of lines.slice(0, 200)) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      const y = Number(m[0]);
      if (y >= 1990 && y <= 2100) counts.set(y, (counts.get(y) ?? 0) + 1);
    }
  }
  if (!counts.size) return new Date().getFullYear();
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function monthIdxFromWord(word: string): string | null {
  const k = word.slice(0, 3).toLowerCase();
  const map: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };
  return map[k] ?? null;
}

/** Month DD [, YYYY] — Jan 15, 2026 / January 15 / Jan 15 26 */
function normalizeMonthFirst(
  raw: string,
  defaultYear?: number
): string | null {
  const m = raw.trim().match(
    new RegExp(
      `^(${MONTH_WORD})\\s+(\\d{1,2})(?:,?\\s*((?:19|20)\\d{2}|\\d{2}))?$`,
      "iu"
    )
  );
  if (!m) return null;
  const mi = monthIdxFromWord(m[1]);
  if (!mi) return null;
  const day = String(Number(m[2])).padStart(2, "0");
  let y: number;
  if (m[3]) {
    y = Number(m[3]);
    if (y < 100) y += 2000;
  } else if (defaultYear != null) {
    y = defaultYear;
  } else {
    return null;
  }
  return `${y}-${mi}-${day}`;
}

function normalizeDate(
  raw: string,
  opts?: { defaultYear?: number }
): string | null {
  const spaced = raw.trim();
  const mf = normalizeMonthFirst(spaced, opts?.defaultYear);
  if (mf) return mf;

  const t = spaced.replace(/\s+/gu, "").trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const mdy = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (mdy) {
    let y = Number(mdy[3]);
    if (y < 100) y += 2000;
    const mo = String(Number(mdy[1])).padStart(2, "0");
    const d = String(Number(mdy[2])).padStart(2, "0");
    const yyyy = String(y);
    if (Number(mo) > 12) return `${yyyy}-${d}-${mo}`;
    return `${yyyy}-${mo}-${d}`;
  }

  const mdOnly = t.match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (mdOnly && opts?.defaultYear != null) {
    const y = opts.defaultYear;
    const mo = String(Number(mdOnly[1])).padStart(2, "0");
    const d = String(Number(mdOnly[2])).padStart(2, "0");
    if (Number(mo) > 12)
      return `${y}-${d}-${String(Number(mdOnly[1])).padStart(2, "0")}`;
    return `${y}-${mo}-${d}`;
  }

  const dMonY = spaced.match(
    new RegExp(
      `^(\\d{1,2})\\s*[-\\s](${MONTH_WORD})\\s*[-\\s](\\d{2,4})$`,
      "iu"
    )
  );
  if (dMonY) {
    const mi = monthIdxFromWord(dMonY[2]);
    if (!mi) return null;
    let y = Number(dMonY[3]);
    if (y < 100) y += 2000;
    const day = String(Number(dMonY[1])).padStart(2, "0");
    return `${y}-${mi}-${day}`;
  }

  return null;
}

function detectCurrency(amountRaw: string): string {
  if (/€|EUR/i.test(amountRaw)) return "EUR";
  if (/£|GBP/i.test(amountRaw)) return "GBP";
  if (/¥|JPY|JP¥/iu.test(amountRaw)) return "JPY";
  if (/₹|INR/i.test(amountRaw)) return "INR";
  if (/MXN|\$/i.test(amountRaw) && /MXN/i.test(amountRaw)) return "MXN";
  if (/AUD|A\$/i.test(amountRaw)) return "AUD";
  if (/NZD|NZ\$/i.test(amountRaw)) return "NZD";
  if (/CHF/i.test(amountRaw)) return "CHF";
  if (/\$/u.test(amountRaw) || /USD/i.test(amountRaw)) return "USD";
  return "USD";
}

function parseAmountFragment(fragment: string): {
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

/** Date substring patterns — try longer matches before MM/DD-only */
function matchDateSubstring(
  line: string,
  defaultYear: number
): { iso: string; start: number; end: number } | null {
  const candidates: Array<{ iso: string; start: number; end: number }> = [];

  const pushIso = (
    slice: string,
    start: number,
    end: number,
    useCompact = false
  ) => {
    const iso = useCompact
      ? normalizeDate(slice.replace(/\s+/gu, ""), { defaultYear })
      : normalizeDate(slice, { defaultYear });
    if (iso) candidates.push({ iso, start, end });
  };

  let m: RegExpExecArray | null;

  const isoRe = /\d{4}\s*-\s*\d{2}\s*-\s*\d{2}/gu;
  while ((m = isoRe.exec(line))) pushIso(m[0], m.index, m.index + m[0].length);

  const mdyRe =
    /\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}(?=\b|[^\d/.-]|$)/gu;
  while ((m = mdyRe.exec(line)))
    pushIso(m[0], m.index, m.index + m[0].length, true);

  const mdOnlyRe =
    /\b\d{1,2}\s*[/.-]\s*\d{1,2}(?=\s|$|[^\d/.-])(?![/.-]\s*\d)/gu;
  while ((m = mdOnlyRe.exec(line))) {
    pushIso(m[0].replace(/\s+/gu, ""), m.index, m.index + m[0].length, true);
  }

  const monRe =
    /\d{1,2}\s*[-]\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*[-]\s*\d{2,4}/giu;
  while ((m = monRe.exec(line))) pushIso(m[0], m.index, m.index + m[0].length);

  const monFirstRe = new RegExp(
    `\\b${MONTH_WORD}\\s+\\d{1,2}(?:,?\\s*(?:\\d{2,4}))?`,
    "giu"
  );
  while ((m = monFirstRe.exec(line))) pushIso(m[0], m.index, m.index + m[0].length);

  const dMonSpacedRe = new RegExp(
    `\\b\\d{1,2}\\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\s+(?:\\d{4}|\\d{2})(?=\\s|$|\\W)`, // DD Mon YY(YY)
    "giu"
  );
  while ((m = dMonSpacedRe.exec(line))) pushIso(m[0], m.index, m.index + m[0].length);

  if (!candidates.length) return null;
  const minStart = Math.min(...candidates.map((c) => c.start));
  const atStart = candidates.filter((c) => c.start === minStart);
  atStart.sort((a, b) => b.end - a.end);
  return atStart[0];
}

/** BoA-style posting date + transaction date — peel repeated leading dates */
function stripLeadingDateRuns(s: string, defaultYear: number): string {
  let t = s.trim();
  let guard = 0;
  while (guard++ < 8 && t.length > 0) {
    const hit = matchDateSubstring(t, defaultYear);
    if (!hit || hit.start !== 0) break;
    t = t.slice(hit.end).trim();
  }
  return t;
}

function peelTrailingAmounts(
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
    amounts.unshift(mm[2].trim());
    cur = mm[1].trimEnd();
  }

  return { amounts, prefix: cur };
}

function peelTrailingAmountsTight(rest: string): { amounts: string[]; prefix: string } {
  const amounts: string[] = [];
  let cur = rest.trimEnd();
  const peelRe =
    /^([\s\S]+?)(\s*([\u2212+-]?\(?[\p{Sc}]?\s*\d[\d.,]*(?:\.\d{1,2})?\s*\)?(?:\s*(?:USD|EUR|GBP|MXN|CAD|INR|JPY|AUD|NZD|CHF|CR|DR))?))$/iu;

  for (let i = 0; i < 2; i++) {
    const mm = cur.match(peelRe);
    if (!mm) break;
    amounts.unshift(mm[2].trim());
    cur = mm[1].trimEnd();
  }

  return { amounts, prefix: cur };
}

function debitCreditFromDescription(
  description: string,
  amountRaw: string
): { type: "debit" | "credit"; signedValue: number; parsed: ReturnType<typeof parseAmountFragment> } | null {
  const parsed = parseAmountFragment(amountRaw);
  if (!parsed || parsed.value === 0) return null;

  const upper = description.toUpperCase();
  const creditHints =
    /\b(CR|CREDIT|CREDITS|DEPOSIT|PAYMENT RECEIVED|REFUND)\b/u.test(upper) ||
    /\bCR$/u.test(amountRaw.trim());
  const debitHints =
    /\b(DR|DEBIT|DEBITS|PURCHASE|PAYMENT|WITHDRAWAL|CHARGE|ATM)\b/u.test(upper) ||
    /\bDR$/u.test(amountRaw.trim());

  let type: "debit" | "credit";
  if (creditHints && !debitHints) type = "credit";
  else if (debitHints && !creditHints) type = "debit";
  else type = "debit";

  return { type, signedValue: parsed.value, parsed };
}

function tryLeadingDateTailAmount(
  block: string,
  defaultYear: number,
  strategyBase: string
): ParsedRow | null {
  const hit = matchDateSubstring(block.trim(), defaultYear);
  if (!hit) return null;

  let afterDate = (block.slice(0, hit.start) + block.slice(hit.end)).trim();
  afterDate = afterDate.replace(/\s{2,}/gu, " ");
  afterDate = stripLeadingDateRuns(afterDate, defaultYear);
  if (afterDate.length < 2) return null;

  let peeled = peelTrailingAmounts(afterDate, 2);
  if (peeled.amounts.length === 0) peeled = peelTrailingAmountsTight(afterDate);

  if (peeled.amounts.length === 0) return null;

  let primaryRaw = peeled.amounts[peeled.amounts.length - 1];
  let primaryParsed = parseAmountFragment(primaryRaw);
  if (
    (!primaryParsed || primaryParsed.value === 0) &&
    peeled.amounts.length >= 2
  ) {
    primaryRaw = peeled.amounts[peeled.amounts.length - 2];
    primaryParsed = parseAmountFragment(primaryRaw);
  }
  if (!primaryParsed || primaryParsed.value === 0) return null;

  const descCore = peeled.prefix.trim();

  if (NOISE_DESCRIPTION.test(descCore)) return null;

  const dc = debitCreditFromDescription(descCore, primaryRaw);
  if (!dc) return null;

  let strategy = strategyBase;
  if (peeled.amounts.length === 2) strategy = `${strategyBase}+dual-peel`;

  return {
    date: hit.iso,
    description: descCore.replace(/\s{2,}/gu, " "),
    amount: Math.abs(dc.signedValue),
    type: dc.type,
    currency: primaryParsed.currency,
    strategy,
  };
}

function tryDualColumnDebitCredit(
  block: string,
  defaultYear: number
): ParsedRow | null {
  const hit = matchDateSubstring(block.trim(), defaultYear);
  if (!hit) return null;

  let afterDate = (block.slice(0, hit.start) + block.slice(hit.end)).trim();
  afterDate = afterDate.replace(/\s{2,}/gu, " ");
  afterDate = stripLeadingDateRuns(afterDate, defaultYear);
  const peeled = peelTrailingAmounts(afterDate, 2);

  if (peeled.amounts.length < 2) return null;

  const a0 = parseAmountFragment(peeled.amounts[0]);
  const a1 = parseAmountFragment(peeled.amounts[1]);
  if (!a0 || !a1) return null;

  const desc = peeled.prefix.trim();
  if (NOISE_DESCRIPTION.test(desc) || desc.length < 2) return null;

  const z0 = Math.abs(a0.value) < 1e-9;
  const z1 = Math.abs(a1.value) < 1e-9;
  if (z0 && z1) return null;

  const debitUpper = /\b(DEBIT|DR|WITHDRAWAL|CHARGE|PURCHASE|ATM)\b/u.test(
    block.toUpperCase()
  );
  const creditUpper = /\b(CREDIT|CR|DEPOSIT|REFUND)\b/u.test(block.toUpperCase());

  let chosen: typeof a0;
  let type: "debit" | "credit";

  if (!z0 && z1) {
    chosen = a0;
    type = debitUpper && !creditUpper ? "debit" : a0.value < 0 ? "credit" : "debit";
  } else if (z0 && !z1) {
    chosen = a1;
    type = creditUpper && !debitUpper ? "credit" : a1.value < 0 ? "credit" : "debit";
  } else {
    const ad = Math.abs(a0.value);
    const ac = Math.abs(a1.value);
    if (ad >= ac) {
      chosen = a0;
      type = "debit";
    } else {
      chosen = a1;
      type = "credit";
    }
  }

  const signed = chosen.value;
  return {
    date: hit.iso,
    description: desc.replace(/\s{2,}/gu, " "),
    amount: Math.abs(signed),
    type,
    currency: chosen.currency,
    strategy: "dual-column",
  };
}

function tryLabeledAmountColumns(block: string, defaultYear: number): ParsedRow | null {
  const hit = matchDateSubstring(block.trim(), defaultYear);
  if (!hit) return null;

  let mid = (block.slice(0, hit.start) + block.slice(hit.end)).trim();
  mid = stripLeadingDateRuns(mid.replace(/\s{2,}/gu, " "), defaultYear);

  const debitLab = mid.match(
    /\b(?:debit|withdrawals?|payments?)\b\s*([\u2212+-]?\(?[\p{Sc}]?\s*[\d,]+\.?\d*\)?)/iu
  );
  const creditLab = mid.match(
    /\b(?:credit|deposits?)\b\s*([\u2212+-]?\(?[\p{Sc}]?\s*[\d,]+\.?\d*\)?)/iu
  );

  if (!debitLab && !creditLab) return null;

  let amountRaw: string | undefined;
  let type: "debit" | "credit";

  if (debitLab && creditLab) {
    const d = parseAmountFragment(debitLab[1]);
    const c = parseAmountFragment(creditLab[1]);
    if (!d || !c) return null;
    const dz = Math.abs(d.value) < 1e-9;
    const cz = Math.abs(c.value) < 1e-9;
    if (!dz && cz) {
      amountRaw = debitLab[1];
      type = "debit";
    } else if (dz && !cz) {
      amountRaw = creditLab[1];
      type = "credit";
    } else {
      return null;
    }
  } else if (debitLab) {
    amountRaw = debitLab[1];
    type = "debit";
  } else {
    amountRaw = creditLab![1];
    type = "credit";
  }

  const description = mid
    .replace(debitLab?.[0] ?? "", "")
    .replace(creditLab?.[0] ?? "", "")
    .replace(/\s{2,}/gu, " ")
    .trim();

  const dc = debitCreditFromDescription(description, amountRaw!);
  if (!dc || !description || NOISE_DESCRIPTION.test(description)) return null;

  return {
    date: hit.iso,
    description,
    amount: Math.abs(dc.signedValue),
    type,
    currency: dc.parsed!.currency,
    strategy: "labeled-columns",
  };
}

function tryFallbackAmountScan(block: string, defaultYear: number): ParsedRow | null {
  const hit = matchDateSubstring(block.trim(), defaultYear);
  if (!hit) return null;

  let withoutDate = (block.slice(0, hit.start) + block.slice(hit.end)).trim();
  withoutDate = stripLeadingDateRuns(withoutDate, defaultYear);

  AMOUNT_TOKEN.lastIndex = 0;
  const rawMatches = [...withoutDate.matchAll(AMOUNT_TOKEN)].map((x) => x[0].trim());
  const parsedList = rawMatches
    .map((r) => ({ r, p: parseAmountFragment(r) }))
    .filter((x): x is { r: string; p: NonNullable<ReturnType<typeof parseAmountFragment>> } =>
      Boolean(x.p && Math.abs(x.p.value) > 1e-9)
    );

  if (!parsedList.length) return null;

  const last = parsedList[parsedList.length - 1];
  const amountIdx = withoutDate.lastIndexOf(last.r);
  if (amountIdx < 0) return null;

  const description = withoutDate.slice(0, amountIdx).trim().replace(/\s{2,}/gu, " ");
  if (description.length < 2 || NOISE_DESCRIPTION.test(description)) return null;

  const dc = debitCreditFromDescription(description, last.r);
  if (!dc) return null;

  return {
    date: hit.iso,
    description,
    amount: Math.abs(dc.signedValue),
    type: dc.type,
    currency: dc.parsed!.currency,
    strategy: "fallback-amount-scan",
  };
}

function mergeDateOnlyLines(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    const dateOnlyIso = /^\d{4}-\d{2}-\d{2}$/.test(t);
    const dateOnlySlash =
      /^\d{1,2}\s*[/.-]\s*\d{1,2}(?:\s*[/.-]\s*\d{2,4})?$/.test(t) &&
      !/\s{2,}/.test(t) &&
      t.length <= 14;

    const dateOnlyMonth = new RegExp(`^${MONTH_WORD}\\s+\\d{1,2}$`, "iu").test(
      stripLeadingNoise(t)
    );

    if ((dateOnlyIso || dateOnlySlash || dateOnlyMonth) && i + 1 < lines.length) {
      const next = lines[i + 1];
      if (!SKIP_LINE.test(next) && !/^\d{4}-\d{2}-\d{2}\s*$/.test(next)) {
        out.push(`${t} ${next}`);
        i++;
        continue;
      }
    }
    out.push(t);
  }
  return out;
}

/** Multiple signals → robust row boundaries across banks */
function transactionAnchorScore(line: string, defaultYear: number): number {
  const t = stripLeadingNoise(line);
  if (!t || SKIP_LINE.test(t)) return -10;

  let score = 0;
  if (NOISE_DESCRIPTION.test(t)) score -= 3;

  const dateHit = matchDateSubstring(t, defaultYear);
  if (dateHit) {
    if (dateHit.start <= 4) score += 4;
    else if (dateHit.start <= 28) score += 3;
    else score += 2;
  }

  AMOUNT_TOKEN.lastIndex = 0;
  const amountMatches = [...t.matchAll(AMOUNT_TOKEN)];
  const lastAmt = amountMatches.at(-1);
  if (lastAmt?.index !== undefined) {
    const trimmedEnd = t.trimEnd();
    const endIdx = lastAmt.index + lastAmt[0].length;
    const tailGap = trimmedEnd.length - endIdx;
    if (tailGap <= 2) score += 4;
    else score += 2;
    const parsed = parseAmountFragment(lastAmt[0]);
    if (parsed && Math.abs(parsed.value) > 1e-9) score += 2;
  }

  if (t.length >= 12 && t.length <= 220) score += 1;

  return score;
}

function looksLikeTransactionAnchor(line: string, defaultYear: number): boolean {
  const t = stripLeadingNoise(line);
  if (!t || SKIP_LINE.test(t)) return false;

  if (/^\d{4}-\d{2}-\d{2}\b/.test(t)) return true;
  if (/^\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}\b/.test(t)) return true;

  const md = /^\d{1,2}\s*[/.-]\s*\d{1,2}(?:\s|$|[^\d/.-])/.test(t);
  if (md) {
    const iso = normalizeDate(
      t.match(/^\d{1,2}\s*[/.-]\s*\d{1,2}/)![0].replace(/\s+/gu, ""),
      { defaultYear }
    );
    if (iso) return true;
  }

  if (new RegExp(`^${MONTH_WORD}\\s+\\d{1,2}\\b`, "iu").test(t)) return true;

  return transactionAnchorScore(line, defaultYear) >= 7;
}

function groupLinesIntoBlocks(lines: string[], defaultYear: number): string[] {
  const mergedDate = mergeDateOnlyLines(lines);
  const blocks: string[] = [];
  let cur = "";

  for (const line of mergedDate) {
    if (SKIP_LINE.test(line)) continue;
    if (looksLikeTransactionAnchor(line, defaultYear)) {
      if (cur) blocks.push(cur.replace(/\s{2,}/gu, " ").trim());
      cur = line;
    } else if (cur) {
      cur += " " + line;
    }
  }
  if (cur) blocks.push(cur.replace(/\s{2,}/gu, " ").trim());

  return blocks;
}

function parseBlockWithStrategies(
  block: string,
  defaultYear: number
): ParsedRow | null {
  const trimB = block.trim();
  if (trimB.length < 8) return null;

  const strategies: Array<() => ParsedRow | null> = [
    () => tryLeadingDateTailAmount(trimB, defaultYear, "leading-date-tail"),
    () =>
      tryLeadingDateTailAmount(
        stripLeadingNoise(trimB.replace(/^[^\dA-Za-z]{1,12}\s*/u, "")),
        defaultYear,
        "leading-date-skipped-prefix"
      ),
    () => tryLabeledAmountColumns(trimB, defaultYear),
    () => tryFallbackAmountScan(trimB, defaultYear),
    () => tryDualColumnDebitCredit(trimB, defaultYear),
  ];

  for (const run of strategies) {
    const row = run();
    if (row) return row;
  }
  return null;
}

function dedupeNearbyDuplicates(rows: ParsedRow[]): ParsedRow[] {
  const seen = new Set<string>();
  const result: ParsedRow[] = [];
  for (const r of rows) {
    const key = `${r.date}|${r.description}|${r.amount}|${r.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(r);
  }
  return result;
}

function countDatePatternMatches(lines: string[], defaultYear: number): number {
  let n = 0;
  for (const line of lines) {
    if (matchDateSubstring(stripLeadingNoise(line), defaultYear)) n++;
  }
  return n;
}

function countAmountPatternMatches(lines: string[]): number {
  let n = 0;
  for (const line of lines) {
    AMOUNT_TOKEN.lastIndex = 0;
    if (AMOUNT_TOKEN.test(line)) n++;
  }
  return n;
}

function logDiagnostics(args: {
  physicalLineCount: number;
  cleanedLineCount: number;
  linesWithDatePattern: number;
  linesWithAmountPattern: number;
  cleanedLines: string[];
  rows: ParsedRow[];
}): void {
  const {
    physicalLineCount,
    cleanedLineCount,
    linesWithDatePattern,
    linesWithAmountPattern,
    cleanedLines,
    rows,
  } = args;

  const linesPreview = cleanedLines
    .slice(0, 40)
    .map((l, i) => `${String(i + 1).padStart(2, "0")}| ${l}`)
    .join("\n");

  const strategyCounts: Record<string, number> = {};
  for (const r of rows) {
    strategyCounts[r.strategy] = (strategyCounts[r.strategy] ?? 0) + 1;
  }

  const firstTen = rows.slice(0, 10).map((r) => ({
    date: r.date,
    description: r.description.slice(0, 80) + (r.description.length > 80 ? "…" : ""),
    amount: r.amount,
    type: r.type,
    currency: r.currency,
    strategy: r.strategy,
  }));

  console.log(`${LOG_PREFIX} Total physical lines (PDF text): ${physicalLineCount}`);
  console.log(`${LOG_PREFIX} Cleaned lines (after noise filter): ${cleanedLineCount}`);
  console.log(`${LOG_PREFIX} Lines matching date pattern: ${linesWithDatePattern}`);
  console.log(`${LOG_PREFIX} Lines matching amount pattern: ${linesWithAmountPattern}`);
  console.log(`${LOG_PREFIX} Parsed transactions: ${rows.length}`);
  console.log(`${LOG_PREFIX} First 10 detected transactions: ${JSON.stringify(firstTen, null, 2)}`);
  console.log(`${LOG_PREFIX} First 40 cleaned lines:\n${linesPreview}`);
  console.log(`${LOG_PREFIX} Strategy counts: ${JSON.stringify(strategyCounts)}`);
}

export function parseTransactionsFromText(text: string): Transaction[] {
  const normalized = normalizeRawText(text);
  const physical = splitPhysicalLines(normalized);
  const defaultYear = inferStatementYear(physical);

  const cleanedLines = physical.filter((l) => !SKIP_LINE.test(l));
  const blocks = groupLinesIntoBlocks(cleanedLines, defaultYear);

  const parsed: ParsedRow[] = [];
  for (const block of blocks) {
    const row = parseBlockWithStrategies(block, defaultYear);
    if (row) parsed.push(row);
  }

  parsed.sort((a, b) => a.date.localeCompare(b.date));
  const deduped = dedupeNearbyDuplicates(parsed);

  logDiagnostics({
    physicalLineCount: physical.length,
    cleanedLineCount: cleanedLines.length,
    linesWithDatePattern: countDatePatternMatches(cleanedLines, defaultYear),
    linesWithAmountPattern: countAmountPatternMatches(cleanedLines),
    cleanedLines,
    rows: deduped,
  });

  return deduped.map((row) => {
    const { strategy, ...tx } = row;
    void strategy;
    return tx;
  });
}

export function deriveStatementPeriod(
  transactions: Transaction[]
): { start: string; end: string } | null {
  if (!transactions.length) return null;
  let start = transactions[0].date;
  let end = transactions[0].date;
  for (const t of transactions) {
    if (t.date < start) start = t.date;
    if (t.date > end) end = t.date;
  }
  return { start, end };
}

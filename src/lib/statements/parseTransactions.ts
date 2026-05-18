import type { Transaction } from "./types";

const LOG_PREFIX = "[statement-parser]";

/** Loose amount token: currency symbols, commas, decimals, negatives, parentheses, trailing CR/DR */
const AMOUNT_TOKEN =
  /[-+]?\(?[\p{Sc}]?\s*\d[\d.,]*(?:\.\d{2})?\s*\)?(?:\s*(?:USD|EUR|GBP|MXN|CAD|CR|DR))?/giu;

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

function normalizeDate(
  raw: string,
  opts?: { defaultYear?: number }
): string | null {
  const t = raw.replace(/\s+/gu, "").trim();
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

  const dMonY = raw
    .trim()
    .match(
      /^(\d{1,2})[-\s](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-\s](\d{2,4})$/i
    );
  if (dMonY) {
    const months: Record<string, string> = {
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
    const mo =
      months[dMonY[2].slice(0, 3).toLowerCase() as keyof typeof months];
    let y = Number(dMonY[3]);
    if (y < 100) y += 2000;
    const day = String(Number(dMonY[1])).padStart(2, "0");
    return `${y}-${mo}-${day}`;
  }

  return null;
}

function detectCurrency(amountRaw: string): string {
  if (/€|EUR/i.test(amountRaw)) return "EUR";
  if (/£|GBP/i.test(amountRaw)) return "GBP";
  if (/MXN|\$/i.test(amountRaw) && /MXN/i.test(amountRaw)) return "MXN";
  if (/\$/u.test(amountRaw) || /USD/i.test(amountRaw)) return "USD";
  return "USD";
}

function parseAmountFragment(fragment: string): {
  value: number;
  currency: string;
} | null {
  const trimmed = fragment.trim();
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
    if (parts.length === 2 && parts[1].length === 2) {
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

  const pushIso = (slice: string, start: number, end: number) => {
    const compact = slice.replace(/\s+/gu, "");
    const iso = normalizeDate(compact, { defaultYear });
    if (iso) candidates.push({ iso, start, end });
  };

  const isoRe = /\d{4}\s*-\s*\d{2}\s*-\s*\d{2}/gu;
  let m: RegExpExecArray | null;
  while ((m = isoRe.exec(line))) pushIso(m[0], m.index, m.index + m[0].length);

  const mdyRe =
    /\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}(?=\b|[^\d/.-]|$)/gu;
  while ((m = mdyRe.exec(line))) pushIso(m[0], m.index, m.index + m[0].length);

  const mdOnlyRe =
    /\b\d{1,2}\s*[/.-]\s*\d{1,2}(?=\s|$|[^\d/.-])(?![/.-]\s*\d)/gu;
  while ((m = mdOnlyRe.exec(line))) {
    const iso = normalizeDate(m[0].replace(/\s+/gu, ""), { defaultYear });
    if (iso) candidates.push({ iso, start: m.index, end: m.index + m[0].length });
  }

  const monRe =
    /\d{1,2}\s*[-]\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*[-]\s*\d{2,4}/giu;
  while ((m = monRe.exec(line))) pushIso(m[0], m.index, m.index + m[0].length);

  if (!candidates.length) return null;
  const minStart = Math.min(...candidates.map((c) => c.start));
  const atStart = candidates.filter((c) => c.start === minStart);
  atStart.sort((a, b) => b.end - a.end);
  return atStart[0];
}

function peelTrailingAmounts(
  rest: string,
  max = 2
): { amounts: string[]; prefix: string } {
  const amounts: string[] = [];
  let cur = rest.trimEnd();
  const peelRe =
    /^([\s\S]+?)(\s+([-+]?\(?[\p{Sc}]?\s*\d[\d.,]*(?:\.\d{2})?\s*\)?(?:\s*(?:USD|EUR|GBP|MXN|CAD|CR|DR))?))$/iu;

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
    /^([\s\S]+?)(\s*([-+]?\(?[\p{Sc}]?\s*\d[\d.,]*(?:\.\d{2})?\s*\)?(?:\s*(?:USD|EUR|GBP|MXN|CAD|CR|DR))?))$/iu;

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
  else type = parsed.value < 0 ? "credit" : "debit";

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

  const mid = (block.slice(0, hit.start) + block.slice(hit.end)).trim();
  const debitLab = mid.match(
    /\b(?:debit|withdrawals?|payments?)\b\s*([-+]?\(?[\p{Sc}]?\s*[\d,]+\.?\d*\)?)/iu
  );
  const creditLab = mid.match(
    /\b(?:credit|deposits?)\b\s*([-+]?\(?[\p{Sc}]?\s*[\d,]+\.?\d*\)?)/iu
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

  const withoutDate = (block.slice(0, hit.start) + block.slice(hit.end)).trim();
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

    if ((dateOnlyIso || dateOnlySlash) && i + 1 < lines.length) {
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

function startsNewTransactionRow(line: string, defaultYear: number): boolean {
  const t = line.trim();
  if (/^\d{4}-\d{2}-\d{2}\b/.test(t)) return true;
  if (
    /^\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}\b/.test(t)
  )
    return true;
  const md = /^\d{1,2}\s*[/.-]\s*\d{1,2}(?:\s|$|[^\d/.-])/.test(t);
  if (md) {
    const iso = normalizeDate(
      t.match(/^\d{1,2}\s*[/.-]\s*\d{1,2}/)![0].replace(/\s+/gu, ""),
      { defaultYear }
    );
    return Boolean(iso);
  }
  return false;
}

function groupLinesIntoBlocks(lines: string[], defaultYear: number): string[] {
  const mergedDate = mergeDateOnlyLines(lines);
  const blocks: string[] = [];
  let cur = "";

  for (const line of mergedDate) {
    if (SKIP_LINE.test(line)) continue;
    if (startsNewTransactionRow(line, defaultYear)) {
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
        trimB.replace(/^[^\d]{1,5}\s*/u, ""),
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

function logDiagnostics(args: {
  cleanedLines: string[];
  rows: ParsedRow[];
}): void {
  const { cleanedLines, rows } = args;
  const linesPreview = cleanedLines
    .slice(0, 40)
    .map((l, i) => `${String(i + 1).padStart(2, "0")}| ${l}`)
    .join("\n");

  const strategyCounts: Record<string, number> = {};
  for (const r of rows) {
    strategyCounts[r.strategy] = (strategyCounts[r.strategy] ?? 0) + 1;
  }

  const samples = rows.slice(0, 5).map((r) => ({
    date: r.date,
    description: r.description.slice(0, 80) + (r.description.length > 80 ? "…" : ""),
    amount: r.amount,
    type: r.type,
    currency: r.currency,
    strategy: r.strategy,
  }));

  console.log(`${LOG_PREFIX} First 40 cleaned lines:\n${linesPreview}`);
  console.log(`${LOG_PREFIX} Strategy counts: ${JSON.stringify(strategyCounts)}`);
  console.log(`${LOG_PREFIX} Parsed transactions: ${rows.length}`);
  console.log(`${LOG_PREFIX} Sample parsed: ${JSON.stringify(samples, null, 2)}`);
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

  logDiagnostics({ cleanedLines, rows: deduped });

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

import type { Transaction } from "./types";

const DATE_PATTERNS: Array<{ regex: RegExp; group: number }> = [
  { regex: /\b(\d{4}-\d{2}-\d{2})\b/, group: 1 },
  { regex: /\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\b/, group: 1 },
  {
    regex: /\b(\d{1,2}[-\s](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-\s]\d{2,4})\b/i,
    group: 1,
  },
];

const AMOUNT_TAIL =
  /([-+]?\(?[\p{Sc}]?\s*\d[\d.,]*\s*\)?(?:\s*(?:USD|EUR|GBP|MXN|CAD|CR|DR))?)$/iu;

function normalizeDate(raw: string): string | null {
  const t = raw.trim();
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

  const dMonY = t.match(
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

function extractLeadingDate(line: string): {
  isoDate: string;
  rest: string;
} | null {
  for (const { regex, group } of DATE_PATTERNS) {
    const m = line.match(regex);
    if (!m) continue;
    const iso = normalizeDate(m[group]);
    if (!iso) continue;
    const idx = m.index ?? 0;
    const rest = (line.slice(0, idx) + line.slice(idx + m[0].length)).trim();
    return { isoDate: iso, rest };
  }
  return null;
}

export function parseTransactionsFromText(text: string): Transaction[] {
  const lines = text
    .split(/\r?\n/u)
    .map((l) => l.replace(/\t+/gu, " ").trim())
    .filter(Boolean);

  const out: Transaction[] = [];

  for (const line of lines) {
    if (line.length < 6) continue;

    const dateHit = extractLeadingDate(line);
    if (!dateHit) continue;

    const amountMatch = dateHit.rest.match(AMOUNT_TAIL);
    if (!amountMatch) continue;

    const amountRaw = amountMatch[1];
    const parsed = parseAmountFragment(amountRaw);
    if (!parsed || parsed.value === 0) continue;

    let description = dateHit.rest.slice(0, amountMatch.index).trim();
    description = description.replace(/\s{2,}/gu, " ");
    if (description.length < 2) continue;

    const upper = description.toUpperCase();
    const creditHints =
      /\b(CR|CREDIT|DEPOSIT|PAYMENT RECEIVED|REFUND)\b/u.test(upper) ||
      /\bCR$/u.test(amountRaw.trim());
    const debitHints =
      /\b(DR|DEBIT|PURCHASE|PAYMENT|WITHDRAWAL|CHARGE)\b/u.test(upper) ||
      /\bDR$/u.test(amountRaw.trim());

    let type: "debit" | "credit";
    if (creditHints && !debitHints) type = "credit";
    else if (debitHints && !creditHints) type = "debit";
    else type = parsed.value < 0 ? "credit" : "debit";

    const amountAbs = Math.abs(parsed.value);

    out.push({
      date: dateHit.isoDate,
      description,
      amount: amountAbs,
      type,
      currency: parsed.currency,
    });
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return dedupeNearbyDuplicates(out);
}

function dedupeNearbyDuplicates(rows: Transaction[]): Transaction[] {
  const seen = new Set<string>();
  const result: Transaction[] = [];
  for (const r of rows) {
    const key = `${r.date}|${r.description}|${r.amount}|${r.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(r);
  }
  return result;
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

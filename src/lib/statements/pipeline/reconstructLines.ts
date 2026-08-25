import { AMOUNT_TOKEN, MONTH_WORD } from "./constants";
import { matchDateSubstring, stripLeadingNoise } from "./dates";
import {
  countParsableMoneyTokens,
  isPlausibleMoneyToken,
} from "./amounts";
import { PAGE_HEADER_SIMPLE, SKIP_LINE, STATEMENT_PAGE_HEADER } from "./noise";

/**
 * BoA ACH continuation fragments that must attach to a dated DES:/INDN: parent.
 * Includes "ID:… WEB", "ID:…", and "ID:… <amount>" — never start a new txn alone.
 */
function isBoaAchContinuation(line: string): boolean {
  const t = stripLeadingNoise(line).trim();
  if (!t || /^\d{1,2}\/\d{1,2}/.test(t) || /^\d{4}-\d{2}-\d{2}/.test(t)) {
    return false;
  }
  if (/^(?:CO\s+)?ID:\s*\d{4,}\s+WEB\b/iu.test(t)) return true;
  if (
    /^(?:CO\s+)?ID:\s*\d{4,}(?:\s+[\u2212+-]?\(?[\p{Sc}]?\s*\d[\d.,]*(?:\.\d{1,2})?\)?)?\s*$/iu.test(
      t
    )
  ) {
    return true;
  }
  // Short "ID:xxxx TOKEN" tails without a posting date.
  if (
    /^(?:CO\s+)?ID:\s*\d{4,}\b/iu.test(t) &&
    t.length <= 96 &&
    !/\bDES:/iu.test(t)
  ) {
    return true;
  }
  // Masked CO ID / CCD tails (BoA redacts digits as XXXXXXXXX CCD).
  if (
    /^(?:CO\s+)?ID:\s*[X*]{4,}\b/iu.test(t) ||
    /^[X*]{5,}\s*CCD\b/iu.test(t) ||
    /^[X*]{5,}(?:\s+CCD)?(?:\s+[\u2212+-]?\(?[\p{Sc}]?\s*\d[\d.,]*(?:\.\d{1,2})?\)?)?\s*$/iu.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

function parentLooksLikeDatedTxnStructure(
  block: string,
  defaultYear: number
): boolean {
  const t = stripLeadingNoise(block).trim();
  if (!t) return false;
  // Prefer an explicit posting date near the start.
  if (/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(t)) return true;
  if (/^\d{4}-\d{2}-\d{2}\b/.test(t)) return true;
  // ACH-style parent body without requiring amount yet.
  if (/\b(?:DES:|INDN:|CO\s+ID:)/iu.test(t) && matchDateSubstring(t, defaultYear)) {
    return true;
  }
  return false;
}

function mergeDateOnlyLines(lines: string[]): string[] {
  const out: string[] = [];
  const dateOnlyMonth = new RegExp(`^${MONTH_WORD}\\s+\\d{1,2}$`, "iu");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    const dateOnlyIso = /^\d{4}-\d{2}-\d{2}$/.test(t);
    const dateOnlySlash =
      /^\d{1,2}\s*[/.-]\s*\d{1,2}(?:\s*[/.-]\s*\d{2,4})?$/.test(t) &&
      !/\s{2,}/.test(t) &&
      t.length <= 18;
    const dateOnlyMonthOk = dateOnlyMonth.test(stripLeadingNoise(t));

    if (
      (dateOnlyIso || dateOnlySlash || dateOnlyMonthOk) &&
      i + 1 < lines.length
    ) {
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

/** Line is only a monetary amount (wrapped to its own line in PDF text) */
function isAmountOnlyLine(line: string): boolean {
  const t = stripLeadingNoise(line).trim();
  if (!t || t.length > 44) return false;
  return (
    /^[\u2212+-]?\(?[\p{Sc}]?\s*\d[\d.,]*(?:\.\d{1,2})?\s*\)?(?:\s*(?:USD|EUR|GBP|MXN|CAD|INR|JPY|AUD|NZD|CHF|CR|DR))?$/iu.test(
      t
    ) && isPlausibleMoneyToken(t)
  );
}

function mergeAmountOnlyLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (isAmountOnlyLine(line) && out.length > 0) {
      out[out.length - 1] = `${out[out.length - 1]} ${line.trim()}`;
    } else {
      out.push(line);
    }
  }
  return out;
}

function transactionAnchorScore(line: string, defaultYear: number): number {
  const t = stripLeadingNoise(line);
  if (!t || SKIP_LINE.test(t)) return -10;

  let score = 0;
  const dateHit = matchDateSubstring(t, defaultYear);
  if (dateHit) {
    if (dateHit.start <= 4) score += 4;
    else if (dateHit.start <= 28) score += 3;
    else score += 2;
  }

  AMOUNT_TOKEN.lastIndex = 0;
  const amountMatches = [...t.matchAll(AMOUNT_TOKEN)].filter((m) =>
    isPlausibleMoneyToken(m[0])
  );
  const lastAmt = amountMatches.at(-1);
  if (lastAmt?.index !== undefined) {
    const trimmedEnd = t.trimEnd();
    const endIdx = lastAmt.index + lastAmt[0].length;
    const tailGap = trimmedEnd.length - endIdx;
    if (tailGap <= 2) score += 4;
    else score += 2;
    score += 2;
  }

  if (t.length >= 12 && t.length <= 220) score += 1;

  return score;
}

function lineHasStructuredTransactionSignals(
  line: string,
  defaultYear: number
): boolean {
  const t = stripLeadingNoise(line.trim());
  if (!t.length) return false;
  const monies = countParsableMoneyTokens(t);
  if (monies === 0 || monies > 2) return false;
  const dh = matchDateSubstring(t, defaultYear);
  if (!dh || dh.start > 52) return false;
  const rx = new RegExp(AMOUNT_TOKEN.source, AMOUNT_TOKEN.flags);
  const parts = [...t.matchAll(rx)].filter((m) => isPlausibleMoneyToken(m[0]));
  if (!parts.length) return false;
  const last = parts[parts.length - 1];
  if (typeof last.index !== "number") return false;
  const end = last.index + last[0].length;
  return t.trimEnd().length - end <= 8;
}

export function looksLikeTransactionAnchor(
  line: string,
  defaultYear: number
): boolean {
  const t = stripLeadingNoise(line);
  if (!t || SKIP_LINE.test(t)) return false;
  if (PAGE_HEADER_SIMPLE.test(t)) return false;
  // Continuations attach to a parent; never start a new block from ID/WEB alone.
  if (isBoaAchContinuation(t)) return false;

  if (/^\d{4}-\d{2}-\d{2}\b/.test(t)) return true;
  if (/^\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}\b/.test(t)) return true;
  if (/^\d{1,2}\/\d{1,2}\/\d{2}\b/i.test(t)) return true;
  if (/^\d{1,2}\/\d{1,2}\/\d{2}(?:CHECKCARD|DEBIT|POS|PURCHASE|DES:|WEB\b)/iu.test(t)) {
    return true;
  }

  const md = /^\d{1,2}\s*[/.-]\s*\d{1,2}(?:\s|$|[^\d/.-])/.test(t);
  if (md) {
    const iso = matchDateSubstring(t.slice(0, 14), defaultYear);
    if (iso) return true;
  }

  if (new RegExp(`^${MONTH_WORD}\\s+\\d{1,2}\\b`, "iu").test(t)) return true;

  if (lineHasStructuredTransactionSignals(line, defaultYear)) return true;

  return transactionAnchorScore(line, defaultYear) >= 7;
}

export type StatementSectionHint = "deposits" | "withdrawals" | null;

export type ReconstructedStatementLine = {
  text: string;
  section: StatementSectionHint;
};

function updateSectionFromHeading(
  line: string,
  current: StatementSectionHint
): StatementSectionHint {
  const t = line.trim();
  const u = t.toUpperCase();
  if (
    /^DEPOSITS AND OTHER ADDITIONS\s*$/i.test(t) ||
    /^DEPOSITS AND OTHER ADDITIONS\s*-?\s*CONTINUED\b/i.test(t)
  ) {
    return "deposits";
  }
  if (/TOTAL DEPOSITS AND OTHER ADDITIONS/i.test(u)) {
    return null;
  }
  if (
    /^WITHDRAWALS AND OTHER SUBTRACTIONS\s*$/i.test(t) ||
    /^WITHDRAWALS AND OTHER SUBTRACTIONS\s*-?\s*CONTINUED\b/i.test(t)
  ) {
    return "withdrawals";
  }
  if (/TOTAL WITHDRAWALS AND OTHER SUBTRACTIONS/i.test(u)) {
    return null;
  }
  // Account-summary totals (same phrases + amounts) must not set section.
  if (
    /^DEPOSITS AND OTHER ADDITIONS/i.test(t) &&
    /\d/.test(t) &&
    t.length < 64
  ) {
    return current;
  }
  if (
    /^WITHDRAWALS AND OTHER SUBTRACTIONS/i.test(t) &&
    /\d/.test(t) &&
    t.length < 64
  ) {
    return current;
  }
  return current;
}

function groupLinesIntoBlocks(
  lines: string[],
  defaultYear: number
): ReconstructedStatementLine[] {
  const mergedDate = mergeDateOnlyLines(mergeAmountOnlyLines(lines));
  const blocks: ReconstructedStatementLine[] = [];
  let cur = "";
  let curSection: StatementSectionHint = null;
  let section: StatementSectionHint = null;

  const flush = () => {
    if (!cur) return;
    blocks.push({
      text: cur.replace(/\s{2,}/gu, " ").trim(),
      section: curSection,
    });
    cur = "";
  };

  for (const line of mergedDate) {
    const nextSection = updateSectionFromHeading(line, section);
    if (nextSection !== section) {
      flush();
      section = nextSection;
    }

    if (
      SKIP_LINE.test(line) ||
      PAGE_HEADER_SIMPLE.test(line) ||
      STATEMENT_PAGE_HEADER.test(line) ||
      /^DEPOSITS AND OTHER ADDITIONS/i.test(line.trim()) ||
      /^WITHDRAWALS AND OTHER SUBTRACTIONS/i.test(line.trim()) ||
      /TOTAL DEPOSITS AND OTHER ADDITIONS/i.test(line) ||
      /TOTAL WITHDRAWALS AND OTHER SUBTRACTIONS/i.test(line)
    ) {
      flush();
      continue;
    }

    if (isBoaAchContinuation(line)) {
      if (cur && parentLooksLikeDatedTxnStructure(cur, defaultYear)) {
        cur += " " + line;
      }
      continue;
    }

    if (looksLikeTransactionAnchor(line, defaultYear)) {
      flush();
      cur = line;
      curSection = section;
    } else if (cur) {
      cur += " " + line;
    }
  }
  flush();

  return blocks;
}

/**
 * Merge wrapped PDF rows into single logical lines (preserving order).
 */
export function reconstructStatementLines(
  physicalLines: string[],
  defaultYear: number
): string[] {
  return reconstructStatementLinesWithSections(physicalLines, defaultYear).map(
    (b) => b.text
  );
}

export function reconstructStatementLinesWithSections(
  physicalLines: string[],
  defaultYear: number
): ReconstructedStatementLine[] {
  const afterAmountMerge = mergeAmountOnlyLines(physicalLines);
  return groupLinesIntoBlocks(afterAmountMerge, defaultYear);
}

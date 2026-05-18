import { AMOUNT_TOKEN, MONTH_WORD } from "./constants";
import { matchDateSubstring, stripLeadingNoise } from "./dates";
import {
  countParsableMoneyTokens,
  parseAmountFragment,
} from "./amounts";
import { PAGE_HEADER_SIMPLE, SKIP_LINE } from "./noise";

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
    ) && parseAmountFragment(t) != null
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
  const parts = [...t.matchAll(rx)].filter((m) => {
    const q = parseAmountFragment(m[0]);
    return q && Math.abs(q.value) > 1e-9;
  });
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

  if (/^\d{4}-\d{2}-\d{2}\b/.test(t)) return true;
  if (/^\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}\b/.test(t)) return true;

  const md = /^\d{1,2}\s*[/.-]\s*\d{1,2}(?:\s|$|[^\d/.-])/.test(t);
  if (md) {
    const iso = matchDateSubstring(t.slice(0, 14), defaultYear);
    if (iso) return true;
  }

  if (new RegExp(`^${MONTH_WORD}\\s+\\d{1,2}\\b`, "iu").test(t)) return true;

  if (lineHasStructuredTransactionSignals(line, defaultYear)) return true;

  return transactionAnchorScore(line, defaultYear) >= 7;
}

function groupLinesIntoBlocks(lines: string[], defaultYear: number): string[] {
  const mergedDate = mergeDateOnlyLines(mergeAmountOnlyLines(lines));
  const blocks: string[] = [];
  let cur = "";

  for (const line of mergedDate) {
    if (SKIP_LINE.test(line) || PAGE_HEADER_SIMPLE.test(line)) {
      if (cur) {
        blocks.push(cur.replace(/\s{2,}/gu, " ").trim());
        cur = "";
      }
      continue;
    }
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

/**
 * Merge wrapped PDF rows into single logical lines (preserving order).
 */
export function reconstructStatementLines(
  physicalLines: string[],
  defaultYear: number
): string[] {
  const afterAmountMerge = mergeAmountOnlyLines(physicalLines);
  return groupLinesIntoBlocks(afterAmountMerge, defaultYear);
}

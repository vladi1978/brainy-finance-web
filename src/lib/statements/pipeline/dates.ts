import { MONTH_WORD } from "./constants";

export function stripLeadingNoise(line: string): string {
  return line.replace(/^[\s*•●○◦\-–—#|]+\s*/u, "").trimStart();
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

export function normalizeDate(
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
    if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) {
      return null;
    }
    const yyyy = String(y);
    if (Number(mo) > 12) return `${yyyy}-${d}-${mo}`;
    return `${yyyy}-${mo}-${d}`;
  }

  const mdyyCompact = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/);
  if (mdyyCompact) {
    const mo = String(Number(mdyyCompact[1])).padStart(2, "0");
    const d = String(Number(mdyyCompact[2])).padStart(2, "0");
    let y = Number(mdyyCompact[3]);
    if (y < 100) y += 2000;
    if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) {
      return null;
    }
    return `${y}-${mo}-${d}`;
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

/** Prefer longer / leftmost date match for a line */
export function matchDateSubstring(
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
    `\\b\\d{1,2}\\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\s+(?:\\d{4}|\\d{2})(?=\\s|$|\\W)`,
    "giu"
  );
  while ((m = dMonSpacedRe.exec(line))) pushIso(m[0], m.index, m.index + m[0].length);

  if (!candidates.length) return null;
  const minStart = Math.min(...candidates.map((c) => c.start));
  const atStart = candidates.filter((c) => c.start === minStart);
  atStart.sort((a, b) => b.end - a.end);
  return atStart[0];
}

/** Strip repeated leading posting dates (multiple date columns) */
export function stripLeadingDateRuns(s: string, defaultYear: number): string {
  let t = s.trim();
  let guard = 0;
  while (guard++ < 8 && t.length > 0) {
    const hit = matchDateSubstring(t, defaultYear);
    if (!hit || hit.start !== 0) break;
    t = t.slice(hit.end).trim();
  }
  return t;
}

export function inferStatementYear(lines: string[]): number {
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

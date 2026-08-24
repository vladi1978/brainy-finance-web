/**
 * Conservative normalization: whitespace and line breaks only.
 * Does not drop or rewrite content that could be part of a transaction.
 */
export function normalizePdfText(text: string): string {
  return text
    .replace(/\u00a0/gu, " ")
    .replace(/[\u2000-\u200b\u202f\u205f\u3000]/gu, " ")
    .replace(/\r\n?/gu, "\n")
    .replace(/\u00ad/gu, ""); // soft hyphen
}

/**
 * Repair common Bank-of-America-style PDF extraction glitches without dropping content.
 */
export function repairStatementLine(line: string): string {
  let t = line.replace(/\bcontinued on the next page\b/giu, " ").trim();
  // Joined posting date + descriptor: 06/22/26CHECKCARD → 06/22/26 CHECKCARD
  t = t.replace(
    /(\d{1,2}\/\d{1,2}\/\d{2,4})(?=[A-Za-z])/gu,
    "$1 "
  );
  // Card auth reference glued to trailing minus amount: …49218076-1.00
  t = t.replace(/\d{12,}(-\d+\.\d{2})\s*$/u, " $1");
  // Descriptor letter glued to minus amount: WEB-126.24
  t = t.replace(/([A-Za-z])(-\d+\.\d{2})\s*$/u, "$1 $2");
  return t.replace(/[ \u00a0]{2,}/gu, " ").trim();
}

export function splitPhysicalLines(text: string): string[] {
  return text
    .split(/\n/u)
    .map((l) =>
      repairStatementLine(
        l
          .replace(/\t+/gu, " ")
          .replace(/[ \u00a0]{2,}/gu, " ")
          .trim()
      )
    )
    .filter(Boolean);
}

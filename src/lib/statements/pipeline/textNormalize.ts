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

export function splitPhysicalLines(text: string): string[] {
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

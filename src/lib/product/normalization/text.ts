import { STOPWORDS } from "./constants";

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeSignificant(text: string): string[] {
  const n = normalizeText(text);
  return n
    .split(/\s+/)
    .map((w) => w.replace(/-/g, ""))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

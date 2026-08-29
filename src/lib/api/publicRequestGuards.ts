/**
 * Minimal request guards for public Brainy APIs.
 * Not a distributed rate limiter — that requires edge/WAF infrastructure.
 */

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/** True when Content-Length is present and exceeds maxBytes. Missing header → false. */
export function contentLengthExceeds(
  req: Request,
  maxBytes: number
): boolean {
  const raw = req.headers.get("content-length");
  if (raw == null || raw.trim() === "") return false;
  const n = Number(raw);
  return Number.isFinite(n) && n > maxBytes;
}

export function truncateForLog(value: string, maxChars: number): string {
  const t = value.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}…`;
}

export const MAX_STATEMENT_UPLOAD_BYTES = 12 * 1024 * 1024;
export const MAX_COMPARE_BODY_BYTES = 64 * 1024;
export const MAX_SHOPPING_BODY_BYTES = 8 * 1024;
/** Sanitized explanation fact contract only — never PDFs or full activity trees. */
export const MAX_STATEMENT_EXPLAIN_BODY_BYTES = 16 * 1024;
export const MAX_COMPARE_INPUT_CHARS = 2_000;
export const MAX_SHOPPING_REQUEST_CHARS = 500;
export const MAX_MANUAL_FIELD_CHARS = 500;

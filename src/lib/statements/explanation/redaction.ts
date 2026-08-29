/**
 * Hard server-side redaction before any OpenAI explanation call.
 * Presentation-only string scrubbing — never invents financial facts.
 */

const EMAIL_RE =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const PHONE_RE =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/gu;
/** Long digit runs (accounts, auth, reference, card-like). */
const LONG_DIGITS_RE = /\b\d{6,}\b/gu;
const ROUTING_ACCOUNT_RE =
  /\b(?:routing|account|acct|ref(?:erence)?|auth(?:orization)?|trace)\s*[#:.-]?\s*\d{4,}\b/giu;
const BANK_TOKEN_RE =
  /\b(?:ID|INDN|DES|CO\s*ID|TRACE|REF|AUTH)\s*[:#.-]\s*[A-Z0-9*]{3,}\b/giu;
const CONTROL_INJECTION_RE =
  /\b(?:ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?|system\s*prompt|developer\s*message|jailbreak|exfiltrat(?:e|ion)|reveal\s+(?:the\s+)?(?:api|secret|key))\b/giu;
const HTML_TAG_RE = /<\/?[a-z][^>]*>/giu;

export type RedactionResult = {
  text: string;
  changed: boolean;
  rejected: boolean;
  reason: string | null;
};

function collapseWs(s: string): string {
  return s.replace(/\s+/gu, " ").trim();
}

/**
 * Redact sensitive tokens from a display string.
 * Rejects strings that still look like instruction injection after scrubbing.
 */
export function redactExplanationText(
  input: string,
  maxChars: number
): RedactionResult {
  if (typeof input !== "string") {
    return { text: "", changed: true, rejected: true, reason: "non_string" };
  }

  let text = input;
  const original = text;

  if (CONTROL_INJECTION_RE.test(original)) {
    CONTROL_INJECTION_RE.lastIndex = 0;
    return {
      text: "",
      changed: true,
      rejected: true,
      reason: "injection",
    };
  }
  CONTROL_INJECTION_RE.lastIndex = 0;

  text = text.replace(HTML_TAG_RE, " ");
  text = text.replace(EMAIL_RE, "[redacted-email]");
  text = text.replace(PHONE_RE, "[redacted-phone]");
  text = text.replace(ROUTING_ACCOUNT_RE, "[redacted-ref]");
  text = text.replace(BANK_TOKEN_RE, "[redacted-token]");
  text = text.replace(LONG_DIGITS_RE, "[redacted-id]");
  text = collapseWs(text);

  // Residual long alnum tokens that look like auth/account blobs
  if (/\b[A-Z0-9*]{18,}\b/u.test(text)) {
    text = text.replace(/\b[A-Z0-9*]{18,}\b/gu, "[redacted-token]");
    text = collapseWs(text);
  }

  if (text.length > maxChars) {
    text = collapseWs(text.slice(0, maxChars));
  }

  const changed = text !== collapseWs(original);
  if (!text) {
    return {
      text: "",
      changed: true,
      rejected: true,
      reason: "empty_after_redaction",
    };
  }

  return { text, changed, rejected: false, reason: null };
}

/** True when a string still contains patterns that must never reach OpenAI. */
export function containsProhibitedSensitiveResidue(text: string): boolean {
  if (!text) return false;
  if (EMAIL_RE.test(text)) return true;
  EMAIL_RE.lastIndex = 0;
  if (PHONE_RE.test(text)) return true;
  PHONE_RE.lastIndex = 0;
  if (LONG_DIGITS_RE.test(text)) return true;
  LONG_DIGITS_RE.lastIndex = 0;
  if (BANK_TOKEN_RE.test(text)) return true;
  BANK_TOKEN_RE.lastIndex = 0;
  if (CONTROL_INJECTION_RE.test(text)) return true;
  CONTROL_INJECTION_RE.lastIndex = 0;
  return false;
}

/** Keys that must never appear on an explanation request body. */
export const PROHIBITED_REQUEST_KEYS = [
  "pdf",
  "file",
  "buffer",
  "bytes",
  "rawText",
  "extractedText",
  "text",
  "transactions",
  "lines",
  "descriptors",
  "prompt",
  "userPrompt",
  "messages",
  "apiKey",
  "OPENAI_API_KEY",
] as const;

export function bodyHasProhibitedKeys(value: unknown, depth = 0): string | null {
  if (depth > 6 || value == null) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = bodyHasProhibitedKeys(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const key of Object.keys(value as object)) {
    const lower = key.toLowerCase();
    for (const banned of PROHIBITED_REQUEST_KEYS) {
      if (lower === banned.toLowerCase()) return key;
    }
    if (
      lower.includes("transaction") ||
      lower === "pdfbytes" ||
      lower === "statementtext" ||
      lower === "rawpdf"
    ) {
      return key;
    }
    const hit = bodyHasProhibitedKeys(
      (value as Record<string, unknown>)[key],
      depth + 1
    );
    if (hit) return hit;
  }
  return null;
}

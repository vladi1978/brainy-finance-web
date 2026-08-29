/**
 * Hard server-side redaction before any OpenAI explanation call.
 * Presentation-only string scrubbing — never invents financial facts.
 */

const EMAIL_RE =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const PHONE_RE =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/gu;
/** Contiguous long digit runs (accounts, auth, reference, card-like). */
const LONG_DIGITS_RE = /\b\d{6,}\b/gu;
/** Digits separated by spaces/hyphens that still form 6+ digit values. */
const SPACED_OR_HYPHENATED_DIGITS_RE =
  /\b(?:\d[\d\s*-]*){5,}\d\b/gu;
/** Masked account/card tails. */
const MASKED_NUMBER_RE =
  /(?:\*+|x+|X+|•+)[\s*-]*(?:\d[\s*-]*){3,}\d|\b(?:ending|last)\s*(?:in|digits?)?:?\s*\*{0,4}\d{3,5}\b/giu;
const ROUTING_ACCOUNT_RE =
  /\b(?:routing|account|acct|ref(?:erence)?|auth(?:orization)?|trace)\s*[#:.-]?\s*[\d\s*-]{4,}\b/giu;
const BANK_TOKEN_RE =
  /\b(?:ID|INDN|DES|CO\s*ID|TRACE|REF|AUTH)\s*[:#.-]\s*[A-Z0-9*]{3,}\b/giu;
const CONTROL_INJECTION_RE =
  /\b(?:ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?|system\s*prompt|developer\s*message|jailbreak|exfiltrat(?:e|ion)|reveal\s+(?:the\s+)?(?:api|secret|key))\b/giu;
const HTML_TAG_RE = /<\/?[a-z][^>]*>/giu;
const HTML_ENTITY_RE =
  /&(?:#x?[0-9a-f]+|#\d+|nbsp|lt|gt|amp|quot|apos|mdash|ndash);/giu;
/** Zero-width / bidi / control characters used to smuggle instructions. */
const INVISIBLE_CHARS_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu;

const HTML_NAMED: Record<string, string> = {
  nbsp: " ",
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
  mdash: "-",
  ndash: "-",
};

const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/gu;

export type RedactionResult = {
  text: string;
  changed: boolean;
  rejected: boolean;
  reason: string | null;
};

function collapseWs(s: string): string {
  return s.replace(/\s+/gu, " ").trim();
}

/** Decode a subset of HTML entities so injection cannot hide behind &#32;. */
export function decodeBasicHtmlEntities(input: string): string {
  return input.replace(HTML_ENTITY_RE, (entity) => {
    const inner = entity.slice(1, -1);
    if (inner[0] === "#") {
      const hex = inner[1]?.toLowerCase() === "x";
      const num = hex
        ? Number.parseInt(inner.slice(2), 16)
        : Number.parseInt(inner.slice(1), 10);
      if (!Number.isFinite(num) || num < 0 || num > 0x10ffff) return " ";
      try {
        return String.fromCodePoint(num);
      } catch {
        return " ";
      }
    }
    return HTML_NAMED[inner.toLowerCase()] ?? " ";
  });
}

/** Base cleanup without punctuation softening (preserves emails / DES: tokens). */
export function prepareExplanationTextBase(input: string): string {
  let text = input.normalize("NFKC");
  text = decodeBasicHtmlEntities(text);
  text = text.replace(INVISIBLE_CHARS_RE, " ");
  text = text.replace(HTML_TAG_RE, " ");
  return collapseWs(text);
}

/** Soften punctuation gaps used to split injection phrases (scan-only). */
export function softenPunctuationForInjectionScan(input: string): string {
  return collapseWs(input.replace(/[._/\\|;,:]+/gu, " "));
}

/**
 * Normalize adversarial text before injection matching:
 * NFKC, strip invisible controls, decode entities, soften punctuation gaps.
 */
export function normalizeAdversarialText(input: string): string {
  return softenPunctuationForInjectionScan(prepareExplanationTextBase(input));
}

function countDigits(s: string): number {
  let n = 0;
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") n += 1;
  }
  return n;
}

function withIsoDatesMasked(text: string): {
  masked: string;
  restore: (s: string) => string;
} {
  const dates: string[] = [];
  const masked = text.replace(ISO_DATE_RE, (m) => {
    const idx = dates.length;
    dates.push(m);
    return `[iso${idx}]`;
  });
  return {
    masked,
    restore: (s: string) =>
      s.replace(/\[iso(\d+)\]/gu, (_, i) => dates[Number(i)] ?? ""),
  };
}

function redactSpacedOrHyphenatedDigits(text: string): string {
  const { masked, restore } = withIsoDatesMasked(text);
  const redacted = masked.replace(SPACED_OR_HYPHENATED_DIGITS_RE, (match) => {
    if (countDigits(match) < 6) return match;
    // Placeholder-only spans are ISO dates — keep.
    if (/^\[iso\d+\]$/.test(match.trim())) return match;
    return "[redacted-id]";
  });
  return restore(redacted);
}

function hasInjectionIntent(normalized: string): boolean {
  CONTROL_INJECTION_RE.lastIndex = 0;
  return CONTROL_INJECTION_RE.test(normalized);
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

  const original = input;
  const base = prepareExplanationTextBase(input);

  if (
    hasInjectionIntent(base) ||
    hasInjectionIntent(softenPunctuationForInjectionScan(base))
  ) {
    return {
      text: "",
      changed: true,
      rejected: true,
      reason: "injection",
    };
  }

  let text = base;
  text = text.replace(EMAIL_RE, "[redacted-email]");
  text = text.replace(PHONE_RE, "[redacted-phone]");
  text = text.replace(MASKED_NUMBER_RE, "[redacted-id]");
  text = text.replace(ROUTING_ACCOUNT_RE, "[redacted-ref]");
  text = text.replace(BANK_TOKEN_RE, "[redacted-token]");
  text = text.replace(LONG_DIGITS_RE, "[redacted-id]");
  text = redactSpacedOrHyphenatedDigits(text);
  text = collapseWs(text);

  // Residual long alnum tokens that look like auth/account blobs
  if (/\b[A-Z0-9*]{18,}\b/u.test(text)) {
    text = text.replace(/\b[A-Z0-9*]{18,}\b/gu, "[redacted-token]");
    text = collapseWs(text);
  }

  if (text.length > maxChars) {
    text = collapseWs(text.slice(0, maxChars));
  }

  if (
    hasInjectionIntent(text) ||
    hasInjectionIntent(softenPunctuationForInjectionScan(text))
  ) {
    return {
      text: "",
      changed: true,
      rejected: true,
      reason: "injection_residue",
    };
  }

  const changed = text !== collapseWs(prepareExplanationTextBase(original));
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
  const base = prepareExplanationTextBase(text);
  if (
    hasInjectionIntent(base) ||
    hasInjectionIntent(softenPunctuationForInjectionScan(base))
  ) {
    return true;
  }
  const { masked } = withIsoDatesMasked(base);
  if (EMAIL_RE.test(masked)) {
    EMAIL_RE.lastIndex = 0;
    return true;
  }
  EMAIL_RE.lastIndex = 0;
  if (PHONE_RE.test(masked)) {
    PHONE_RE.lastIndex = 0;
    return true;
  }
  PHONE_RE.lastIndex = 0;
  if (LONG_DIGITS_RE.test(masked)) {
    LONG_DIGITS_RE.lastIndex = 0;
    return true;
  }
  LONG_DIGITS_RE.lastIndex = 0;
  if (BANK_TOKEN_RE.test(masked)) {
    BANK_TOKEN_RE.lastIndex = 0;
    return true;
  }
  BANK_TOKEN_RE.lastIndex = 0;
  if (MASKED_NUMBER_RE.test(masked)) {
    MASKED_NUMBER_RE.lastIndex = 0;
    return true;
  }
  MASKED_NUMBER_RE.lastIndex = 0;
  SPACED_OR_HYPHENATED_DIGITS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPACED_OR_HYPHENATED_DIGITS_RE.exec(masked))) {
    if (/^\[iso\d+\]$/.test(m[0].trim())) continue;
    if (countDigits(m[0]) >= 6) return true;
  }
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

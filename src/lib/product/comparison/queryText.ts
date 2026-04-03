import { normalizeText } from "../normalization";

/**
 * Short, high-signal query for retailer search (reduces noise vs full title).
 */
export function extractImportantQuery(input: string): string {
  const cleaned = normalizeText(input);

  const brandMatch = cleaned.match(
    /\b(samsung|lg|sony|hisense|tcl|nike|adidas|apple|beats)\b/i
  );
  const modelMatch = cleaned.match(
    /\b(qn\d{2,4}[a-z0-9]*|oled|neo qled|air max|u8000f|u6|u7|u8)\b/i
  );
  const sizeMatch = cleaned.match(/\b\d{2,3}(-|\s)?inch\b/i);
  const typeMatch = cleaned.match(
    /\b(tv|smart tv|shoes|socks|speaker|headphones)\b/i
  );

  const parts = [
    brandMatch?.[0],
    modelMatch?.[0],
    sizeMatch?.[0]?.replace("-", " "),
    typeMatch?.[0],
  ].filter(Boolean);

  if (parts.length >= 2) {
    return parts.join(" ");
  }

  return cleaned;
}

/**
 * Presentation-only merchant display labels.
 * Does not change matching, classification, IDs, or totals.
 */

const BRAND_RULES: Array<{ re: RegExp; label: string }> = [
  { re: /\bUS\s*BANK\b.*\b(MORT|MTG|HOME)/i, label: "U.S. Bank Mortgage" },
  { re: /\bUSBANK\b.*\b(MORT|MTG|HOME)/i, label: "U.S. Bank Mortgage" },
  { re: /\bREPUBLIC\s*SERVICES|\bREPUBLICSERVICES|\bRSIBILLPAY\b/i, label: "Republic Services" },
  { re: /\bAFFIRM\b/i, label: "Affirm" },
  { re: /\bSYNCHRONY\b/i, label: "Synchrony Bank" },
  { re: /\bCOMENITY\b/i, label: "Comenity" },
  { re: /\bWAL-?\s*MART|\bWALMART\b/i, label: "Walmart" },
  { re: /\bSAMS?\s*CLUB|\bSAMSCLUB\b/i, label: "Sam’s Club" },
  { re: /\bSTATE\s*FARM\b/i, label: "State Farm" },
  { re: /\bAT\s*&\s*T|\bATT\b|\bATT\*/i, label: "AT&T" },
  { re: /\bNETFLIX\b/i, label: "Netflix" },
  { re: /\bPEACOCK\b/i, label: "Peacock" },
  { re: /\bOPENAI|\bCHATGPT\b/i, label: "OpenAI ChatGPT" },
  { re: /\bSHELL\b/i, label: "Shell" },
  { re: /\bMARATHON\b/i, label: "Marathon" },
  { re: /\bTHORNTONS?\b/i, label: "Thorntons" },
  { re: /\bSERPAPI|\bSERPER\b/i, label: "SerpAPI" },
  { re: /\bNETLIFY\b/i, label: "Netlify" },
  { re: /\bDEEPGRAM\b/i, label: "Deepgram" },
  { re: /\bELEVEN\s*LABS|\bELEVENLABS\b/i, label: "ElevenLabs" },
];

/**
 * Friendly display name for overview cards. Falls back to cleaned title-ish text
 * without inventing an unknown brand.
 */
export function presentationMerchantDisplayName(
  raw: string,
  fallback?: string
): string {
  const text = (raw || fallback || "").trim();
  if (!text) return "Unknown merchant";

  for (const rule of BRAND_RULES) {
    if (rule.re.test(text)) return rule.label;
  }

  // Light cleanup only — keep honesty for unknown merchants
  const cleaned = text
    .replace(/\b(DES:|INDN:|CO\s+ID:|ID:|WEB|PPD|CCD|CHECKCARD|PURCHASE)\b/giu, " ")
    .replace(/[^A-Za-z0-9&\s.'-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  if (!cleaned || cleaned.length < 2) return fallback?.trim() || "Unknown merchant";

  return cleaned
    .split(" ")
    .slice(0, 5)
    .map((w) => {
      if (/^(AT&T|USBANK)$/i.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

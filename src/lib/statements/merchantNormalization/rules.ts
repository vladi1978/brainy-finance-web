import {
  matchKnownMerchantBrand,
  normalizeMerchantText,
} from "../merchantNormalize";
import { descriptorNoiseScore, stripMerchantDescriptorNoise } from "./stripNoise";
import type { MerchantNormalizationResult } from "./types";

function titleCaseTokens(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/gu)
    .filter(Boolean)
    .map((w) => {
      if (/^[A-Z]{2,}$/u.test(w)) return w;
      if (w === "at&t" || w === "att") return "AT&T";
      return w.slice(0, 1).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

function collapseBrandTokenRuns(text: string): string {
  return text
    .replace(/\b([A-Z]{2,})\s+([A-Z]{2,})\b/gu, "$1$2")
    .replace(/\s+/gu, " ")
    .trim();
}

function extractCoreBrandLabel(cleaned: string, clusterKey: string): string {
  const blob = `${cleaned} ${clusterKey}`;
  const known = matchKnownMerchantBrand(blob);
  if (known) return known;

  const upper = cleaned.toUpperCase();
  if (/\bBP\b/u.test(upper) || /\bBP\s*#|\bBP\s+GAS\b/u.test(blob)) return "BP";
  if (/\bKAFENELEAS\b/ui.test(blob)) return "Kafeneleas";
  if (/\bNFLX\b/u.test(upper)) return "Netflix";

  const words = cleaned
    .split(/\s+/u)
    .filter((w) => w.length >= 2 && !/^\d+$/u.test(w))
    .slice(0, 5);

  if (!words.length) {
    const fromKey = clusterKey
      .replace(/\d+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 48);
    return titleCaseTokens(fromKey);
  }

  const joined = collapseBrandTokenRuns(words.join(" "));
  return titleCaseTokens(joined).slice(0, 72);
}

export function isAmbiguousMerchantNormalization(
  result: MerchantNormalizationResult,
  clusterKey: string
): boolean {
  if (result.confidence < 0.72) return true;
  if (result.normalizedName.length < 3) return true;
  if (/\d{3,}/u.test(result.normalizedName)) return true;

  const noise = descriptorNoiseScore(result.normalizedName);
  if (noise > 0.22) return true;

  const normKey = result.normalizedName.toUpperCase().replace(/\s+/gu, "");
  const clusterCompact = clusterKey.replace(/\s+/gu, "").slice(0, 24);
  if (
    clusterCompact.length >= 8 &&
    normKey.length >= 8 &&
    clusterCompact.startsWith(normKey.slice(0, 6)) === false &&
    normKey.includes(clusterCompact.slice(0, 8)) === false &&
    result.confidence < 0.88
  ) {
    const keyNoise = descriptorNoiseScore(clusterKey);
    if (keyNoise > 0.18) return true;
  }

  return false;
}

export function normalizeMerchantDeterministic(args: {
  rawExamples: string[];
  clusterKey: string;
}): MerchantNormalizationResult {
  const rawExamples = [...new Set(args.rawExamples.map((d) => d.trim()).filter(Boolean))];
  const primary = rawExamples[0] ?? args.clusterKey;
  const cleanedSamples = rawExamples.map(stripMerchantDescriptorNoise);
  const cleanedPrimary = cleanedSamples[0] ?? stripMerchantDescriptorNoise(primary);
  const blob = `${cleanedPrimary} ${args.clusterKey} ${cleanedSamples.join(" ")}`;

  const known = matchKnownMerchantBrand(blob);
  if (known) {
    return {
      normalizedName: known,
      rawExamples,
      confidence: 0.96,
      reason: "Known merchant brand pattern",
      source: "rules",
    };
  }

  const label = extractCoreBrandLabel(cleanedPrimary, args.clusterKey);
  const noise = Math.max(
    descriptorNoiseScore(primary),
    descriptorNoiseScore(args.clusterKey)
  );

  if (label.length >= 3 && noise < 0.14) {
    return {
      normalizedName: label,
      rawExamples,
      confidence: 0.84,
      reason: "Deterministic descriptor cleanup",
      source: "rules",
    };
  }

  if (label.length >= 3 && noise < 0.28) {
    return {
      normalizedName: label,
      rawExamples,
      confidence: 0.72,
      reason: "Heuristic brand extraction from noisy descriptor",
      source: "rules",
    };
  }

  const fallback =
    label.length >= 2
      ? label
      : titleCaseTokens(
          normalizeMerchantText(args.clusterKey).replace(/\d+/gu, " ").slice(0, 48)
        );

  return {
    normalizedName: fallback.slice(0, 80),
    rawExamples,
    confidence: 0.48,
    reason: "Ambiguous descriptor — candidate for AI normalization",
    source: "rules",
  };
}

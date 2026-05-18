import type { ConfidenceTier } from "./types";
import type { SpendingInsight } from "../types";

/** Unified 0–1 confidence for non-subscription spend rows. */
export function rowConfidence(row: SpendingInsight): number {
  return Math.min(
    1,
    Math.round(
      Math.max(row.recurringExpenseScore, row.spendingInsightScore) * 1000
    ) / 1000
  );
}

export function confidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= 0.8) return "confirmed";
  if (confidence >= 0.6) return "recurring_pattern";
  return "hidden";
}

export const CONFIDENCE_CONFIRMED_MIN = 0.8;
export const CONFIDENCE_VISIBLE_MIN = 0.6;

import {
  screenSizeDeltaTier,
  screenSizeDelta,
} from "../matching/displayDimensions";
import { buildUniversalMatchSnapshot } from "../matching/snapshot";
import type { DepartmentConfig, DepartmentMatchTier } from "./types";
import type { ExtractedDepartmentAttributes } from "./types";
import type { NormalizedProduct } from "../types";

function pickHighlightAttribute(
  config: DepartmentConfig,
  sourceAttrs: ExtractedDepartmentAttributes,
  candidateAttrs: ExtractedDepartmentAttributes
): string | null {
  for (const key of config.importantAttributes) {
    const s = sourceAttrs[key];
    const c = candidateAttrs[key];
    if (s && c && s.toLowerCase() === c.toLowerCase()) {
      return `${key}:${s}`;
    }
  }
  return null;
}

function electronicsScreenExplanation(
  sourceNorm: NormalizedProduct | undefined,
  candidateNorm: NormalizedProduct | undefined,
  sourceAttrs: ExtractedDepartmentAttributes,
  candidateAttrs: ExtractedDepartmentAttributes,
  scoreReasons: string[]
): string | null {
  const srcSnap = sourceNorm ? buildUniversalMatchSnapshot(sourceNorm) : null;
  const candSnap = candidateNorm ? buildUniversalMatchSnapshot(candidateNorm) : null;
  const sa = srcSnap?.diagonalInches ?? parseInt(sourceAttrs.screenSize?.replace(/[^0-9]/g, "") ?? "", 10);
  const sb = candSnap?.diagonalInches ?? parseInt(candidateAttrs.screenSize?.replace(/[^0-9]/g, "") ?? "", 10);
  if (!Number.isFinite(sa) || !Number.isFinite(sb)) return null;

  const tierDelta = screenSizeDeltaTier(screenSizeDelta(sa, sb));
  if (tierDelta === "exact") {
    const sameModel = scoreReasons.some(
      (r) =>
        r.includes("model_family") ||
        r.includes("model_substring") ||
        r.includes("model_fuzzy")
    );
    if (sameModel) return "Same screen size and model family";
    return "Exact screen size matched";
  }
  return "Screen size mismatch";
}

/** Build a user-facing explanation from department rules and match context. */
export function buildMatchExplanation(
  config: DepartmentConfig,
  tier: DepartmentMatchTier,
  sourceAttrs: ExtractedDepartmentAttributes,
  candidateAttrs: ExtractedDepartmentAttributes,
  scoreReasons: string[],
  rejectionReason?: string | null,
  context?: {
    sourceNorm?: NormalizedProduct;
    candidateNorm?: NormalizedProduct;
  }
): string {
  if (tier === "rejected" || rejectionReason) {
    const rejectRule = config.explanationRules.find((r) => r.tier === "rejected");
    const reason = rejectionReason ?? "low match score";
    return (rejectRule?.template ?? "Rejected: {reason}").replace(
      "{reason}",
      reason
    );
  }

  const rule =
    config.explanationRules.find((r) => r.tier === tier) ??
    config.explanationRules.find((r) => r.tier === "compatible_alternative");

  let text = rule?.template ?? "Related product — verify details before buying.";

  const highlight = pickHighlightAttribute(config, sourceAttrs, candidateAttrs);
  if (highlight && text.includes("{attribute}")) {
    text = text.replace("{attribute}", highlight.split(":")[1] ?? highlight);
  }

  if (tier === "exact_match" || tier === "high_confidence" || tier === "similar_specs") {
    if (config.departmentId === "electronics") {
      const electronicsLine = electronicsScreenExplanation(
        context?.sourceNorm,
        context?.candidateNorm,
        sourceAttrs,
        candidateAttrs,
        scoreReasons
      );
      if (electronicsLine) return electronicsLine;
    }
    if (config.departmentId === "pools_outdoor") {
      const sameDim =
        sourceAttrs.dimensions &&
        candidateAttrs.dimensions &&
        sourceAttrs.dimensions === candidateAttrs.dimensions;
      if (sameDim) return "Dimensions match exactly";
      if (
        sourceAttrs.dimensions &&
        candidateAttrs.dimensions &&
        scoreReasons.some((r) => r.includes("dimensions_close"))
      ) {
        return "Dimensions match closely";
      }
    }
    if (config.departmentId === "tools") {
      const sameVoltage =
        sourceAttrs.voltage &&
        candidateAttrs.voltage &&
        sourceAttrs.voltage === candidateAttrs.voltage;
      const samePlatform =
        sourceAttrs.batteryPlatform &&
        candidateAttrs.batteryPlatform &&
        sourceAttrs.batteryPlatform === candidateAttrs.batteryPlatform;
      if (sameVoltage && samePlatform) return "Same voltage and battery platform";
      if (sameVoltage) return "Same voltage, model, and tool type";
    }
  }

  return text;
}

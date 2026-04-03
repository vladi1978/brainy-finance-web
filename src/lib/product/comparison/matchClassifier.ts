import {
  buildProductMatchProfile,
  categoriesCompatible,
  extractTvSignals,
  familiesOverlap,
  isTvProduct,
  type ProductMatchProfile,
  type TvSignals,
} from "../normalization";
import type { MatchEvaluation, MatchType } from "./matchTypes";

function jaccardKeywords(a: string[], b: string[]): number {
  const A = new Set(a.map((x) => x.toLowerCase()));
  const B = new Set(b.map((x) => x.toLowerCase()));
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) {
    if (B.has(x)) inter += 1;
  }
  const union = A.size + B.size - inter;
  return union > 0 ? inter / union : 0;
}

function brandsCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4) {
    if (a.includes(b) || b.includes(a)) return true;
  }
  return false;
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function resolutionCompatible(s: TvSignals, c: TvSignals): boolean {
  if (!s.resolution || !c.resolution) return true;
  return s.resolution === c.resolution;
}

function displayCompatible(s: TvSignals, c: TvSignals): boolean {
  if (!s.display || !c.display) return true;
  return s.display === c.display;
}

function smartCompatible(s: TvSignals, c: TvSignals): boolean {
  if (s.smartTv == null || c.smartTv == null) return true;
  return s.smartTv === c.smartTv;
}

function genderClash(
  a: ProductMatchProfile,
  b: ProductMatchProfile
): boolean {
  if (!a.gender || !b.gender) return false;
  return (
    (a.gender === "women" && b.gender === "men") ||
    (a.gender === "men" && b.gender === "women")
  );
}

function classifyGenericMatch(
  source: ProductMatchProfile,
  cand: ProductMatchProfile
): { kind: MatchType; score: number; reasons: string[] } {
  const reasons: string[] = [];

  if (!categoriesCompatible(source.category, cand.category)) {
    reasons.push(
      `category_mismatch:${source.category}->${cand.category}`
    );
    return { kind: "none", score: 0, reasons };
  }

  const srcBrand = source.brandKey;
  const candBrand = cand.brandKey;
  if (srcBrand && candBrand && !brandsCompatible(srcBrand, candBrand)) {
    reasons.push(`brand_incompatible:${srcBrand}|${candBrand}`);
    return { kind: "none", score: 0, reasons };
  }

  const kwSim = jaccardKeywords(source.keywords, cand.keywords);
  reasons.push(`keyword_jaccard:${kwSim.toFixed(3)}`);

  let score = kwSim * 52;

  if (srcBrand && candBrand && brandsCompatible(srcBrand, candBrand)) {
    score += 28;
    reasons.push("brand_aligned");
  } else if (!srcBrand || !candBrand) {
    score += 6;
    reasons.push("brand_missing_side");
  }

  if (source.packCount != null && cand.packCount != null) {
    if (source.packCount === cand.packCount) {
      score += 18;
      reasons.push(`pack_match:${source.packCount}`);
    } else {
      score -= 48;
      reasons.push(`pack_clash:${source.packCount}vs${cand.packCount}`);
    }
  }

  if (source.gender && cand.gender) {
    if (source.gender === cand.gender) {
      score += 8;
      reasons.push(`gender_match:${source.gender}`);
    } else if (genderClash(source, cand)) {
      score -= 45;
      reasons.push("gender_clash_women_men");
    } else {
      score -= 18;
      reasons.push(`gender_mismatch:${source.gender}|${cand.gender}`);
    }
  }

  score = clampScore(score);

  const brandOk =
    !srcBrand || !candBrand || brandsCompatible(srcBrand, candBrand);
  const packOk =
    source.packCount == null ||
    cand.packCount == null ||
    source.packCount === cand.packCount;

  const exact =
    brandOk &&
    packOk &&
    kwSim >= 0.38 &&
    !genderClash(source, cand) &&
    (Boolean(srcBrand && candBrand) || kwSim >= 0.48);

  const strong =
    brandOk &&
    packOk &&
    kwSim >= 0.2 &&
    !genderClash(source, cand) &&
    (Boolean(srcBrand && candBrand) || kwSim >= 0.34);

  if (exact) {
    reasons.push("tier:exact");
    return { kind: "exact", score: Math.max(score, 72), reasons };
  }
  if (strong) {
    reasons.push("tier:strong");
    return { kind: "strong", score: Math.max(score, 54), reasons };
  }
  if (kwSim >= 0.07 && brandOk) {
    reasons.push("tier:weak");
    return { kind: "weak", score, reasons };
  }
  reasons.push("below_weak_keyword_threshold");
  return { kind: "none", score, reasons };
}

function classifyTvMatch(
  srcBrand: string | null,
  candBrand: string | null,
  srcTv: TvSignals,
  candTv: TvSignals,
  srcKeywords: string[],
  candKeywords: string[]
): { kind: MatchType; score: number; reasons: string[] } {
  const reasons: string[] = [];

  if (srcBrand && candBrand && !brandsCompatible(srcBrand, candBrand)) {
    reasons.push(`brand_incompatible:${srcBrand}|${candBrand}`);
    return { kind: "none", score: 0, reasons };
  }

  const kwj = jaccardKeywords(srcKeywords, candKeywords);
  const mtj = jaccardKeywords(srcTv.modelTokens, candTv.modelTokens);
  reasons.push(`tv_kw_jaccard:${kwj.toFixed(3)}`, `tv_model_jaccard:${mtj.toFixed(3)}`);

  let score = 0;
  if (srcBrand && candBrand && brandsCompatible(srcBrand, candBrand)) {
    score += 36;
    reasons.push("brand_aligned");
  } else if (!srcBrand || !candBrand) {
    score += 10;
    reasons.push("brand_missing_side");
  }

  if (srcTv.inches != null && candTv.inches != null) {
    if (srcTv.inches === candTv.inches) {
      score += 28;
      reasons.push(`size_inches_match:${srcTv.inches}`);
    } else {
      score -= 46;
      reasons.push(`size_inches_clash:${srcTv.inches}vs${candTv.inches}`);
    }
  } else {
    score += 3;
    reasons.push("size_inches_partial");
  }

  if (srcTv.display && candTv.display) {
    if (srcTv.display === candTv.display) {
      score += 14;
      reasons.push(`display_match:${srcTv.display}`);
    } else {
      score -= 20;
      reasons.push(`display_clash:${srcTv.display}|${candTv.display}`);
    }
  }

  if (srcTv.resolution && candTv.resolution) {
    if (srcTv.resolution === candTv.resolution) {
      score += 14;
      reasons.push(`resolution_match:${srcTv.resolution}`);
    } else {
      score -= 18;
      reasons.push(`resolution_clash:${srcTv.resolution}|${candTv.resolution}`);
    }
  }

  if (srcTv.smartTv != null && candTv.smartTv != null) {
    if (srcTv.smartTv === candTv.smartTv) {
      score += 8;
    } else {
      score -= 12;
      reasons.push("smart_tv_clash");
    }
  }

  score += mtj * 24;
  score += kwj * 18;

  score = clampScore(score);

  const brandOk =
    !srcBrand || !candBrand || brandsCompatible(srcBrand, candBrand);
  const sizeBoth = srcTv.inches != null && candTv.inches != null;
  const sizeMatch = sizeBoth && srcTv.inches === candTv.inches;
  const sizeConflict = sizeBoth && srcTv.inches !== candTv.inches;

  if (sizeConflict) {
    reasons.push("tv_size_conflict");
    return { kind: "none", score: Math.max(0, score), reasons };
  }

  const strongTokenOverlap = mtj >= 0.36 || kwj >= 0.4;
  const familyMatch = familiesOverlap(srcTv.modelTokens, candTv.modelTokens);

  const displayConflict =
    Boolean(srcTv.display && candTv.display) &&
    srcTv.display !== candTv.display;

  if (
    brandOk &&
    sizeMatch &&
    !displayConflict &&
    (familyMatch || strongTokenOverlap)
  ) {
    reasons.push("tier:exact_tv");
    return { kind: "exact", score: Math.max(score, 76), reasons };
  }

  const coreOk =
    resolutionCompatible(srcTv, candTv) &&
    displayCompatible(srcTv, candTv) &&
    smartCompatible(srcTv, candTv) &&
    (!sizeBoth || sizeMatch);

  const closeModel = mtj >= 0.2 || kwj >= 0.26;

  if (brandOk && coreOk && closeModel) {
    if (!sizeBoth) {
      if (mtj >= 0.16 || kwj >= 0.3) {
        reasons.push("tier:strong_tv_partial_size");
        return { kind: "strong", score: Math.max(score, 56), reasons };
      }
      if (kwj >= 0.12 || mtj >= 0.1) {
        reasons.push("tier:weak_tv");
        return { kind: "weak", score, reasons };
      }
      reasons.push("tv_below_weak_threshold");
      return { kind: "none", score, reasons };
    }
    reasons.push("tier:strong_tv");
    return { kind: "strong", score: Math.max(score, 58), reasons };
  }

  if ((kwj >= 0.1 || mtj >= 0.08) && brandOk) {
    reasons.push("tier:weak_tv");
    return { kind: "weak", score, reasons };
  }
  reasons.push("tv_no_match");
  return { kind: "none", score, reasons };
}

/**
 * Classify how closely a candidate matches the source listing (with reasons for logs).
 */
export function evaluateProductMatchDetailed(
  sourceTitle: string,
  sourceBrand: string | null | undefined,
  candidateTitle: string,
  candidateBrand: string | null | undefined
): MatchEvaluation {
  const srcIsTv = isTvProduct(sourceTitle);
  const candIsTv = isTvProduct(candidateTitle);

  if (srcIsTv !== candIsTv) {
    return {
      matchType: "none",
      score: 0,
      reasons: [
        `tv_path_mismatch:sourceTv=${srcIsTv},candTv=${candIsTv}`,
      ],
    };
  }

  const srcProfile = buildProductMatchProfile(sourceTitle, sourceBrand);
  const candProfile = buildProductMatchProfile(
    candidateTitle,
    candidateBrand
  );

  if (srcIsTv && candIsTv) {
    const sTv = extractTvSignals(sourceTitle);
    const cTv = extractTvSignals(candidateTitle);
    const { kind, score, reasons } = classifyTvMatch(
      srcProfile.brandKey,
      candProfile.brandKey,
      sTv,
      cTv,
      srcProfile.keywords,
      candProfile.keywords
    );
    return { matchType: kind, score, reasons };
  }

  const { kind, score, reasons } = classifyGenericMatch(
    srcProfile,
    candProfile
  );
  return { matchType: kind, score, reasons };
}

export function evaluateProductMatch(
  sourceTitle: string,
  sourceBrand: string | null | undefined,
  candidateTitle: string,
  candidateBrand: string | null | undefined
): { matchType: MatchType; score: number } {
  const d = evaluateProductMatchDetailed(
    sourceTitle,
    sourceBrand,
    candidateTitle,
    candidateBrand
  );
  return { matchType: d.matchType, score: d.score };
}

export function scoreProductMatch(
  sourceTitle: string,
  sourceBrand: string | null | undefined,
  candidateTitle: string,
  candidateBrand: string | null | undefined
): number {
  return evaluateProductMatch(
    sourceTitle,
    sourceBrand,
    candidateTitle,
    candidateBrand
  ).score;
}

/** Re-export for consumers that previously imported from compareEngine */
export { isTvProduct, extractTvSignals } from "../normalization";

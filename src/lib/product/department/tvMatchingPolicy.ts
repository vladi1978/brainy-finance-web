import { candidateTitleMentionsSourceOemBrand } from "../normalize";
import type { ProductIdentityResult } from "../matching/productIdentity";
import type { NormalizedProduct } from "../types";
import type { DepartmentAttributeKey } from "./types";

/** P0 cap — blocks High Confidence / Exact Match for conflicting TV OEM/model pairs. */
export const TV_P0_SCORE_CAP = 65;

/** Electronics department weights when either listing is TV-class. */
export const TV_ELECTRONICS_SCORING_WEIGHTS: Partial<
  Record<DepartmentAttributeKey, number>
> = {
  brand: 25,
  modelNumber: 35,
  screenSize: 10,
  storage: 8,
  refreshRate: 6,
  smartTvPlatform: 4,
  productType: 6,
};

export function isElectronicsTvListingPair(
  sourceNorm: NormalizedProduct,
  candidateNorm: NormalizedProduct
): boolean {
  const tvLike = (n: NormalizedProduct) =>
    n.category === "tv" || n.structured.productType === "tv";
  return tvLike(sourceNorm) || tvLike(candidateNorm);
}

export function isConcreteTvModelSku(
  value: string | null | undefined
): boolean {
  if (!value) return false;
  const norm = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm.length >= 5;
}

export function tvOemBrandsKnownAndDifferent(args: {
  sourceBrand: string | null | undefined;
  candidateBrand: string | null | undefined;
  candidateTitle: string;
}): boolean {
  const { sourceBrand, candidateBrand, candidateTitle } = args;
  if (!sourceBrand || !candidateBrand) return false;
  if (sourceBrand === candidateBrand) return false;
  return !candidateTitleMentionsSourceOemBrand({
    sourceBrand,
    candidateBrand,
    candidateTitle,
  });
}

export function shouldApplyTvBrandMismatchCap(
  sourceNorm: NormalizedProduct,
  candidateNorm: NormalizedProduct,
  candidateTitle: string
): boolean {
  if (!isElectronicsTvListingPair(sourceNorm, candidateNorm)) return false;
  const sourceBrand =
    sourceNorm.brand ?? sourceNorm.structured.brand ?? null;
  const candidateBrand =
    candidateNorm.brand ?? candidateNorm.structured.brand ?? null;
  return tvOemBrandsKnownAndDifferent({
    sourceBrand,
    candidateBrand,
    candidateTitle,
  });
}

/**
 * TV identity conflict for display score: do not let identity/department max() inflate
 * above {@link TV_P0_SCORE_CAP}.
 */
export function resolveTvDisplayScoreCap(args: {
  sourceNorm: NormalizedProduct;
  candidateNorm: NormalizedProduct;
  sourceTitle: string;
  candidateTitle: string;
  identity: ProductIdentityResult;
  departmentScore?: number | null;
}): number | null {
  const {
    sourceNorm,
    candidateNorm,
    sourceTitle,
    candidateTitle,
    identity,
    departmentScore,
  } = args;

  if (!isElectronicsTvListingPair(sourceNorm, candidateNorm)) return null;

  if (
    shouldApplyTvBrandMismatchCap(sourceNorm, candidateNorm, candidateTitle)
  ) {
    return TV_P0_SCORE_CAP;
  }

  const reasons = identity.identityReasons;
  if (reasons.some((r) => r.includes("hard_conflict"))) {
    return TV_P0_SCORE_CAP;
  }
  if (reasons.some((r) => r.startsWith("brand:miss"))) {
    return TV_P0_SCORE_CAP;
  }

  const srcModel =
    sourceNorm.structured.fullModel ??
    sourceNorm.structured.modelFamily ??
    null;
  const candModel =
    candidateNorm.structured.fullModel ??
    candidateNorm.structured.modelFamily ??
    null;
  if (
    isConcreteTvModelSku(srcModel) &&
    isConcreteTvModelSku(candModel) &&
    srcModel!.toLowerCase().replace(/[^a-z0-9]/g, "") !==
      candModel!.toLowerCase().replace(/[^a-z0-9]/g, "") &&
    reasons.some((r) => r.startsWith("model:miss"))
  ) {
    return TV_P0_SCORE_CAP;
  }

  if (
    departmentScore != null &&
    departmentScore <= TV_P0_SCORE_CAP &&
    reasons.some((r) => r.includes("tv_brand_mismatch_cap"))
  ) {
    return TV_P0_SCORE_CAP;
  }

  void sourceTitle;
  return null;
}

import { extractBrandGuess, normalizeBrandKey } from "./brand";
import type { ProductCategory } from "./category";
import { inferProductCategory } from "./category";
import { extractGenderBucket, type GenderBucket } from "./gender";
import { extractPackCount } from "./pack";
import { normalizeText, tokenizeSignificant } from "./text";
import { extractTvSignals, isTvProduct, type TvSignals } from "./tvSignals";

/**
 * Normalized view of a listing used for matching across retailers.
 */
export type ProductMatchProfile = {
  normalizedTitle: string;
  /** Canonical brand key when inferable */
  brandKey: string | null;
  packCount: number | null;
  gender: GenderBucket;
  category: ProductCategory;
  keywords: string[];
  tv: TvSignals | null;
};

export function buildProductMatchProfile(
  title: string,
  explicitBrand?: string | null
): ProductMatchProfile {
  const normalizedTitle = normalizeText(title);
  const isTv = isTvProduct(title);
  const brandKey = extractBrandGuess(title, explicitBrand);
  return {
    normalizedTitle,
    brandKey,
    packCount: extractPackCount(title),
    gender: extractGenderBucket(title),
    category: inferProductCategory(title, isTv),
    keywords: tokenizeSignificant(title),
    tv: isTv ? extractTvSignals(title) : null,
  };
}

export function profileBrandForMatch(
  profile: ProductMatchProfile,
  explicitBrand?: string | null
): string | null {
  if (explicitBrand?.trim()) return normalizeBrandKey(explicitBrand);
  return profile.brandKey;
}

import type { ManualProductFormFields } from "./manualProductInput";
import { manualFormHasSearchableCore } from "./manualProductInput";
import type { NormalizedProduct } from "./types";
import { isGenericRetailProductQuery } from "./urlProductQuery";
import { isAsinPlaceholderTitle, isUsablePdpTitle } from "./usablePdpTitle";

export const WEAK_SOURCE_IDENTITY_MESSAGE =
  "Brainy could not identify the original product. Please paste the product title or use a product page with visible details.";

export function hasManualSearchableIdentity(
  useManualForm: boolean,
  manual: ManualProductFormFields | null | undefined
): boolean {
  return Boolean(useManualForm && manual && manualFormHasSearchableCore(manual));
}

/**
 * Block compare search when the reference product cannot be identified from title/normalization.
 */
export function isWeakSourceIdentityForCompare(
  referenceTitle: string,
  normalized: NormalizedProduct,
  options?: { supplementalDescription?: string | null }
): boolean {
  const title = referenceTitle.replace(/\s+/g, " ").trim();
  if (!title) return true;
  if (isAsinPlaceholderTitle(title)) return true;
  if (isGenericRetailProductQuery(title)) return true;
  if (/^product from [a-z0-9.-]+$/i.test(title)) return true;

  const supplemental = options?.supplementalDescription?.replace(/\s+/g, " ").trim() ?? "";
  const identityBlob = `${title} ${normalized.structured.title} ${supplemental}`
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.category !== "general") return false;

  const hasBrand = Boolean(normalized.brand?.trim());
  const hasModel = normalized.modelTokens.length > 0;
  const hasKindPhrases = (normalized.critical?.kindPhrases?.length ?? 0) > 0;
  const usefulTitle =
    isUsablePdpTitle(identityBlob) &&
    !isAsinPlaceholderTitle(identityBlob) &&
    identityBlob.length >= 12;

  if (hasBrand || hasModel || hasKindPhrases || usefulTitle) return false;

  return true;
}

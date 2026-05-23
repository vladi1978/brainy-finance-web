import type { CandidateProduct, NormalizedProduct } from "./types";

const NEAR_PRICE_ABS = 1;
const NEAR_PRICE_REL_FRAC = 0.015;

function isComparablePrice(price: number | null | undefined): boolean {
  return price != null && Number.isFinite(price) && price > 0;
}

function pricesNearlyIdentical(
  a: number | null | undefined,
  b: number | null | undefined
): boolean {
  if (!isComparablePrice(a) || !isComparablePrice(b)) return false;
  const pa = a as number;
  const pb = b as number;
  const delta = Math.abs(pa - pb);
  const baseline = Math.max(pa, pb);
  return delta <= Math.max(NEAR_PRICE_ABS, baseline * NEAR_PRICE_REL_FRAC);
}

/** Fingerprint usable for duplicate detection — null means do not semantic-dedupe. */
export function canonicalModelFingerprint(norm: NormalizedProduct): string | null {
  const fm = norm.structured?.fullModel?.replace(/\s+/g, "").toUpperCase();
  if (fm && fm.length >= 3) return fm;

  const tokens = (norm.modelTokens ?? []).map((t) =>
    String(t).replace(/\s+/g, "").toUpperCase()
  );
  const uniq = [...new Set(tokens.filter((x) => x.length >= 2))].sort();
  if (uniq.length === 0) return null;
  return uniq.join("|");
}

function pickBetterListing(a: CandidateProduct, b: CandidateProduct): CandidateProduct {
  const ca = a.sourceConfidence ?? 0;
  const cb = b.sourceConfidence ?? 0;
  if (Math.abs(ca - cb) >= 1e-4) return ca >= cb ? a : b;
  const pa = a.price ?? Number.POSITIVE_INFINITY;
  const pb = b.price ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa <= pb ? a : b;
  return a;
}

function listingsAreStrictDuplicates(a: CandidateProduct, b: CandidateProduct): boolean {
  if (a.store !== b.store) return false;
  if (a.normalized.titleNorm !== b.normalized.titleNorm) return false;

  const ma = canonicalModelFingerprint(a.normalized);
  const mb = canonicalModelFingerprint(b.normalized);
  if (ma === null || mb === null || ma !== mb) return false;

  if (!pricesNearlyIdentical(a.price, b.price)) return false;
  return true;
}

export function semanticStrictDuplicateReason(
  kept: CandidateProduct,
  dropped: CandidateProduct
): string {
  const m = canonicalModelFingerprint(kept.normalized);
  return (
    `strict listing duplicate — same retailer, identical normalized title, canonical model (${m}), ` +
    `and near-identical price (${String(kept.price)} vs ${String(dropped.price)}) — weaker listing removed`
  );
}

/** Collapse repeated rows whose retailer PDP/search URL strings match exactly (incl. query). */
export function dedupeIdenticalListingUrls(items: CandidateProduct[]): CandidateProduct[] {
  const before = items.length;
  const map = new Map<string, CandidateProduct>();

  for (const item of items) {
    const urlPart =
      item.productUrl.trim() ||
      item.shoppingHintUrl?.trim() ||
      item.title.replace(/\s+/g, " ").trim().toLowerCase();
    const key = `${item.store}|${urlPart.toLowerCase()}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }
    const winner = pickBetterListing(existing, item);
    const loser = winner === existing ? item : existing;
    console.log("[DEDUPE_DROP]", {
      keptTitle: winner.title,
      removedTitle: loser.title,
      reason:
        "identical canonical product URL (including query); kept higher-confidence / cheaper listing after multi-query repetition",
    });
    map.set(key, winner);
  }

  const out = [...map.values()];
  console.log("[DEDUPE_SUMMARY]", {
    before,
    after: out.length,
    removed: before - out.length,
  });
  return out;
}

/**
 * Drop only listings that agree on retailer, normalized title, canonical model, and nearly identical price.
 * Does not collapse on URL, price deltas, SKU suffixes, or missing-model rows.
 */
export function dedupeStrictSemanticDuplicates(items: CandidateProduct[]): CandidateProduct[] {
  const before = items.length;
  const kept: CandidateProduct[] = [];

  outer: for (const item of items) {
    for (let i = 0; i < kept.length; i++) {
      const prev = kept[i]!;
      if (!listingsAreStrictDuplicates(prev, item)) continue;
      const winner = pickBetterListing(prev, item);
      const loser = winner === prev ? item : prev;
      console.log("[DEDUPE_DROP]", {
        keptTitle: winner.title,
        removedTitle: loser.title,
        reason: semanticStrictDuplicateReason(winner, loser),
      });
      kept[i] = winner;
      continue outer;
    }
    kept.push(item);
  }

  console.log("[DEDUPE_SUMMARY]", {
    before,
    after: kept.length,
    removed: before - kept.length,
  });
  return kept;
}

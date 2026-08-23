import type { UniversalStoreId } from "./types";

/**
 * Strip noisy tracking params while keeping legitimate retailer query strings.
 */
export function scrubKnownNoiseParams(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
      "source",
    ]) {
      u.searchParams.delete(k);
    }
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Central affiliate formatter: returns a clean merchant PDP today, with room to
 * append program-specific tags once keys exist in the environment.
 */
export function toAffiliateUrl(productUrl: string, store: UniversalStoreId): string {
  let out = scrubKnownNoiseParams(productUrl.trim());

  if (store === "other") {
    return out;
  }

  const amazonTag = process.env.AMAZON_ASSOCIATE_TAG?.trim();
  if (store === "amazon" && amazonTag) {
    try {
      const u = new URL(out);
      if (!u.searchParams.get("tag")) {
        u.searchParams.set("tag", amazonTag);
      }
      out = u.toString();
    } catch {
      /* keep scrubbed original */
    }
  }

  /**
   * Partner shells (add query params when env is set; keep keys out of logs):
   * Amazon: AMAZON_ASSOCIATE_TAG → `tag`
   * Walmart / Target / Home Depot / Lowe's: e.g. WALMART_AFFILIATE_SID, TARGET_PARTNER_SUBID
   */
  void process.env.WALMART_AFFILIATE_SID;
  void process.env.TARGET_PARTNER_SUBID;
  void store;
  return out;
}

import type { StoreId } from "./types";

/**
 * Strip noisy tracking params while keeping legitimate retailer query strings.
 */
function scrubKnownNoiseParams(url: string): string {
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
export function toAffiliateUrl(productUrl: string, store: StoreId): string {
  let out = scrubKnownNoiseParams(productUrl.trim());

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

  /** Future: WALMART_IMPACT_ID, TARGET_PARTNER params, etc. */
  void store;
  return out;
}

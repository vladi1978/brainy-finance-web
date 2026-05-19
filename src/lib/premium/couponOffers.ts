import type { PremiumCouponOffer, ProductCategory, StoreId, UniversalStoreId } from "@/lib/product/types";

function stableId(parts: string[]): string {
  return parts.join("|").replace(/\s+/g, "-").slice(0, 120);
}

/**
 * Deterministic “active offer” simulator. Replace internals with a coupon partner HTTP client
 * (`process.env.COUPON_API_URL`, etc.) without changing the comparison API shape.
 */
export function getSimulatedStoreCoupons(
  store: UniversalStoreId,
  category: ProductCategory
): PremiumCouponOffer[] {
  if (store === "other") return [];
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 14);

  const validThrough = end.toISOString().slice(0, 10);

  const base: Omit<PremiumCouponOffer, "id">[] = [
    {
      headline: `${store} · shipping or pickup`,
      detail: "Simulated offer: check cart for free shipping promos on eligible items.",
      code: null,
      validThrough,
      source: "simulated",
    },
  ];

  if (store === "walmart" || store === "target") {
    base.push({
      headline: "Fresh / grocery pickup",
      detail: "Simulated pickup coupon for select grocery categories.",
      code: "BF-SIM-PICKUP",
      validThrough,
      source: "simulated",
    });
  }

  if (category === "tv" || category === "monitor" || category === "audio") {
    base.push({
      headline: "Electronics · accessories",
      detail: "Simulated promo on cables, mounts, and compatible sound bars.",
      code: "BF-SIM-ACC",
      validThrough,
      source: "simulated",
    });
  }

  return base.map((row, i) => ({
    ...row,
    id: stableId(["sim", store, category, String(i), row.headline]),
  }));
}

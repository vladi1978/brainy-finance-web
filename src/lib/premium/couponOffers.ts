import type { PremiumCouponOffer, ProductCategory, StoreId } from "@/lib/product/types";

function stableId(parts: string[]): string {
  return parts.join("|").replace(/\s+/g, "-").slice(0, 120);
}

/**
 * Deterministic “active offer” simulator. Replace internals with a coupon partner HTTP client
 * (`process.env.COUPON_API_URL`, etc.) without changing the comparison API shape.
 */
export function getSimulatedStoreCoupons(
  store: StoreId,
  category: ProductCategory
): PremiumCouponOffer[] {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 14);

  const validThrough = end.toISOString().slice(0, 10);

  const base: Omit<PremiumCouponOffer, "id">[] = [
    {
      headline: `${store} · envío o recogida`,
      detail: "Oferta simulada: revisa el carrito para promos de envío gratis en elegibles.",
      code: null,
      validThrough,
      source: "simulated",
    },
  ];

  if (store === "walmart" || store === "target") {
    base.push({
      headline: "Fresh / grocery pickup",
      detail: "Cupón simulado de pickup: aplica en categorías de comestibles seleccionadas.",
      code: "BF-SIM-PICKUP",
      validThrough,
      source: "simulated",
    });
  }

  if (category === "tv" || category === "monitor" || category === "audio") {
    base.push({
      headline: "Electrónica · accesorios",
      detail: "Promo simulada en cables, montajes y barras de sonido compatibles.",
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

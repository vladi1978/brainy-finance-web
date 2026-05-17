import { randomUUID } from "crypto";

/**
 * In-memory “Productos rastreados” — move to Postgres / KV when authentication exists.
 */
export type TrackedPriceAlert = {
  id: string;
  userId: string;
  productUrl: string;
  store: string;
  title: string | null;
  /** Snapshot cuando el usuario creó la alerta */
  baselinePrice: number | null;
  targetPrice: number;
  createdAt: string;
  lastCheckedAt: string | null;
  lastSimulatedPrice: number | null;
};

export type PriceAlertSurfaceNotification = {
  id: string;
  userId: string;
  alertId: string;
  store: string;
  productUrl: string;
  title: string | null;
  message: string;
  newPrice: number;
  targetPrice: number;
  createdAt: string;
};

const alerts = new Map<string, TrackedPriceAlert>();
/** Demo feed of “price dropped” banners keyed in handler by userId */
let notificationFeed: PriceAlertSurfaceNotification[] = [];

export function createTrackedPriceAlert(input: {
  userId: string;
  productUrl: string;
  store: string;
  title?: string | null;
  currentPrice: number | null;
  targetPrice: number;
}): TrackedPriceAlert {
  const row: TrackedPriceAlert = {
    id: randomUUID(),
    userId: input.userId.trim(),
    productUrl: input.productUrl.trim(),
    store: input.store.trim(),
    title: input.title?.trim() ?? null,
    baselinePrice: input.currentPrice,
    targetPrice: input.targetPrice,
    createdAt: new Date().toISOString(),
    lastCheckedAt: null,
    lastSimulatedPrice: null,
  };
  alerts.set(row.id, row);
  return row;
}

export function listTrackedAlertsForUser(userId: string): TrackedPriceAlert[] {
  const u = userId.trim();
  return [...alerts.values()]
    .filter((a) => a.userId === u)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Fictitious cron sweep: perturbs prices and enqueues UI notifications when target is met.
 * Wire to a real price fetcher per `productUrl` when scraping / retailer APIs exist.
 */
export function runSimulatedPriceAlertSweep(): {
  checked: number;
  triggered: number;
  notifications: PriceAlertSurfaceNotification[];
} {
  const batch: PriceAlertSurfaceNotification[] = [];
  let checked = 0;

  for (const a of alerts.values()) {
    checked += 1;
    const baseline = a.lastSimulatedPrice ?? a.baselinePrice;
    const seed =
      baseline != null && Number.isFinite(baseline)
        ? baseline
        : a.targetPrice * 1.08;
    const drift = 0.9 + Math.random() * 0.12;
    const newPrice = Math.max(0.01, Math.round(seed * drift * 100) / 100);
    a.lastSimulatedPrice = newPrice;
    a.lastCheckedAt = new Date().toISOString();

    if (newPrice <= a.targetPrice) {
      const n: PriceAlertSurfaceNotification = {
        id: randomUUID(),
        userId: a.userId,
        alertId: a.id,
        store: a.store,
        productUrl: a.productUrl,
        title: a.title,
        message: `Precio simulado $${newPrice.toFixed(2)} — alcanzó tu objetivo ($${a.targetPrice.toFixed(2)}).`,
        newPrice,
        targetPrice: a.targetPrice,
        createdAt: new Date().toISOString(),
      };
      batch.push(n);
    }
  }

  notificationFeed.push(...batch);
  return { checked, triggered: batch.length, notifications: batch };
}

export function peekPriceAlertNotificationsForUser(userId: string): PriceAlertSurfaceNotification[] {
  const u = userId.trim();
  return notificationFeed.filter((n) => n.userId === u);
}

export function clearPriceAlertNotificationsForUser(userId: string): void {
  const u = userId.trim();
  notificationFeed = notificationFeed.filter((n) => n.userId !== u);
}

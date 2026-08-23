import { NextResponse } from "next/server";
import {
  clearPriceAlertNotificationsForUser,
  createTrackedPriceAlert,
  listTrackedAlertsForUser,
  peekPriceAlertNotificationsForUser,
  runSimulatedPriceAlertSweep,
} from "@/lib/premium/priceAlerts";
import {
  DEV_BACKGROUND_TASKS_DISABLED_REASON,
  isDevBackgroundTasksDisabled,
} from "@/lib/dev/runtimeControls";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId")?.trim();
  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  if (isDevBackgroundTasksDisabled()) {
    return NextResponse.json({
      alerts: [],
      notifications: [],
      skipped: true,
      reason: DEV_BACKGROUND_TASKS_DISABLED_REASON,
    });
  }

  const sweep = url.searchParams.get("sweep") === "1";
  if (sweep) {
    runSimulatedPriceAlertSweep();
  }

  const ack = url.searchParams.get("ackNotifications") === "1";
  const notifications = peekPriceAlertNotificationsForUser(userId);
  if (ack) {
    clearPriceAlertNotificationsForUser(userId);
  }

  return NextResponse.json({
    alerts: listTrackedAlertsForUser(userId),
    notifications: ack ? [] : notifications,
  });
}

export async function POST(req: Request) {
  if (isDevBackgroundTasksDisabled()) {
    return NextResponse.json({
      skipped: true,
      reason: DEV_BACKGROUND_TASKS_DISABLED_REASON,
    });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const userId = String(body.userId ?? "").trim();
    const productUrl = String(body.productUrl ?? "").trim();
    const store = String(body.store ?? "").trim();
    const title = body.title != null ? String(body.title) : null;
    const currentPrice =
      typeof body.currentPrice === "number" && Number.isFinite(body.currentPrice)
        ? body.currentPrice
        : null;
    const targetPriceRaw = body.targetPrice;

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }
    if (!productUrl || !productUrl.startsWith("http")) {
      return NextResponse.json({ error: "Missing productUrl" }, { status: 400 });
    }
    if (!store) {
      return NextResponse.json({ error: "Missing store" }, { status: 400 });
    }

    const targetPrice =
      typeof targetPriceRaw === "number" && Number.isFinite(targetPriceRaw)
        ? targetPriceRaw
        : Number.parseFloat(String(targetPriceRaw ?? ""));

    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      return NextResponse.json({ error: "Invalid targetPrice" }, { status: 400 });
    }

    const alert = createTrackedPriceAlert({
      userId,
      productUrl,
      store,
      title,
      currentPrice,
      targetPrice,
    });

    return NextResponse.json({ alert });
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}

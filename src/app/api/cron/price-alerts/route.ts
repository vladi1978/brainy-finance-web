import { NextResponse } from "next/server";
import { runSimulatedPriceAlertSweep } from "@/lib/premium/priceAlerts";
import {
  DEV_BACKGROUND_TASKS_DISABLED_REASON,
  isDevBackgroundTasksDisabled,
} from "@/lib/dev/runtimeControls";
import { isProductionRuntime } from "@/lib/api/publicRequestGuards";

export const dynamic = "force-dynamic";

/**
 * Simulated cron target — schedule in `vercel.json` or an external worker.
 * Production requires CRON_SECRET + Authorization: Bearer <secret>.
 * Development: if CRON_SECRET is set, Bearer auth is required; if unset, allowed locally.
 */
function authorizeCron(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();

  if (isProductionRuntime()) {
    if (!secret) {
      console.error(
        "[cron/price-alerts] CRON_SECRET is not configured; refusing request"
      );
      return NextResponse.json(
        { error: "Cron endpoint is not configured" },
        { status: 503 }
      );
    }
    const auth = req.headers.get("authorization")?.trim();
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return null;
  }

  if (secret) {
    const auth = req.headers.get("authorization")?.trim();
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  return null;
}

export async function POST(req: Request) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  if (isDevBackgroundTasksDisabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: DEV_BACKGROUND_TASKS_DISABLED_REASON,
      checked: 0,
      triggered: 0,
      notifications: [],
    });
  }

  const result = runSimulatedPriceAlertSweep();
  return NextResponse.json({
    ok: true,
    checked: result.checked,
    triggered: result.triggered,
    notifications: result.notifications,
  });
}

export async function GET() {
  return NextResponse.json({
    message:
      "POST to run the simulated sweep. Production requires Authorization: Bearer CRON_SECRET.",
  });
}

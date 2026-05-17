import { NextResponse } from "next/server";
import { runSimulatedPriceAlertSweep } from "@/lib/premium/priceAlerts";

export const dynamic = "force-dynamic";

/**
 * Simulated cron target — schedule in `vercel.json` or an external worker.
 * Optional: set CRON_SECRET and send `Authorization: Bearer <secret>`.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = req.headers.get("authorization")?.trim();
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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
      "POST to run the simulated sweep (optional Bearer CRON_SECRET). Intended for cron workers.",
  });
}

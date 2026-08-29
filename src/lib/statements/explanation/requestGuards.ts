/**
 * Best-effort same-origin check for browser POSTs.
 * Not a substitute for auth — statements remain session-local in the browser.
 */

import { isOpenAiStatementExplanationEnabled } from "@/lib/ai/openaiExplanationGate";

function originMatchesRequest(origin: string, req: Request): boolean {
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const host = req.headers.get("host");
  if (host) {
    const hostNoPort = host.split(":")[0]?.toLowerCase();
    const originHost = originUrl.hostname.toLowerCase();
    if (originHost === hostNoPort) return true;
    if (host.toLowerCase() === originUrl.host.toLowerCase()) return true;
  }

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const normalized = vercel.replace(/^https?:\/\//i, "").split("/")[0];
    if (
      normalized &&
      originUrl.host.toLowerCase() === normalized.toLowerCase()
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Origin policy:
 * - Explanation enabled: Origin required and must match Host / VERCEL_URL.
 * - Explanation disabled: missing Origin allowed (deterministic fallback only);
 *   mismatched Origin still rejected.
 */
export function isAllowedExplainOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const enabled = isOpenAiStatementExplanationEnabled();

  if (!origin) {
    // When paid AI can run, refuse anonymous/cross-tool calls without Origin.
    return !enabled;
  }

  return originMatchesRequest(origin, req);
}

export function isJsonContentType(req: Request): boolean {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  return ct.includes("application/json");
}

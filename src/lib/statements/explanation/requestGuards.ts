/**
 * Best-effort same-origin check for browser POSTs.
 * Not a substitute for auth — statements remain session-local in the browser.
 */

export function isAllowedExplainOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) {
    // Non-browser or same-origin navigations may omit Origin; allow with Host match via referer optional.
    return true;
  }

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

export function isJsonContentType(req: Request): boolean {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  return ct.includes("application/json");
}

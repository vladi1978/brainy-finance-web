/**
 * Best-effort per-instance rate limit for statement explanations.
 * Serverless note: each isolate has its own Map — not a distributed limiter.
 * Platform WAF / edge rate limits remain required for production.
 */

import {
  EXPLANATION_RATE_LIMIT_MAX,
  EXPLANATION_RATE_LIMIT_WINDOW_MS,
} from "./constants";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function clientKeyFromRequest(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return `ip:${first}`;
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return `ip:${realIp}`;
  return "ip:unknown";
}

export function checkExplanationRateLimit(
  key: string,
  now = Date.now()
): { allowed: true } | { allowed: false; retryAfterSec: number } {
  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    buckets.set(key, {
      count: 1,
      resetAt: now + EXPLANATION_RATE_LIMIT_WINDOW_MS,
    });
    return { allowed: true };
  }
  if (existing.count >= EXPLANATION_RATE_LIMIT_MAX) {
    return {
      allowed: false,
      retryAfterSec: Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000)
      ),
    };
  }
  existing.count += 1;
  return { allowed: true };
}

/** Test-only helper to clear buckets between cases. */
export function resetExplanationRateLimitForTests(): void {
  buckets.clear();
}

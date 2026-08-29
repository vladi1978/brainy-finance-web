/**
 * Best-effort per-instance rate limit for statement explanations.
 * Serverless note: each isolate has its own Map — not a distributed limiter.
 * Platform WAF / edge rate limits remain required for production.
 */

import {
  EXPLANATION_RATE_LIMIT_KEY_CAP,
  EXPLANATION_RATE_LIMIT_MAX,
  EXPLANATION_RATE_LIMIT_WINDOW_MS,
} from "./constants";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function isPlausibleIp(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 64) return false;
  // Basic IPv4 / IPv6 / unknown-safe token — reject obvious header injection.
  if (/[\s,;]/.test(v)) return false;
  return /^[0-9a-fA-F:.]+$/.test(v);
}

/**
 * Prefer platform-provided identity headers; avoid trusting the leftmost
 * X-Forwarded-For hop (easily spoofed by clients).
 */
export function clientKeyFromRequest(req: Request): string {
  const vercelForwarded = req.headers.get("x-vercel-forwarded-for")?.trim();
  if (vercelForwarded) {
    const first = vercelForwarded.split(",")[0]?.trim();
    if (first && isPlausibleIp(first)) return `ip:${first}`;
  }

  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp && isPlausibleIp(realIp)) return `ip:${realIp}`;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    // Rightmost hop is typically appended by the trusted edge/proxy.
    const candidate = parts[parts.length - 1];
    if (candidate && isPlausibleIp(candidate)) return `ip:${candidate}`;
  }

  return "ip:unknown";
}

function evictExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

function enforceKeyCap(): void {
  if (buckets.size <= EXPLANATION_RATE_LIMIT_KEY_CAP) return;
  // Delete oldest-expiring entries first until under cap.
  const ranked = [...buckets.entries()].sort(
    (a, b) => a[1].resetAt - b[1].resetAt
  );
  const overflow = buckets.size - EXPLANATION_RATE_LIMIT_KEY_CAP;
  for (let i = 0; i < overflow; i++) {
    const key = ranked[i]?.[0];
    if (key) buckets.delete(key);
  }
}

export function checkExplanationRateLimit(
  key: string,
  now = Date.now()
): { allowed: true } | { allowed: false; retryAfterSec: number } {
  evictExpired(now);
  enforceKeyCap();

  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    buckets.set(key, {
      count: 1,
      resetAt: now + EXPLANATION_RATE_LIMIT_WINDOW_MS,
    });
    enforceKeyCap();
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

/** Test-only: current retained key count after eviction/cap. */
export function explanationRateLimitKeyCountForTests(): number {
  return buckets.size;
}

import "server-only";

/**
 * Tiny in-memory failure counter for login / signup throttling. The app runs as a
 * single container process, so a Map is enough — no Redis or other service. It
 * resets on restart, which is fine for slowing down password guessing.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
// Hard cap so a flood of made-up emails can't grow memory without bound. Past it,
// the oldest entries (Map keeps insertion order) are dropped first.
const MAX_BUCKETS = 50000;

function live(key: string, now: number): Bucket | null {
  const b = buckets.get(key);
  if (!b) return null;
  if (now >= b.resetAt) {
    buckets.delete(key);
    return null;
  }
  return b;
}

/** Seconds until `key` may try again, or 0 if it's under `limit` failures. */
export function retryAfter(key: string, limit: number): number {
  const now = Date.now();
  const b = live(key, now);
  return b && b.count >= limit ? Math.ceil((b.resetAt - now) / 1000) : 0;
}

/** Count one failure for `key`; the window starts at its first failure. */
export function recordFailure(key: string, windowMs: number): void {
  const now = Date.now();
  if (buckets.size > 10000) for (const k of buckets.keys()) live(k, now); // prune expired
  while (buckets.size >= MAX_BUCKETS) buckets.delete(buckets.keys().next().value!);
  const b = live(key, now);
  if (b) b.count++;
  else buckets.set(key, { count: 1, resetAt: now + windowMs });
}

export function clearFailures(key: string): void {
  buckets.delete(key);
}

/**
 * The client's IP, but only when a reverse proxy you control is in front of the
 * app and TRUST_PROXY=1 says so. Next.js fills in X-Forwarded-For itself when it's
 * missing, and passes through whatever a client sends, so without a trusted proxy
 * the header is either attacker-chosen (spoofable) or the Docker gateway that every
 * client shares (one person's failures would throttle everyone). Then this returns
 * null and callers rely on their per-account / per-device limits instead.
 * Caddy and Tailscale serve both set the real peer as the LAST entry.
 */
export function clientIp(req: Request): string | null {
  if (!/^(1|true|yes)$/i.test(process.env.TRUST_PROXY ?? "")) return null;
  const xff = req.headers.get("x-forwarded-for");
  if (!xff) return null;
  const last = xff.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last || null;
}

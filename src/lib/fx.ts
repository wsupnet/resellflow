/**
 * Today's USD/JPY rate for yen display, entry forms and the "good deal" calculator.
 * Each user's manual rate by default; fetched from FX_API_URL (cached in memory
 * for an hour) only for users who opt in. Records of what you actually paid use
 * the locked rate stored on each purchase.
 */
import { prisma } from "./db";

interface RateCache {
  usdToJpy: number;
  fetchedAt: number;
}

let cache: RateCache | null = null;
const TTL_MS = 60 * 60 * 1000;
const FALLBACK_USD_TO_JPY = 150; // manual rate for accounts that never set one

/** Today's fetched rate. When fetching is disabled or fails, the last fetched rate
 *  if there is one, else `fallback` (the caller's manual rate). */
export async function getUsdToJpy(fallback = FALLBACK_USD_TO_JPY): Promise<{ rate: number; stale: boolean }> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return { rate: cache.usdToJpy, stale: false };
  }
  // Set but empty = fetching disabled for the whole server.
  const url = process.env.FX_API_URL ?? "https://open.er-api.com/v6/latest/USD";
  if (!url) return { rate: cache?.usdToJpy ?? fallback, stale: true };
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`fx http ${res.status}`);
    const data = await res.json();
    const jpy = data?.rates?.JPY;
    if (typeof jpy !== "number") throw new Error("no JPY rate in response");
    cache = { usdToJpy: jpy, fetchedAt: Date.now() };
    return { rate: jpy, stale: false };
  } catch {
    return { rate: cache?.usdToJpy ?? fallback, stale: true };
  }
}

/**
 * The "current" USD/JPY rate for a user: their manual rate unless they opted in
 * to fetching it (Settings → "Fetch today's rate"), so by default no request is
 * made to the outside FX provider.
 */
export async function getFxRate(userId: string): Promise<{ rate: number; stale: boolean }> {
  const s = await prisma.settings.findUnique({ where: { userId }, select: { fxLive: true, fxManualRate: true } });
  const manual = s?.fxManualRate && s.fxManualRate > 0 ? s.fxManualRate : FALLBACK_USD_TO_JPY;
  return s?.fxLive ? getUsdToJpy(manual) : { rate: manual, stale: false };
}

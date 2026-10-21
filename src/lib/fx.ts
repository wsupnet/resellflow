/**
 * Live USD/JPY rate for the in-store "good deal" calculator.
 * Cached in memory for an hour so we don't hammer the free provider.
 * Records of what you actually paid use the locked rate stored on each purchase;
 * this is only for "what's this worth right now" shopping math.
 */

interface RateCache {
  usdToJpy: number;
  fetchedAt: number;
}

let cache: RateCache | null = null;
const TTL_MS = 60 * 60 * 1000;
const FALLBACK_USD_TO_JPY = 150; // used only if the provider is unreachable

export async function getUsdToJpy(): Promise<{ rate: number; stale: boolean }> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return { rate: cache.usdToJpy, stale: false };
  }
  const url = process.env.FX_API_URL || "https://open.er-api.com/v6/latest/USD";
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`fx http ${res.status}`);
    const data = await res.json();
    const jpy = data?.rates?.JPY;
    if (typeof jpy !== "number") throw new Error("no JPY rate in response");
    cache = { usdToJpy: jpy, fetchedAt: Date.now() };
    return { rate: jpy, stale: false };
  } catch {
    return { rate: cache?.usdToJpy ?? FALLBACK_USD_TO_JPY, stale: true };
  }
}

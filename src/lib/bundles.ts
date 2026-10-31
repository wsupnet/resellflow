import "server-only";
import { prisma } from "./db";
import { allocateLot, splitBundle, type FinLot } from "./finance";

/**
 * Re-derives the price of every `allocated` line on the user's bundle sales from
 * the sale's bundleTotal, split by each item's acquisition cost. Run after any
 * change that can move an item's cost (lot cost, overrides, items added/removed,
 * other sales in the same lot) so stored line prices — which every page and
 * export reads directly — always match the current costs.
 *
 * Cost here is allocated with bundle-derived prices treated as unknown, so the
 * two never chase each other. Only lines whose price actually changed are written.
 */
export async function rebalanceBundles(userId: string): Promise<number> {
  const bundles = await prisma.sale.findMany({
    where: { userId, bundleTotal: { not: null } },
    include: { lines: true }
  });
  if (bundles.length === 0) return 0;

  const purchases = await prisma.purchase.findMany({
    where: { userId },
    include: { items: { include: { saleLine: true } } }
  });
  const cost = new Map<string, number>();
  for (const p of purchases) {
    const lot: FinLot = {
      costUsd: p.costUsd,
      taxUsd: p.taxUsd,
      items: p.items.map((i) => ({
        id: i.id,
        status: i.status,
        estimatedValue: i.estimatedValue,
        costOverrideUsd: i.costOverrideUsd,
        salePrice: i.saleLine?.salePrice ?? null,
        priceAllocated: i.saleLine?.allocated ?? false
      }))
    };
    for (const [id, c] of allocateLot(lot)) cost.set(id, c);
  }

  const writes = [];
  for (const s of bundles) {
    const usd = splitBundle(
      s.bundleTotal as number,
      s.lines.map((l) => ({ itemId: l.itemId, cost: cost.get(l.itemId) ?? 0, lockedPrice: l.allocated ? null : l.salePrice }))
    );
    // Yen sales keep exact whole-yen shares of the typed yen total.
    const fx = s.fxRate && s.fxRate > 0 ? s.fxRate : null; // USD per JPY
    const jpy =
      s.bundleTotalJpy != null
        ? splitBundle(
            s.bundleTotalJpy,
            s.lines.map((l) => ({
              itemId: l.itemId,
              cost: cost.get(l.itemId) ?? 0,
              lockedPrice: l.allocated ? null : l.priceJpy ?? (fx ? Math.round(l.salePrice / fx) : 0)
            })),
            0
          )
        : null;
    for (const l of s.lines) {
      if (!l.allocated) continue;
      const price = usd.get(l.itemId) ?? 0;
      const priceJpy = jpy ? jpy.get(l.itemId) ?? null : null;
      if (Math.abs(price - l.salePrice) < 0.005 && priceJpy === l.priceJpy) continue;
      writes.push(prisma.saleItem.update({ where: { id: l.id }, data: { salePrice: price, priceJpy } }));
    }
  }
  if (writes.length) await prisma.$transaction(writes);
  return writes.length;
}

/** True when a multi-line sale's prices are all equal to the cent — the mark of
 *  an old even split of one total, which the review screen converts in one go. */
export function looksEvenlySplit(prices: number[]): boolean {
  if (prices.length < 2) return false;
  const cents = prices.map((p) => Math.round(p * 100));
  // An even split of a total leaves at most a 1¢ rounding remainder on one line.
  return Math.max(...cents) - Math.min(...cents) <= 1 && cents.every((c) => c > 0);
}

import { requireUser } from "@/lib/auth";
import { getVariantStats } from "@/lib/queries";
import { prisma } from "@/lib/db";
import { getFxRate } from "@/lib/fx";
import { getViewCurrency } from "@/lib/money";
import DealChecker, { type DealProduct } from "@/components/DealChecker";

export const dynamic = "force-dynamic";

export default async function DealCheckerPage() {
  const user = await requireUser();
  const [variants, fx, currency] = await Promise.all([getVariantStats(user.id), getFxRate(user.id), getViewCurrency(user.id)]);

  // One row per variant (product, or product+condition for tracked categories).
  // Only variants with at least one real sale: unsold stock (even with a manual
  // comp) and write-offs have no sale history to judge a deal against. The one
  // exception: a never-sold version whose FAMILY has sales, so the other
  // versions can stand in as a reference.
  const familiesWithSales = new Set(variants.filter((v) => v.timesSold > 0 && v.familyId).map((v) => v.familyId!));
  const fams = await prisma.family.findMany({ where: { userId: user.id }, select: { id: true, name: true } });
  const famName = new Map(fams.map((f) => [f.id, f.name]));
  const products: DealProduct[] = variants
    .filter((v) => v.timesSold > 0 || (v.familyId && familiesWithSales.has(v.familyId)))
    .map((v) => ({
    familyId: v.familyId,
    familyName: v.familyId ? famName.get(v.familyId) ?? null : null,
    familyLabel: v.familyLabel,
    key: v.key,
    productId: v.productId,
    name: v.name,
    condition: v.condition,
    sku: v.sku,
    compPrice: v.compPrice,
    timesSold: v.timesSold,
    avgBuyPrice: v.avgBuyPrice,
    avgSalePrice: v.avgSalePrice,
    recentAvg: v.recentAvg,
    avgNet: v.avgNet,
    avgDaysToSell: v.avgDaysToSell,
    lastSalePrice: v.lastSalePrice,
    lastSaleDate: v.lastSaleDate
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Deal checker</h1>
        <p className="mt-1 text-sm text-slate-500">
          Convert yen↔USD at today&apos;s rate and sanity-check a buy against what you usually sell the item for.
        </p>
      </div>
      <div className="max-w-xl">
        <DealChecker products={products} rate={fx.rate} defaultCurrency={currency} />
      </div>
    </div>
  );
}

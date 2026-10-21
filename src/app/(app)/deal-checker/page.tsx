import { requireUser } from "@/lib/auth";
import { getVariantStats } from "@/lib/queries";
import { getUsdToJpy } from "@/lib/fx";
import { getViewCurrency } from "@/lib/money";
import DealChecker, { type DealProduct } from "@/components/DealChecker";

export const dynamic = "force-dynamic";

export default async function DealCheckerPage() {
  const user = await requireUser();
  const [variants, fx, currency] = await Promise.all([getVariantStats(user.id), getUsdToJpy(), getViewCurrency(user.id)]);

  // One row per variant (product, or product+condition for tracked categories).
  const products: DealProduct[] = variants.map((v) => ({
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
          Convert yen↔USD on the live rate and sanity-check a buy against what you usually sell the item for.
        </p>
      </div>
      <div className="max-w-xl">
        <DealChecker products={products} rate={fx.rate} defaultCurrency={currency} />
      </div>
    </div>
  );
}

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getFinancials } from "@/lib/queries";
import { looksEvenlySplit } from "@/lib/bundles";
import { convertToBundle, markPricedIndividually } from "@/lib/actions";
import { fmtMoney, shortDate } from "@/lib/format";
import { getMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * One-time review of multi-item sales recorded before bundle sales were tracked.
 * Converting one keeps its total but re-splits it across the items by cost, so a
 * cheap item stops soaking up an even share of an expensive bundle's profit.
 */
export default async function BundleReviewPage() {
  const user = await requireUser();
  const [bundle, m] = await Promise.all([getFinancials(user.id), getMoney(user.id)]);

  const pending = bundle.sales.filter((s) => s.lines.length > 1 && s.bundleTotal == null && !s.bundleReviewed);
  const even = pending.filter((s) => looksEvenlySplit(s.lines.map((l) => l.salePrice)));
  const other = pending.filter((s) => !even.includes(s));

  const SaleCard = ({ s, pick }: { s: (typeof pending)[number]; pick: boolean }) => {
    const total = s.lines.reduce((a, l) => a + l.salePrice, 0);
    return (
      <label className="block rounded-lg border border-slate-100 p-3 hover:bg-slate-50/60">
        <div className="flex items-start gap-3">
          {pick && <input type="checkbox" name="saleId" value={s.id} className="mt-1" />}
          <div className="min-w-0 grow">
            <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
              <span>
                {shortDate(s.soldAt)} · {s.platform.toLowerCase()} · {s.lines.length} items
              </span>
              <span className="font-medium text-slate-700">{fmtMoney(total, m)}</span>
            </div>
            <ul className="mt-1 text-sm text-slate-600">
              {s.lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-3">
                  <span className="truncate">{l.item.title}</span>
                  <span className="whitespace-nowrap text-right">
                    {fmtMoney(l.salePrice, m)}
                    <span className="ml-2 text-xs text-slate-400">cost {fmtMoney(bundle.itemFin.get(l.itemId)?.allocatedCost ?? 0, m)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </label>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/sales" className="text-sm text-brand-600 hover:underline">← Sales</Link>
        <h1 className="mt-1 text-2xl font-bold">Review multi-item sales</h1>
        <p className="mt-1 text-sm text-slate-500">
          When a buyer pays one price for several items, the app now splits that price by what each item cost you — every item shows the
          bundle&apos;s return instead of a guess. Pick which past sales were bundles. Totals don&apos;t change, only how they&apos;re divided.
        </p>
      </div>

      {pending.length === 0 && (
        <div className="card text-center text-sm text-slate-500">All caught up — no multi-item sales left to review.</div>
      )}

      {even.length > 0 && (
        <form action={convertToBundle} className="card space-y-3">
          <div>
            <h2 className="font-semibold">Look like an even split ({even.length})</h2>
            <p className="text-sm text-slate-500">Every item got the same price, so these were almost certainly one total divided evenly.</p>
          </div>
          {even.map((s) => (
            <span key={s.id}>
              <input type="hidden" name="saleId" value={s.id} />
              <SaleCard s={s} pick={false} />
            </span>
          ))}
          <button className="btn-primary">Convert all {even.length} to bundle pricing</button>
        </form>
      )}

      {other.length > 0 && (
        <form className="card space-y-3">
          <div>
            <h2 className="font-semibold">Priced differently ({other.length})</h2>
            <p className="text-sm text-slate-500">
              These items have different prices — you may have priced them one by one, or the old split used values. Tick the ones that were sold
              as one bundle price.
            </p>
          </div>
          {other.map((s) => (
            <SaleCard key={s.id} s={s} pick />
          ))}
          <div className="flex flex-wrap gap-2">
            <button formAction={convertToBundle} className="btn-primary">Convert ticked to bundle pricing</button>
            <button formAction={markPricedIndividually} className="btn-ghost">Ticked were priced one by one</button>
          </div>
        </form>
      )}
    </div>
  );
}

import Link from "next/link";
import type { SaleBreakdown } from "@/lib/queries";
import { shortDate, purchaseDate, fmtMoney, fmtDeduction, type MoneyCtx } from "@/lib/format";
import { Net, Roi } from "@/components/ui";

const PLATFORM: Record<string, string> = { EBAY: "eBay", MERCARI: "Mercari", FACEBOOK: "Facebook", OTHER: "Other" };

/**
 * One sold unit, laid out as the math behind its net and ROI: what it cost you,
 * what it sold for, what came out in fees and expenses, and the result.
 */
export default function SaleBreakdownCard({ s, m }: { s: SaleBreakdown; m: MoneyCtx }) {
  const p = s.purchase;
  const totalCost = s.allocatedCost + s.feeShare + s.expense;
  return (
    <div className={`rounded-lg border border-slate-200 p-3 ${s.counted ? "" : "opacity-50"}`}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <Link href={`/items/${s.itemId}`} className="font-medium text-slate-800 hover:text-brand-700">{s.title}</Link>
          {s.condition && <span className="ml-2 text-xs text-slate-500">{s.condition}</span>}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span>Net <b><Net value={s.net} m={m} /></b></span>
          <span>ROI <b><Roi value={s.roi} /></b></span>
          <span className="text-slate-500">{s.daysToSell == null ? "days: —" : `${s.daysToSell}d to sell`}</span>
        </div>
      </div>
      {!s.counted && (
        <p className="mb-2 text-xs text-slate-500">Sold in a bundle, so it&apos;s left out while Individual sales only is on.</p>
      )}

      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
        {/* Purchase side */}
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Bought</div>
          <div className="text-slate-600">
            {purchaseDate({ purchasedAt: p.date, purchasedAtApprox: p.approx })} ·{" "}
            {p.isLot ? <Link href={`/lots/${p.id}`} className="hover:text-brand-700">lot: {p.title}</Link> : p.source}
          </div>
          {p.shareMethod === "personal" ? (
            <p className="mt-1 text-xs text-slate-500">Personal item: no purchase cost.</p>
          ) : p.isLot ? (
            <ul className="mt-1 space-y-0.5">
              <li className="flex justify-between"><span className="text-slate-500">Lot total ({p.itemCount} items)</span><span>{fmtMoney(p.paid, m)}</span></li>
              <li className="flex justify-between font-medium"><span>This item&apos;s share</span><span>{fmtMoney(s.allocatedCost, m)}</span></li>
              <li className="text-xs text-slate-400">
                {p.shareMethod === "override"
                  ? "Set by hand (cost override)."
                  : p.weightBasis === "sale"
                    ? "The lot's cost is split by what each item sold for, so this one's share follows its sale price."
                    : p.weightBasis === "estimate"
                      ? "The lot's cost is split by what each item sold for. This one has no price of its own (bundle sale), so its estimated value was used."
                      : "The lot's cost is split by what each item sold for. This one has no price of its own (bundle sale) or estimate, so it counts as the lot's average item."}
              </li>
            </ul>
          ) : (
            <ul className="mt-1 space-y-0.5">
              <li className="flex justify-between font-medium"><span>Paid</span><span>{fmtMoney(s.allocatedCost, m)}</span></li>
              {p.shareMethod === "override" && <li className="text-xs text-slate-400">Cost override in use (you paid {fmtMoney(p.paid, m)}).</li>}
            </ul>
          )}
        </div>

        {/* Sale side */}
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Sold</div>
          <div className="text-slate-600">{shortDate(s.sale.date)} · {PLATFORM[s.sale.platform] ?? s.sale.platform}</div>
          <ul className="mt-1 space-y-0.5">
            <li className="flex justify-between font-medium"><span>Sale price</span><span>{fmtMoney(s.sale.price, m)}</span></li>
            {s.sale.bundled && s.sale.bundleTotal != null && (
              <li className="text-xs text-slate-400">
                Its share of a {s.sale.lineCount}-item bundle that sold for {fmtMoney(s.sale.bundleTotal, m)}, split by each item&apos;s cost.
              </li>
            )}
            {!s.sale.bundled && s.sale.lineCount > 1 && (
              <li className="text-xs text-slate-400">One of {s.sale.lineCount} items on this sale; fees are shared by price.</li>
            )}
          </ul>
        </div>

        {/* Fees, expenses, result */}
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Fees &amp; expenses</div>
          <ul className="space-y-0.5">
            {s.fees.length === 0 && s.expenses.length === 0 && <li className="text-slate-400">None</li>}
            {s.fees.map((f) => (
              <li key={f.label} className="flex justify-between"><span className="text-slate-500">{f.label}</span><span className="text-red-600">−{fmtMoney(f.amount, m)}</span></li>
            ))}
            {s.expenses.map((e, i) => {
              const d = fmtDeduction(e.amount, m);
              return (
                <li key={i} className="flex justify-between gap-2">
                  <span className="text-slate-500">{e.label} <span className="text-xs text-slate-400">({e.scope})</span></span>
                  <span className={d.isCredit ? "text-emerald-600" : "text-red-600"}>{d.text}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* The math, in one line */}
      <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
        Net = {fmtMoney(s.sale.price, m)} sale − {fmtMoney(s.allocatedCost, m)} cost − {fmtMoney(s.feeShare, m)} fees
        {s.expense !== 0 && <> {s.expense < 0 ? "+" : "−"} {fmtMoney(Math.abs(s.expense), m)} {s.expense < 0 ? "credits" : "expenses"}</>} = <b>{fmtMoney(s.net, m)}</b>
        {s.roi != null && totalCost > 0 && (
          <> · ROI = {fmtMoney(s.net, m)} ÷ {fmtMoney(totalCost, m)} = <b>{(s.roi * 100).toFixed(1)}%</b></>
        )}
      </p>
    </div>
  );
}

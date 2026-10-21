import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getItemDetail, getFinancials, buildYen } from "@/lib/queries";
import { StatCard, Net, Roi, StatusPill } from "@/components/ui";
import PhotoManager from "@/components/PhotoManager";
import { shortDate, fmtDeduction } from "@/lib/format";
import { getMoney, fmtMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function ItemDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const detail = await getItemDetail(user.id, params.id);
  if (!detail) notFound();

  const { item, lot, fin, sale, fees, expenses, daysToSell, daysInStock, variantSold, variantAvgDaysToSell, tracksCond } = detail;
  const m = await getMoney(user.id);
  // Historical mode: this item's figures at locked rates.
  const iy = m.currency === "JPY" && m.mode === "historical" ? buildYen(await getFinancials(user.id), m.rate).itemFinYen.get(params.id) : null;
  const feeTotal = fees.reduce((a, f) => a + f.amount, 0);
  const expenseTotal = expenses.reduce((a, e) => a + e.amount, 0);
  const gross = fin?.gross ?? 0;
  const cost = fin?.allocatedCost ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/inventory" className="text-sm text-brand-600">← Inventory</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{item.title}</h1>
          <StatusPill status={item.status} />
          {tracksCond && item.condition && <span className="pill bg-slate-100 text-slate-700">{item.condition}</span>}
          {lot.isPersonal && <span className="pill bg-purple-100 text-purple-700">personal</span>}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {item.product?.sku && <span className="font-mono">{item.product.sku} · </span>}
          {lot.kind === "LOT" ? (
            <>from lot <Link href={`/lots/${lot.id}`} className="text-brand-600">{lot.title}</Link></>
          ) : (
            <>single purchase · {lot.source}</>
          )}
          {sale && <> · sold on {sale.platform.toLowerCase()} {shortDate(sale.soldAt)}</>}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Sold for (gross)" value={item.status === "SOLD" ? fmtMoney(gross, m, iy?.gross) : "—"} />
        <StatCard label="Net profit" value={item.status === "SOLD" ? fmtMoney(fin?.net ?? 0, m, iy?.net) : "—"} tone={(fin?.net ?? 0) >= 0 ? "good" : "bad"} />
        <StatCard label="ROI" value={item.status === "SOLD" && fin?.roi != null ? `${(fin.roi * 100).toFixed(1)}%` : "—"} tone={(fin?.roi ?? 0) >= 0 ? "good" : "bad"} />
        <StatCard label="Allocated cost" value={fmtMoney(cost, m, iy?.allocatedCost)} sub={item.costOverrideUsd != null ? "manual override" : lot.kind === "LOT" ? "share of lot" : undefined} />
        {daysToSell != null ? (
          <StatCard label="Days to sell" value={`${daysToSell}d`} sub="purchase → sold" />
        ) : daysInStock != null ? (
          <StatCard label="In stock" value={`${daysInStock}d`} sub="since purchase" />
        ) : null}
      </div>

      {variantSold > 0 && (
        <p className="text-sm text-slate-500">
          You&apos;ve sold {variantSold} of {tracksCond && item.condition ? <>this <b>{item.condition}</b> variant</> : "this product"} before
          {variantAvgDaysToSell != null && <> — averaging <b>{Math.round(variantAvgDaysToSell)} days</b> to sell.</>}
          {variantAvgDaysToSell == null && "."}
        </p>
      )}

      <div className="card">
        <h2 className="mb-3 text-lg font-semibold">Photos</h2>
        <PhotoManager itemId={item.id} photos={item.photos} />
      </div>

      <div className="card">
        <h2 className="mb-3 text-lg font-semibold">Profit breakdown</h2>
        {item.status === "LOST" || item.status === "DAMAGED" ? (
          <p className="text-sm text-slate-500">
            This item was written off as <b>{item.status.toLowerCase()}</b> — its allocated cost of{" "}
            <span className="font-medium text-red-600">{fmtMoney(cost, m)}</span> counts as a realized loss in your reports.
            Set the status back to Unlisted if that was a mistake.
          </p>
        ) : item.status !== "SOLD" ? (
          <p className="text-sm text-slate-500">
            This item hasn&apos;t sold yet. Allocated cost so far is {fmtMoney(cost, m)}; the full breakdown appears once it sells.
          </p>
        ) : (
          <table className="min-w-full">
            <tbody className="text-sm">
              <tr className="border-b border-slate-100">
                <td className="td">Gross sale price</td>
                <td className="td text-right font-medium">{fmtMoney(gross, m)}</td>
              </tr>

              {fees.map((f) => (
                <tr key={f.label} className="border-b border-slate-50">
                  <td className="td pl-6 text-slate-500">− {f.label}</td>
                  <td className="td text-right text-red-600">−{fmtMoney(f.amount, m)}</td>
                </tr>
              ))}
              {fees.length > 0 && (
                <tr className="border-b border-slate-100">
                  <td className="td font-medium">Total selling fees</td>
                  <td className="td text-right font-medium text-red-600">−{fmtMoney(feeTotal, m)}</td>
                </tr>
              )}

              {expenses.map((e, idx) => {
                // A ledger CREDIT (refund/rebate) has a negative amount — it adds to
                // net rather than subtracting, so it's shown as a "+" in green.
                const d = fmtDeduction(e.amount, m);
                return (
                  <tr key={idx} className="border-b border-slate-50">
                    <td className="td pl-6 text-slate-500">
                      {d.isCredit ? "+" : "−"} {e.label} <span className="text-xs text-slate-400">({e.category} · {e.scope})</span>
                    </td>
                    <td className={`td text-right ${d.isCredit ? "text-emerald-600" : "text-red-600"}`}>{d.text}</td>
                  </tr>
                );
              })}
              {expenses.length > 0 && (() => {
                const d = fmtDeduction(expenseTotal, m);
                return (
                  <tr className="border-b border-slate-100">
                    <td className="td font-medium">{d.isCredit ? "Total misc credits" : "Total misc expenses"}</td>
                    <td className={`td text-right font-medium ${d.isCredit ? "text-emerald-600" : "text-red-600"}`}>{d.text}</td>
                  </tr>
                );
              })()}

              <tr className="border-b border-slate-100">
                <td className="td">− Cost of goods {lot.kind === "LOT" ? "(share of lot)" : ""}</td>
                <td className="td text-right text-red-600">−{fmtMoney(cost, m)}</td>
              </tr>
              <tr className="bg-slate-50">
                <td className="td text-base font-semibold">Net profit</td>
                <td className="td text-right text-base font-bold">
                  <Net value={fin?.net ?? 0} m={m} />
                </td>
              </tr>
            </tbody>
          </table>
        )}
        {sale && sale.lines.length > 1 && (
          <p className="mt-3 text-xs text-slate-400">
            This was sold in a {sale.lines.length}-item sale, so its fees and any sale-level expenses are split by its share of that sale&apos;s total.
          </p>
        )}
      </div>

      {item.notes && <div className="card text-sm text-slate-600">{item.notes}</div>}
    </div>
  );
}

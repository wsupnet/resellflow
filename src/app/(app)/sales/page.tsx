import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getFinancials } from "@/lib/queries";
import { tracksCondition } from "@/lib/catalog";
import { getUsdToJpy } from "@/lib/fx";
import { deleteSale, updateSale } from "@/lib/actions";
import ConfirmButton from "@/components/ConfirmButton";
import { sortRows, dirOf } from "@/lib/sort";
import SaleForm, { type SellableItem, type FeeSettings } from "@/components/SaleForm";
import MobileCollapse from "@/components/MobileCollapse";
import { FilterSelect, Pagination } from "@/components/TableControls";
import { resolvePer, paginate } from "@/lib/paginate";
import { SectionTitle, Net, Roi } from "@/components/ui";
import { fmtMoney, shortDate, fmtDeduction } from "@/lib/format";
import { getMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function SalesPage({
  searchParams
}: {
  searchParams: { platform?: string; sort?: string; dir?: string; page?: string; per?: string };
}) {
  const user = await requireUser();
  const [bundle, fx, m] = await Promise.all([getFinancials(user.id), getUsdToJpy(), getMoney(user.id)]);

  let settings = await prisma.settings.findUnique({ where: { userId: user.id } });
  if (!settings) settings = await prisma.settings.create({ data: { userId: user.id } });

  const fees: FeeSettings = {
    ebayFeePct: settings.ebayFeePct,
    ebayFlatFee: settings.ebayFlatFee,
    mercariFeePct: settings.mercariFeePct,
    adFeePct: settings.adFeePct,
    defaultShipping: settings.defaultShipping
  };

  // Best-known value per product, from its own sales history — used as a fallback
  // weight when splitting a lot's total sale price and no comp/estimate is set.
  const prodOfItem = new Map<string, string>();
  for (const p of bundle.purchases) for (const i of p.items) if (i.productId) prodOfItem.set(i.id, i.productId);
  const soldAgg = new Map<string, { sum: number; n: number }>();
  for (const s of bundle.sales)
    for (const l of s.lines) {
      const pid = prodOfItem.get(l.itemId);
      if (!pid) continue;
      const a = soldAgg.get(pid) ?? { sum: 0, n: 0 };
      a.sum += l.salePrice;
      a.n++;
      soldAgg.set(pid, a);
    }
  const histAvgOf = (pid: string | null) => {
    if (!pid) return null;
    const a = soldAgg.get(pid);
    return a && a.n ? a.sum / a.n : null;
  };

  const sellable: SellableItem[] = [];
  for (const p of bundle.purchases) {
    for (const i of p.items) {
      // Only items actually in stock — sold and written-off (lost/damaged) are out.
      if (i.status === "UNLISTED" || i.status === "LISTED") {
        sellable.push({
          id: i.id,
          title: i.title,
          lotTitle: p.title,
          isLot: p.kind === "LOT",
          estimatedValue: i.estimatedValue,
          // Only surface condition where the category tracks it (games/movies/etc.).
          condition: tracksCondition(i.product?.category) ? i.condition : null,
          // Cascade for the total-price split: comp → estimate → own sale history → (even fallback in the form).
          suggestedValue: i.product?.compPrice ?? i.estimatedValue ?? histAvgOf(i.productId)
        });
      }
    }
  }

  // Filter + sort the recorded sales.
  const platformFilter = (searchParams.platform ?? "").toUpperCase();
  const saleRows = bundle.sales
    .filter((s) => !platformFilter || s.platform === platformFilter)
    .map((s) => {
      const fins = s.lines.map((l) => bundle.itemFin.get(l.itemId));
      const gross = s.lines.reduce((a, l) => a + l.salePrice, 0);
      const cogs = fins.reduce((a, f) => a + (f?.allocatedCost ?? 0), 0);
      const fees = fins.reduce((a, f) => a + (f?.feeShare ?? 0), 0);
      const expense = fins.reduce((a, f) => a + (f?.expense ?? 0), 0);
      const net = fins.reduce((a, f) => a + (f?.net ?? 0), 0);
      // ROI for this sale = net / money in (acquisition cost + fees + attributed expenses).
      const basis = cogs + fees + expense;
      const roi = basis > 0 ? net / basis : null;
      return { sale: s, gross, cogs, fees, expense, net, roi };
    });
  const sort = searchParams.sort ?? "date";
  const dir = dirOf(searchParams.dir ?? "desc");
  const getters: Record<string, (r: (typeof saleRows)[number]) => string | number | Date | null> = {
    date: (r) => r.sale.soldAt,
    gross: (r) => r.gross,
    net: (r) => r.net
  };
  const sortedSales = sortRows(saleRows, getters[sort] ?? getters.date, dir);
  const per = resolvePer(searchParams.per, cookies().get("pageSize")?.value);
  const pg = paginate(sortedSales, searchParams.page, per);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Sales</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
        <MobileCollapse label="+ Record a sale">
          <div className="card">
            <SectionTitle>Record a sale</SectionTitle>
            <SaleForm items={sellable} fees={fees} rate={fx.rate} defaultCurrency={m.currency} />
          </div>
        </MobileCollapse>

        <div className="card">
          <SectionTitle
            action={
              <div className="flex gap-2">
                <FilterSelect param="platform" label="All platforms" options={[
                  { value: "EBAY", label: "eBay" },
                  { value: "MERCARI", label: "Mercari" },
                  { value: "FACEBOOK", label: "Facebook" },
                  { value: "OTHER", label: "Other" }
                ]} />
                <FilterSelect param="sort" label="By date" options={[
                  { value: "date", label: "By date" },
                  { value: "gross", label: "By gross" },
                  { value: "net", label: "By net" }
                ]} />
              </div>
            }
          >
            Recorded sales
          </SectionTitle>
          {sortedSales.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No sales match.</p>
          ) : (
            <div className="space-y-2">
              {pg.rows.map(({ sale: s, gross, cogs, fees, expense, net, roi }) => {
                return (
                  /* Collapsed = one scannable line (date · platform · what sold · net/ROI);
                     everything else lives behind the expand. */
                  <details key={s.id} className="group rounded-lg border border-slate-100">
                    <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-3 rounded-lg p-3 hover:bg-slate-50/60 [&::-webkit-details-marker]:hidden">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span className="inline-block transition-transform group-open:rotate-90">▸</span>
                          <span className="whitespace-nowrap">{shortDate(s.soldAt)}</span>
                          <span className="pill bg-slate-100 text-slate-600">{s.platform.toLowerCase()}</span>
                        </div>
                        <div className="mt-0.5 truncate pl-4 text-sm font-medium text-slate-800">
                          {s.lines[0]?.item.title ?? "—"}
                          {s.lines.length > 1 && <span className="font-normal text-slate-400"> (+{s.lines.length - 1} more)</span>}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm">Net <Net value={net} m={m} /></div>
                        {roi != null && <div className="text-xs text-slate-400">ROI <Roi value={roi} /></div>}
                      </div>
                    </summary>

                    <div className="border-t border-slate-100 px-3 pb-3">
                    <div className="flex justify-end pt-2">
                      <form action={deleteSale}>
                        <input type="hidden" name="id" value={s.id} />
                        <ConfirmButton message="Undo this sale? The item(s) go back to in-stock and the sale record is removed." className="text-xs text-red-500 hover:underline">
                          Undo sale
                        </ConfirmButton>
                      </form>
                    </div>
                    <ul className="mt-1 text-sm text-slate-600">
                      {s.lines.map((l) => {
                        const cost = bundle.itemFin.get(l.itemId)?.allocatedCost ?? 0;
                        return (
                          <li key={l.id} className="flex justify-between gap-3 py-0.5">
                            <span>
                              {l.item.title}
                              {l.item.condition && (
                                <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{l.item.condition}</span>
                              )}
                            </span>
                            <span className="whitespace-nowrap text-right">
                              {fmtMoney(l.salePrice, m)}
                              {/* Exact yen as entered, when the sale was recorded in ¥. */}
                              {l.priceJpy != null && <span className="ml-1 text-xs text-slate-400">¥{l.priceJpy.toLocaleString()}</span>}
                              {/* Acquisition cost (a lot's cost split across its items) so the COGS below is traceable. */}
                              <span className="block text-xs text-slate-400">cost {fmtMoney(cost, m)}</span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {/* Cost → net waterfall so the net has context (what it cost to buy + fees). */}
                    <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-sm">
                      <div className="flex justify-between text-slate-500">
                        <span>Gross</span>
                        <span>{fmtMoney(gross, m)}</span>
                      </div>
                      <div className="flex justify-between text-slate-500">
                        <span>− Cost of goods</span>
                        <span className="text-red-600">−{fmtMoney(cogs, m)}</span>
                      </div>
                      <div className="flex justify-between text-slate-500">
                        <span>− Fees</span>
                        <span className="text-red-600">−{fmtMoney(fees, m)}</span>
                      </div>
                      {expense !== 0 && (() => {
                        const d = fmtDeduction(expense, m);
                        return (
                          <div className="flex justify-between text-slate-500">
                            <span>{d.isCredit ? "+ Credit" : "− Expenses"}</span>
                            <span className={d.isCredit ? "text-emerald-600" : "text-red-600"}>{d.text}</span>
                          </div>
                        );
                      })()}
                      <div className="flex items-center justify-between border-t border-slate-100 pt-1">
                        <span className="font-medium">Net</span>
                        <span className="flex items-center gap-2">
                          {roi != null && <span className="text-xs text-slate-400">ROI <Roi value={roi} /></span>}
                          <Net value={net} m={m} />
                        </span>
                      </div>
                    </div>

                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-brand-600">Edit sale (fees, date, prices)</summary>
                      <form action={updateSale} className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2">
                        <input type="hidden" name="id" value={s.id} />
                        <div>
                          <label className="label text-[11px]">Shipping ($)</label>
                          <input name="shippingFee" inputMode="decimal" defaultValue={s.shippingFee || ""} placeholder="0" className="input py-1.5 text-sm" />
                        </div>
                        <div>
                          <label className="label text-[11px]">Platform</label>
                          <select name="platform" defaultValue={s.platform} className="input py-1.5 text-sm">
                            <option value="EBAY">eBay</option>
                            <option value="MERCARI">Mercari</option>
                            <option value="FACEBOOK">Facebook</option>
                            <option value="OTHER">Other</option>
                          </select>
                        </div>
                        <div>
                          <label className="label text-[11px]">eBay fee ($)</label>
                          <input name="ebayFee" inputMode="decimal" defaultValue={s.ebayFee || ""} placeholder="0" className="input py-1.5 text-sm" />
                        </div>
                        <div>
                          <label className="label text-[11px]">Mercari fee ($)</label>
                          <input name="mercariFee" inputMode="decimal" defaultValue={s.mercariFee || ""} placeholder="0" className="input py-1.5 text-sm" />
                        </div>
                        <div>
                          <label className="label text-[11px]">Ad fee ($)</label>
                          <input name="adFee" inputMode="decimal" defaultValue={s.adFee || ""} placeholder="0" className="input py-1.5 text-sm" />
                        </div>
                        <div>
                          <label className="label text-[11px]">Sold date</label>
                          <input name="soldAt" type="date" defaultValue={new Date(s.soldAt).toISOString().slice(0, 10)} className="input py-1.5 text-sm" />
                        </div>
                        {s.lines.length > 0 && (
                          <div className="col-span-2 space-y-1 border-t border-slate-100 pt-2">
                            <div className="text-[11px] font-medium text-slate-500">Sold-for price per item</div>
                            {s.lines.map((l) => (
                              <div key={l.id} className="flex items-center gap-2">
                                <span className="grow truncate text-xs text-slate-600">{l.item.title}</span>
                                <input name={`price_${l.itemId}`} inputMode="decimal" defaultValue={l.salePrice} className="input w-24 py-1 text-sm" />
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="col-span-2">
                          <label className="label text-[11px]">Notes</label>
                          <input name="notes" defaultValue={s.notes ?? ""} className="input py-1.5 text-sm" />
                        </div>
                        <div className="col-span-2">
                          <button className="btn-primary py-1.5 text-sm">Save changes</button>
                        </div>
                      </form>
                    </details>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
          {sortedSales.length > 0 && <Pagination {...pg} per={per} />}
        </div>
      </div>
    </div>
  );
}

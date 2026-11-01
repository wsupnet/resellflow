import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getFinancials, yenView } from "@/lib/queries";
import { tracksCondition } from "@/lib/catalog";
import { getFxRate } from "@/lib/fx";
import Link from "next/link";
import { deleteSale, updateSale, convertToBundle, markPricedIndividually } from "@/lib/actions";
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

export default async function SalesPage(
  props: {
    searchParams: Promise<{ platform?: string; sort?: string; dir?: string; page?: string; per?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const [bundle, fx, m] = await Promise.all([getFinancials(user.id), getFxRate(user.id), getMoney(user.id)]);
  const yv = yenView(bundle, m); // Historical-mode yen, else null

  let settings = await prisma.settings.findUnique({ where: { userId: user.id } });
  if (!settings) settings = await prisma.settings.create({ data: { userId: user.id } });

  const fees: FeeSettings = {
    ebayFeePct: settings.ebayFeePct,
    ebayFlatFee: settings.ebayFlatFee,
    mercariFeePct: settings.mercariFeePct,
    adFeePct: settings.adFeePct,
    defaultShipping: settings.defaultShipping
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
          // Weight for splitting a one-total bundle price.
          cost: bundle.itemFin.get(i.id)?.allocatedCost ?? 0
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
      // Same sums in yen at locked rates (Historical mode only).
      const finsY = yv ? s.lines.map((l) => yv.fin(l.itemId)) : null;
      const sumY = (k: "gross" | "allocatedCost" | "feeShare" | "expense" | "net") => finsY?.reduce((a, f) => a + (f?.[k] ?? 0), 0);
      const yen = finsY ? { gross: sumY("gross"), cogs: sumY("allocatedCost"), fees: sumY("feeShare"), expense: sumY("expense"), net: sumY("net") } : undefined;
      return { sale: s, gross, cogs, fees, expense, net, roi, yen };
    });
  const sort = searchParams.sort ?? "date";
  const dir = dirOf(searchParams.dir ?? "desc");
  const getters: Record<string, (r: (typeof saleRows)[number]) => string | number | Date | null> = {
    date: (r) => r.sale.soldAt,
    gross: (r) => r.gross,
    net: (r) => r.net
  };
  const sortedSales = sortRows(saleRows, getters[sort] ?? getters.date, dir);
  const per = resolvePer(searchParams.per, (await cookies()).get("pageSize")?.value);
  const pg = paginate(sortedSales, searchParams.page, per);
  // Multi-item sales recorded before bundles were tracked, still awaiting review.
  const toReview = bundle.sales.filter((s) => s.lines.length > 1 && s.bundleTotal == null && !s.bundleReviewed).length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Sales</h1>

      {toReview > 0 && (
        <Link href="/sales/bundles" className="block rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 hover:bg-amber-100">
          <span className="font-medium">{toReview} multi-item sale{toReview === 1 ? "" : "s"} to review</span> — tell the app which were sold as one bundle price so
          their profit is split fairly. <span className="font-medium underline">Review →</span>
        </Link>
      )}

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
              {pg.rows.map(({ sale: s, gross, cogs, fees, expense, net, roi, yen }) => {
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
                          {s.bundleTotal != null && <span className="pill bg-purple-100 text-purple-700">bundle</span>}
                        </div>
                        <div className="mt-0.5 truncate pl-4 text-sm font-medium text-slate-800">
                          {s.lines[0]?.item.title ?? "—"}
                          {s.lines.length > 1 && <span className="font-normal text-slate-400"> (+{s.lines.length - 1} more)</span>}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm">Net <Net value={net} m={m} yen={yen?.net} /></div>
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
                        const ly = yv?.fin(l.itemId);
                        return (
                          <li key={l.id} className="flex justify-between gap-3 py-0.5">
                            <span>
                              {l.item.title}
                              {l.item.condition && (
                                <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{l.item.condition}</span>
                              )}
                            </span>
                            <span className="whitespace-nowrap text-right">
                              {fmtMoney(l.salePrice, m, ly?.gross)}
                              {/* Exact yen as entered, when the sale was recorded in ¥. */}
                              {l.priceJpy != null && !m.single && <span className="ml-1 text-xs text-slate-400">¥{l.priceJpy.toLocaleString()}</span>}
                              {/* A bundle's derived share vs. a price typed over it. */}
                              {s.bundleTotal != null && <span className="block text-xs text-purple-700">{l.allocated ? "share of bundle" : "price set"}</span>}
                              {/* Acquisition cost (a lot's cost split across its items) so the COGS below is traceable. */}
                              <span className="block text-xs text-slate-400">cost {fmtMoney(cost, m, ly?.allocatedCost)}</span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {/* Cost → net waterfall so the net has context (what it cost to buy + fees). */}
                    <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-sm">
                      <div className="flex justify-between text-slate-500">
                        <span>Gross</span>
                        <span>{fmtMoney(gross, m, yen?.gross)}</span>
                      </div>
                      <div className="flex justify-between text-slate-500">
                        <span>− Cost of goods</span>
                        <span className="text-red-600">−{fmtMoney(cogs, m, yen?.cogs)}</span>
                      </div>
                      <div className="flex justify-between text-slate-500">
                        <span>− Fees</span>
                        <span className="text-red-600">−{fmtMoney(fees, m, yen?.fees)}</span>
                      </div>
                      {expense !== 0 && (() => {
                        const d = fmtDeduction(expense, m, yen?.expense);
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
                          <Net value={net} m={m} yen={yen?.net} />
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
                        {s.bundleTotal != null && (
                          <div className="col-span-2 border-t border-slate-100 pt-2">
                            <label className="label text-[11px]">Bundle total ($)</label>
                            <input name="bundleTotal" inputMode="decimal" defaultValue={s.bundleTotal} className="input py-1.5 text-sm" />
                            <label className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                              <input type="checkbox" name="resplit" /> Re-split every line by cost (clears prices typed below)
                            </label>
                          </div>
                        )}
                        {s.lines.length > 0 && (
                          <div className="col-span-2 space-y-1 border-t border-slate-100 pt-2">
                            <div className="text-[11px] font-medium text-slate-500">
                              Sold-for price per item{s.bundleTotal != null && " — changing one locks it; the rest of the total re-splits"}
                            </div>
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
                      {s.lines.length > 1 && (
                        <form action={s.bundleTotal != null ? markPricedIndividually : convertToBundle} className="mt-2">
                          <input type="hidden" name="saleId" value={s.id} />
                          <button className="text-xs text-brand-600 hover:underline">
                            {s.bundleTotal != null ? "Not a bundle — keep these prices as typed" : "Sold as one bundle price — split by cost"}
                          </button>
                        </form>
                      )}
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

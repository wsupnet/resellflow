import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getFinancials, listLocations, buildYen } from "@/lib/queries";
import { allocateLot, rollupLot, type FinLot } from "@/lib/finance";
import { addItemToLot, deletePurchase, dismissProductMatch, linkItemToProduct, updateLot } from "@/lib/actions";
import { editDistance, similarity } from "@/lib/normalize";
import { getMoney, fmtMoney } from "@/lib/money";
import ConfirmButton from "@/components/ConfirmButton";
import { StatCard, Net, Roi, StatusPill } from "@/components/ui";
import { jpy, purchaseDate, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LotDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await requireUser();
  const purchase = await prisma.purchase.findFirst({
    where: { id: params.id, userId: user.id },
    include: { location: true, items: { include: { saleLine: { include: { sale: true } } }, orderBy: { createdAt: "asc" } } }
  });
  if (!purchase) notFound();

  const [bundle, locations, m] = await Promise.all([getFinancials(user.id), listLocations(user.id), getMoney(user.id)]);

  const finLot: FinLot = {
    costUsd: purchase.costUsd,
    taxUsd: purchase.taxUsd,
    items: purchase.items.map((i) => ({
      id: i.id,
      status: i.status,
      estimatedValue: i.estimatedValue,
      costOverrideUsd: i.costOverrideUsd,
      salePrice: i.saleLine?.salePrice ?? null,
      priceAllocated: i.saleLine?.allocated ?? false
    }))
  };
  const alloc = allocateLot(finLot);
  const roll = rollupLot(finLot, bundle.itemFin);
  // Historical mode: roll the lot up in yen at locked rates.
  const yen = m.currency === "JPY" && m.mode === "historical" ? buildYen(bundle, m.rate) : null;
  const rollY = yen ? rollupLot(yen.lotsYenById.get(purchase.id)!, yen.itemFinYen) : null;

  // Barcode near-duplicate detection: flag a lot item whose product's barcode is
  // one digit off another product's barcode (a likely past mis-scan), and offer
  // to link them. Product/SKU info comes from the financials bundle.
  const productsWithSku: { productId: string; name: string; sku: string }[] = [];
  const seenProd = new Set<string>();
  const itemProduct = new Map<string, { productId: string | null; sku: string | null }>();
  for (const p of bundle.purchases)
    for (const i of p.items) {
      itemProduct.set(i.id, { productId: i.productId ?? null, sku: i.product?.sku ?? null });
      if (i.product?.sku && i.productId && !seenProd.has(i.productId)) {
        seenProd.add(i.productId);
        productsWithSku.push({ productId: i.productId, name: i.product.name, sku: i.product.sku });
      }
    }
  const nearProductFor = (itemId: string) => {
    const me = itemProduct.get(itemId);
    if (!me?.sku || !me.productId) return null;
    for (const cand of productsWithSku) {
      if (cand.productId === me.productId) continue;
      if (editDistance(cand.sku, me.sku, 1) === 1) return cand;
    }
    return null;
  };

  // Name-based suggestion, only for items WITHOUT a barcode (barcoded items rely
  // on the barcode check above — names mislead for legit variants like Book+CD
  // vs CD). Strong matches were already merged when the item was added, so this
  // surfaces the middling ones; categories must agree, and pairs the user
  // dismissed ("Not the same") stay quiet.
  const NAME_SUGGEST_MIN = 0.5;
  const products = new Map<string, { productId: string; name: string; category: string | null; sku: string | null; notSameAs: string[] }>();
  for (const p of bundle.purchases)
    for (const i of p.items)
      if (i.product && !products.has(i.product.id))
        products.set(i.product.id, { productId: i.product.id, name: i.product.name, category: i.product.category, sku: i.product.sku, notSameAs: i.product.notSameAs });
  const nameMatchFor = (itemId: string) => {
    const me = itemProduct.get(itemId);
    const mine = me?.productId ? products.get(me.productId) : null;
    if (!mine || mine.sku) return null;
    let best: { productId: string; name: string; sku: string | null } | null = null;
    let bestScore = NAME_SUGGEST_MIN;
    for (const cand of products.values()) {
      if (cand.productId === mine.productId || mine.notSameAs.includes(cand.productId)) continue;
      if (mine.category && cand.category && mine.category !== cand.category) continue;
      const s = similarity(mine.name, cand.name);
      if (s >= bestScore) {
        bestScore = s;
        best = cand;
      }
    }
    return best ? { ...best, productOf: mine.productId } : null;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/lots" className="text-sm text-brand-600">← All lots</Link>
          <h1 className="text-2xl font-bold">{purchase.title}</h1>
          <p className="text-sm text-slate-500">
            {purchase.kind === "LOT" ? "Lot" : "Single"} · {purchase.source} · {purchaseDate(purchase)}
            {purchase.location && <> · 📍 {purchase.location.name}</>}
          </p>
        </div>
        <form action={deletePurchase}>
          <input type="hidden" name="id" value={purchase.id} />
          <ConfirmButton
            message={`Delete “${purchase.title}” and all ${purchase.items.length} of its items? This can't be undone.`}
            className="btn-danger"
          >
            Delete purchase
          </ConfirmButton>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Lot cost" value={fmtMoney(roll.cost, m, rollY?.cost)} sub={purchase.costJpy && !m.single ? jpy(purchase.costJpy) : undefined} />
        <StatCard label="Gross (from its items)" value={fmtMoney(roll.gross, m, rollY?.gross)} sub={`fees ${fmtMoney(roll.fees, m, rollY?.fees)}${roll.expense ? ` · exp ${fmtMoney(roll.expense, m, rollY?.expense)}` : ""}`} />
        <StatCard label="Lot net" value={fmtMoney(roll.net, m, rollY?.net)} tone={roll.net >= 0 ? "good" : "bad"} />
        <StatCard label="Lot ROI" value={roll.roi == null ? "—" : `${(roll.roi * 100).toFixed(1)}%`} tone={(roll.roi ?? 0) >= 0 ? "good" : "bad"} sub={`${roll.soldCount}/${roll.itemCount} sold`} />
      </div>

      <div className="card">
        <details>
          <summary className="cursor-pointer text-sm font-medium text-brand-600">Edit lot details</summary>
          <form action={updateLot} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={purchase.id} />
            <div className="sm:col-span-2">
              <label className="label">Lot name</label>
              <input name="title" defaultValue={purchase.title} className="input" />
            </div>
            <div>
              <label className="label">Location <span className="font-normal text-slate-400">(applies to all its items)</span></label>
              <input name="location" list="lot-edit-locs" defaultValue={purchase.location?.name ?? ""} autoComplete="off" className="input" placeholder="pick or type — blank clears" />
              <datalist id="lot-edit-locs">
                {locations.map((l) => <option key={l.id} value={l.name} />)}
              </datalist>
            </div>
            <div>
              <label className="label">Source</label>
              <input name="source" defaultValue={purchase.source} className="input" />
            </div>
            <div>
              <label className="label">Purchased</label>
              <input name="purchasedAt" type="date" defaultValue={new Date(purchase.purchasedAt).toISOString().slice(0, 10)} className="input" />
              <label className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                <input type="checkbox" name="purchasedAtApprox" defaultChecked={purchase.purchasedAtApprox} /> Approximate (best guess)
              </label>
            </div>
            <div>
              <label className="label">Lot cost ($)</label>
              <input name="costUsd" inputMode="decimal" defaultValue={purchase.costUsd || ""} className="input" placeholder="0" />
            </div>
            <div className={m.single && m.currency === "USD" ? "hidden" : ""}>
              <label className="label">Yen cost (¥)</label>
              <input name="costJpy" inputMode="decimal" defaultValue={purchase.costJpy ?? ""} className="input" placeholder="optional" />
            </div>
            <div>
              <label className="label">Tax ($)</label>
              <input name="taxUsd" inputMode="decimal" defaultValue={purchase.taxUsd || ""} className="input" placeholder="0" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Notes</label>
              <input name="notes" defaultValue={purchase.notes ?? ""} className="input" />
            </div>
            <div className="sm:col-span-2">
              <button className="btn-primary">Save lot details</button>
            </div>
          </form>
        </details>
      </div>

      <div className="card">
        <h2 className="mb-3 text-lg font-semibold">Items in this lot</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full rtable">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th">Item</th>
                <th className="th">Status</th>
                <th className="th">Allocated cost</th>
                <th className="th">Sold for</th>
                <th className="th">Sold on</th>
                <th className="th">Net</th>
                <th className="th">ROI</th>
              </tr>
            </thead>
            <tbody>
              {purchase.items.map((i) => {
                const fin = bundle.itemFin.get(i.id);
                const soldElsewhere = i.saleLine?.sale;
                return (
                  <tr key={i.id} className="border-b border-slate-50">
                    <td className="td cell-main font-medium" data-label="">
                      <Link href={`/items/${i.id}`} className="text-slate-800 hover:text-brand-700">{i.title}</Link>
                      {(() => {
                        const near = nearProductFor(i.id);
                        if (!near) return null;
                        return (
                          <form action={linkItemToProduct} className="mt-1 rounded-lg border border-amber-200 bg-amber-50 p-1.5 text-xs font-normal text-amber-800">
                            <input type="hidden" name="itemId" value={i.id} />
                            <input type="hidden" name="productId" value={near.productId} />
                            Barcode 1 digit off <b>{near.name}</b> (<span className="font-mono">{near.sku}</span>) — likely a mis-scan.
                            <button className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800 hover:bg-amber-200">Link them</button>
                          </form>
                        );
                      })()}
                      {(() => {
                        const match = nameMatchFor(i.id);
                        if (!match) return null;
                        return (
                          <form action={linkItemToProduct} className="mt-1 rounded-lg border border-slate-200 bg-slate-50 p-1.5 text-xs font-normal text-slate-600">
                            <input type="hidden" name="itemId" value={i.id} />
                            <input type="hidden" name="productId" value={match.productId} />
                            <input type="hidden" name="pairA" value={match.productOf} />
                            <input type="hidden" name="pairB" value={match.productId} />
                            Same as <b>{match.name}</b>{match.sku && <> (<span className="font-mono">{match.sku}</span>)</>}? No barcode on this one to check.
                            <button className="ml-1 rounded bg-white px-1.5 py-0.5 font-medium text-brand-700 ring-1 ring-slate-200 hover:bg-brand-50">Link them</button>
                            <button formAction={dismissProductMatch} className="ml-1 rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100">Not the same</button>
                          </form>
                        );
                      })()}
                    </td>
                    <td className="td" data-label="Status"><StatusPill status={i.status} /></td>
                    <td className="td" data-label="Allocated cost">
                      {fmtMoney(alloc.get(i.id) ?? 0, m, yen?.itemFinYen.get(i.id)?.allocatedCost)}
                      {i.costOverrideUsd != null && <span className="ml-1 text-xs text-amber-600">override</span>}
                    </td>
                    <td className="td" data-label="Sold for">{i.saleLine ? fmtMoney(i.saleLine.salePrice, m, yen?.itemFinYen.get(i.id)?.gross) : "—"}</td>
                    <td className="td text-xs text-slate-500" data-label="Sold on">
                      {soldElsewhere ? `${soldElsewhere.platform.toLowerCase()} · ${shortDate(soldElsewhere.soldAt)}` : "—"}
                    </td>
                    <td className="td" data-label="Net"><Net value={i.status === "SOLD" || i.status === "LOST" || i.status === "DAMAGED" ? fin?.net ?? null : null} m={m} yen={yen?.itemFinYen.get(i.id)?.net} /></td>
                    <td className="td" data-label="ROI"><Roi value={i.status === "SOLD" ? fin?.roi ?? null : null} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <form action={addItemToLot} className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
          <input type="hidden" name="purchaseId" value={purchase.id} />
          <div className="grow">
            <label className="label">Add an item to this lot</label>
            <input name="title" required className="input" placeholder="item name" />
          </div>
          <div className="w-32">
            <label className="label">Est. value ($)</label>
            <input name="estimatedValue" inputMode="decimal" className="input" />
          </div>
          <button className="btn-ghost">Add</button>
        </form>
      </div>

      {purchase.notes && <div className="card text-sm text-slate-600">{purchase.notes}</div>}
    </div>
  );
}

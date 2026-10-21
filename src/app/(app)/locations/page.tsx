import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getFinancials, listLocations } from "@/lib/queries";
import { createLocation, renameLocation, deleteLocation } from "@/lib/actions";
import ConfirmButton from "@/components/ConfirmButton";
import { SectionTitle, Net, Roi } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { getMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const user = await requireUser();
  const [locations, bundle, m] = await Promise.all([listLocations(user.id), getFinancials(user.id), getMoney(user.id)]);

  // Per-location all-time stats from items sourced there (realized on sold items).
  const agg = new Map<string, { items: number; sold: number; gross: number; net: number; spend: number }>();
  let untaggedItems = 0;
  for (const p of bundle.purchases) {
    if (!p.locationId) {
      // Personal belongings have no sourcing location — don't count them as untagged.
      if (!p.isPersonal) untaggedItems += p.items.length;
      continue;
    }
    const a = agg.get(p.locationId) ?? { items: 0, sold: 0, gross: 0, net: 0, spend: 0 };
    for (const i of p.items) {
      a.items++;
      const f = bundle.itemFin.get(i.id);
      if (f?.sold) {
        a.sold++;
        a.gross += f.gross;
        a.net += f.net;
        a.spend += f.allocatedCost + f.feeShare + f.expense;
      }
    }
    agg.set(p.locationId, a);
  }

  const rows = locations
    .map((l) => {
      const a = agg.get(l.id) ?? { items: 0, sold: 0, gross: 0, net: 0, spend: 0 };
      return { ...l, ...a, roi: a.spend > 0 ? a.net / a.spend : null, avgNet: a.sold ? a.net / a.sold : null };
    })
    .sort((x, y) => y.net - x.net);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Locations</h1>
        <p className="mt-1 text-sm text-slate-500">
          Specific places you source from. Tag purchases with a location to see which spots consistently make you money.
          {untaggedItems > 0 && (
            <>
              {" "}
              <Link href="/inventory?view=items&missing=location" className="font-medium text-amber-700 underline decoration-amber-300 hover:text-amber-800">
                {untaggedItems} item{untaggedItems === 1 ? "" : "s"} aren&apos;t tagged yet →
              </Link>
            </>
          )}
        </p>
      </div>

      <div className="card">
        <SectionTitle>Add a location</SectionTitle>
        <form action={createLocation} className="flex flex-wrap items-end gap-2">
          <div className="grow">
            <label className="label">Name</label>
            <input name="name" required className="input" placeholder="e.g. Book Off Downtown" />
          </div>
          <div className="w-40">
            <label className="label">Type <span className="font-normal text-slate-400">(optional)</span></label>
            <input name="kind" className="input" placeholder="Book Off, Estate…" />
          </div>
          <button className="btn-primary">Add</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="card text-center text-sm text-slate-500">No locations yet. Add one above, then pick it when adding inventory.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full rtable">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th">Location</th>
                <th className="th text-right">Items</th>
                <th className="th text-right">Sold</th>
                <th className="th text-right">Gross</th>
                <th className="th text-right">Net</th>
                <th className="th text-right">ROI</th>
                <th className="th text-right">Avg net / sale</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-b border-slate-50">
                  <td className="td cell-main" data-label="">
                    <span className="font-medium text-slate-800">{l.name}</span>
                    {l.kind && <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{l.kind}</span>}
                  </td>
                  <td className="td text-right text-slate-500" data-label="Items">{l.items}</td>
                  <td className="td text-right text-slate-500" data-label="Sold">{l.sold}</td>
                  <td className="td text-right" data-label="Gross">{fmtMoney(l.gross, m)}</td>
                  <td className="td text-right" data-label="Net"><Net value={l.sold ? l.net : null} m={m} /></td>
                  <td className="td text-right" data-label="ROI"><Roi value={l.roi} /></td>
                  <td className="td text-right" data-label="Avg net / sale">{fmtMoney(l.avgNet, m)}</td>
                  <td className="td cell-action text-right" data-label="">
                    <details>
                      <summary className="cursor-pointer text-xs text-brand-600">Edit</summary>
                      <div className="mt-2 space-y-2">
                        <form action={renameLocation} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="id" value={l.id} />
                          <div className="grow">
                            <label className="label text-[11px]">Name</label>
                            <input name="name" defaultValue={l.name} className="input py-1.5 text-sm" />
                          </div>
                          <div className="w-32">
                            <label className="label text-[11px]">Type</label>
                            <input name="kind" defaultValue={l.kind ?? ""} className="input py-1.5 text-sm" />
                          </div>
                          <button className="btn-ghost py-1.5 text-sm">Save</button>
                        </form>
                        <form action={deleteLocation}>
                          <input type="hidden" name="id" value={l.id} />
                          <ConfirmButton message={`Delete “${l.name}”? Its ${l.items} tagged purchase-item${l.items === 1 ? "" : "s"} keep their history but lose the location tag.`} className="text-xs text-red-500 hover:underline">
                            Delete location
                          </ConfirmButton>
                        </form>
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

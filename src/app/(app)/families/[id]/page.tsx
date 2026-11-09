import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { listFamilies, memberLabel } from "@/lib/families";
import { renameFamily, deleteFamily, setFamilyLabel, removeFromFamily } from "@/lib/actions";
import { StatCard, Net, Roi, SectionTitle } from "@/components/ui";
import ConfirmButton from "@/components/ConfirmButton";
import { getMoney, fmtMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

/** One family: each member product side by side, plus the combined totals. */
export default async function FamilyPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await requireUser();
  const [families, m] = await Promise.all([listFamilies(user.id), getMoney(user.id)]);
  const fam = families.find((f) => f.id === params.id);
  if (!fam) notFound();
  const { members, total } = fam;
  const soldVersions = members.filter((r) => r.sold > 0).map(memberLabel);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/inventory?view=family" className="text-sm text-brand-600">← Families</Link>
        <h1 className="mt-1 text-2xl font-bold">{fam.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {members.length} product{members.length === 1 ? "" : "s"} in this family
          {total.sold > 0 && <> · sold {total.sold} across {soldVersions.join(", ")}</>}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="In stock" value={String(total.inStock)} sub={`${total.listed} listed`} />
        <StatCard label="Sold" value={String(total.sold)} />
        <StatCard label="Total net" value={fmtMoney(total.totalNet, m)} tone={total.totalNet >= 0 ? "good" : "bad"} />
        <StatCard label="Avg ROI" value={total.avgRoi == null ? "—" : `${(total.avgRoi * 100).toFixed(1)}%`} sub="across every sale" />
      </div>

      <div className="card overflow-x-auto">
        <SectionTitle tip="Each version keeps its own numbers. The total row combines them.">Versions</SectionTitle>
        {members.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No products in this family. Add one from its product page.</p>
        ) : (
          <table className="min-w-full rtable">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th">Version</th>
                <th className="th">In stock</th>
                <th className="th">Sold</th>
                <th className="th">Avg sale</th>
                <th className="th">Total net</th>
                <th className="th">Avg ROI</th>
                <th className="th">Avg days to sell</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((r) => (
                <tr key={r.productId} className="border-b border-slate-50">
                  <td className="td cell-main" data-label="">
                    <div className="flex items-center gap-2">
                      {r.thumbId ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/photo/${r.thumbId}?size=thumb`} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                      ) : (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-300">▦</span>
                      )}
                      <div className="min-w-0">
                        <Link href={`/products/${r.productId}`} className="font-medium text-slate-800 hover:text-brand-700">{r.name}</Link>
                        <form action={setFamilyLabel} className="mt-1 flex items-center gap-1">
                          <input type="hidden" name="productId" value={r.productId} />
                          <input name="label" defaultValue={r.label ?? ""} className="input py-1 text-xs" placeholder="version label" aria-label="Version label" />
                          <button className="text-xs text-brand-600 hover:underline">Save</button>
                        </form>
                      </div>
                    </div>
                  </td>
                  <td className="td" data-label="In stock">{r.inStock}</td>
                  <td className="td" data-label="Sold">{r.sold}</td>
                  <td className="td" data-label="Avg sale">{r.sold ? fmtMoney(r.saleSum / r.sold, m) : "—"}</td>
                  <td className="td" data-label="Total net">{r.sold ? <Net value={r.totalNet} m={m} /> : "—"}</td>
                  <td className="td" data-label="Avg ROI"><Roi value={r.roiN ? r.roiSum / r.roiN : null} /></td>
                  <td className="td" data-label="Avg days to sell">{r.daysN ? `${Math.round(r.daysSum / r.daysN)}d` : "—"}</td>
                  <td className="td cell-action text-right" data-label="">
                    <form action={removeFromFamily}>
                      <input type="hidden" name="productId" value={r.productId} />
                      <button className="text-xs text-red-500 hover:underline">Remove</button>
                    </form>
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td className="td cell-main" data-label="">Family total</td>
                <td className="td" data-label="In stock">{total.inStock}</td>
                <td className="td" data-label="Sold">{total.sold}</td>
                <td className="td" data-label="Avg sale">{total.avgSale == null ? "—" : fmtMoney(total.avgSale, m)}</td>
                <td className="td" data-label="Total net">{total.sold ? <Net value={total.totalNet} m={m} /> : "—"}</td>
                <td className="td" data-label="Avg ROI"><Roi value={total.avgRoi} /></td>
                <td className="td" data-label="Avg days to sell">{total.avgDays == null ? "—" : `${Math.round(total.avgDays)}d`}</td>
                <td className="td" data-label=""></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="card flex flex-wrap items-end justify-between gap-4">
        <form action={renameFamily} className="flex items-end gap-2">
          <input type="hidden" name="familyId" value={fam.id} />
          <div>
            <label className="label">Family name</label>
            <input name="name" defaultValue={fam.name} className="input" />
          </div>
          <button className="btn-ghost">Rename</button>
        </form>
        <form action={deleteFamily}>
          <input type="hidden" name="familyId" value={fam.id} />
          <ConfirmButton message={`Delete the family “${fam.name}”? Its products, items and sales stay exactly as they are; they're just no longer linked.`} className="text-sm text-red-500 hover:underline">
            Delete family
          </ConfirmButton>
        </form>
      </div>
    </div>
  );
}

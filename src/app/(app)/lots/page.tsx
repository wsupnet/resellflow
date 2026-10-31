import Link from "next/link";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { getFinancials, summarizeLots, listLocations } from "@/lib/queries";
import { sortRows, dirOf } from "@/lib/sort";
import { Net, Roi } from "@/components/ui";
import { SortableTh, FilterSelect, Pagination } from "@/components/TableControls";
import { resolvePer, paginate } from "@/lib/paginate";
import SubNav from "@/components/SubNav";
import { fmtMoney, purchaseDate } from "@/lib/format";
import { getMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function LotsPage({
  searchParams
}: {
  searchParams: { source?: string; type?: string; sort?: string; dir?: string; page?: string; per?: string };
}) {
  const user = await requireUser();
  const [bundle, locationList, m] = await Promise.all([getFinancials(user.id), listLocations(user.id), getMoney(user.id)]);
  let lots = summarizeLots(bundle);
  const locName = new Map(locationList.map((l) => [l.id, l.name]));

  const sources = [...new Set(bundle.purchases.map((p) => p.source))].sort();
  const sourceFilter = searchParams.source ?? "";
  const typeFilter = searchParams.type ?? "";

  lots = lots.filter(({ purchase: p }) => {
    if (sourceFilter && p.source !== sourceFilter) return false;
    if (typeFilter === "lot" && !(p.kind === "LOT" && !p.isPersonal)) return false;
    if (typeFilter === "single" && !(p.kind === "SINGLE" && !p.isPersonal)) return false;
    if (typeFilter === "personal" && !p.isPersonal) return false;
    return true;
  });

  const sort = searchParams.sort ?? "date";
  const dir = dirOf(searchParams.dir ?? (sort === "name" ? "asc" : "desc"));
  const getters: Record<string, (l: (typeof lots)[number]) => string | number | Date | null> = {
    name: (l) => l.purchase.title.toLowerCase(),
    source: (l) => l.purchase.source,
    date: (l) => l.purchase.purchasedAt,
    cost: (l) => l.roll.cost,
    net: (l) => l.roll.net,
    roi: (l) => l.roll.roi
  };
  lots = sortRows(lots, getters[sort] ?? getters.date, dir);

  const per = resolvePer(searchParams.per, cookies().get("pageSize")?.value);
  const pg = paginate(lots, searchParams.page, per);

  return (
    <div className="space-y-6">
      <SubNav items={[{ href: "/inventory", label: "Items" }, { href: "/lots", label: "Lots" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Lots & purchases</h1>
        <Link href="/inventory" className="btn-primary">+ Add</Link>
      </div>

      <p className="text-sm text-slate-500">
        Each lot&apos;s net rolls up every item that came from it — even items sold individually or bundled into other sales.
      </p>

      <div className="flex flex-wrap gap-2">
        <FilterSelect param="type" label="All types" options={[
          { value: "lot", label: "Lots" },
          { value: "single", label: "Singles" },
          { value: "personal", label: "Personal" }
        ]} />
        <FilterSelect param="source" label="All sources" options={sources.map((s) => ({ value: s, label: s }))} />
      </div>

      {lots.length === 0 ? (
        <div className="card text-center text-sm text-slate-500">No purchases match.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full rtable">
            <thead>
              <tr className="border-b border-slate-100">
                <SortableTh field="name">Name</SortableTh>
                <th className="th">Type</th>
                <th className="th">Location</th>
                <SortableTh field="date">Date</SortableTh>
                <SortableTh field="cost">Cost</SortableTh>
                <th className="th">Sold</th>
                <SortableTh field="net">Net</SortableTh>
                <SortableTh field="roi">ROI</SortableTh>
              </tr>
            </thead>
            <tbody>
              {pg.rows.map(({ purchase: p, roll }) => (
                <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="td cell-main" data-label="">
                    <Link href={`/lots/${p.id}`} className="font-medium text-brand-700">{p.title}</Link>
                  </td>
                  <td className="td" data-label="Type">
                    {p.isPersonal ? (
                      <span className="pill bg-purple-100 text-purple-700">personal</span>
                    ) : (
                      <span className={`pill ${p.kind === "LOT" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                        {p.kind === "LOT" ? "lot" : "single"}
                      </span>
                    )}
                  </td>
                  <td className="td text-slate-500" data-label="Location">
                    {p.locationId && locName.get(p.locationId)
                      ? locName.get(p.locationId)
                      : <span className="text-slate-400">{p.source}</span>}
                  </td>
                  <td className="td whitespace-nowrap text-slate-500" data-label="Date"><span title={p.purchasedAtApprox ? "Approximate purchase date" : undefined}>{purchaseDate(p)}</span></td>
                  <td className="td" data-label="Cost">{fmtMoney(roll.cost, m)}{m.currency !== "JPY" && p.costJpy ? <span className="ml-1 text-xs text-slate-400">¥{p.costJpy}</span> : null}</td>
                  <td className="td text-slate-500" data-label="Sold">{roll.soldCount}/{roll.itemCount}</td>
                  <td className="td" data-label="Net"><Net value={roll.net} m={m} /></td>
                  <td className="td" data-label="ROI"><Roi value={roll.roi} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination {...pg} per={per} />
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { groupIntoFamily, dismissFamilySuggestion } from "@/lib/actions";
import { Net } from "@/components/ui";
import { type MoneyCtx } from "@/lib/format";
import { memberLabel, type FamilySuggestion, type listFamilies } from "@/lib/families";

type Families = Awaited<ReturnType<typeof listFamilies>>;

/** Inventory → By family: suggested families to confirm, then every family. */
export default function FamiliesList({ families, suggestions, m }: { families: Families; suggestions: FamilySuggestion[]; m: MoneyCtx }) {
  return (
    <div className="space-y-5">
      {suggestions.length > 0 && (
        <div className="rounded-lg border border-brand-100 bg-brand-50/40 p-3">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Suggested families ({suggestions.length})</h3>
          <ul className="space-y-3">
            {suggestions.map((s, idx) => (
              <li key={idx} className="rounded-lg bg-white/70 p-2 text-sm">
                <div className="mb-2">
                  {s.kind === "join" ? (
                    <>
                      Add to <Link href={`/families/${s.familyId}`} className="font-medium text-brand-700 hover:underline">{s.familyName}</Link>:{" "}
                    </>
                  ) : null}
                  {s.products.map((p, i) => (
                    <span key={p.id}>
                      <Link href={`/products/${p.id}`} className="text-slate-700 hover:text-brand-700">{p.name}</Link>
                      {i < s.products.length - 1 ? <span className="text-slate-400"> · </span> : ""}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={groupIntoFamily} className="flex flex-wrap items-center gap-2">
                    {s.products.map((p) => <input key={p.id} type="hidden" name="productId" value={p.id} />)}
                    {s.kind === "join" ? (
                      <input type="hidden" name="familyId" value={s.familyId} />
                    ) : (
                      <input name="newFamilyName" defaultValue={s.name} className="input py-1 text-sm" aria-label="Family name" />
                    )}
                    <button className="btn-primary py-1 text-sm">{s.kind === "join" ? "Add" : "Make family"}</button>
                  </form>
                  <form action={dismissFamilySuggestion}>
                    {s.products.map((p) => <input key={p.id} type="hidden" name="productId" value={p.id} />)}
                    {s.kind === "join" && <input type="hidden" name="familyId" value={s.familyId} />}
                    <button className="btn-ghost py-1 text-sm">Not a family</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {families.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          No families yet. Group products from <b>By product</b> (tick them, then <b>Group into family</b>), from a product&apos;s
          page, or accept a suggestion above.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full rtable">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th">Family</th>
                <th className="th">Versions</th>
                <th className="th">In stock</th>
                <th className="th">Sold</th>
                <th className="th">Total net</th>
              </tr>
            </thead>
            <tbody>
              {families.map((f) => (
                <tr key={f.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="td cell-main" data-label="">
                    <Link href={`/families/${f.id}`} className="font-medium text-slate-800 hover:text-brand-700">{f.name}</Link>
                  </td>
                  <td className="td text-slate-500" data-label="Versions">
                    {f.members.length === 0 ? "—" : f.members.map(memberLabel).join(" · ")}
                  </td>
                  <td className="td" data-label="In stock">{f.total.inStock}</td>
                  <td className="td" data-label="Sold">{f.total.sold}</td>
                  <td className="td" data-label="Total net">{f.total.sold ? <Net value={f.total.totalNet} m={m} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

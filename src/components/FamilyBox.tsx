import Link from "next/link";
import { setProductFamily, setFamilyLabel, removeFromFamily, groupIntoFamily, dismissFamilySuggestion } from "@/lib/actions";
import { SectionTitle } from "@/components/ui";
import { memberLabel, type FamilySuggestion, type ProductRollup } from "@/lib/families";

/**
 * Product page: the product's family (siblings, its label, leave) or, when it
 * has none, a form to add it to one plus any name-based suggestion.
 */
export default function FamilyBox({
  productId,
  family,
  label,
  siblings,
  families,
  suggestion
}: {
  productId: string;
  family: { id: string; name: string } | null;
  label: string | null;
  siblings: ProductRollup[];
  families: { id: string; name: string }[];
  suggestion: FamilySuggestion | null;
}) {
  if (family) {
    return (
      <div className="card">
        <SectionTitle tip="Different products that are the same thing on the surface, like US and Japan releases or colour variants. Each keeps its own profits.">
          Family: <Link href={`/families/${family.id}`} className="text-brand-700 hover:underline">{family.name}</Link>
        </SectionTitle>
        {siblings.length === 0 ? (
          <p className="mb-3 text-sm text-slate-500">No other products in this family yet.</p>
        ) : (
          <ul className="mb-3 divide-y divide-slate-100 text-sm">
            {siblings.map((s) => (
              <li key={s.productId} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <Link href={`/products/${s.productId}`} className="font-medium text-slate-800 hover:text-brand-700">
                  {memberLabel(s)}
                  {s.label && <span className="ml-2 text-xs font-normal text-slate-400">{s.name}</span>}
                </Link>
                <span className="text-xs text-slate-500">{s.sold} sold · {s.inStock} in stock</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
          <form action={setFamilyLabel} className="flex items-end gap-2">
            <input type="hidden" name="productId" value={productId} />
            <div>
              <label className="label">This product&apos;s version</label>
              <input name="label" defaultValue={label ?? ""} className="input" placeholder="e.g. Japan release, Blue" />
            </div>
            <button className="btn-ghost">Save</button>
          </form>
          <form action={removeFromFamily}>
            <input type="hidden" name="productId" value={productId} />
            <button className="text-xs text-red-500 hover:underline">Remove from family</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <SectionTitle tip="Link different products that are the same thing on the surface, like US and Japan releases or colour variants. Each keeps its own profits; the family shows them side by side.">
        Family
      </SectionTitle>
      {suggestion && (
        <div className="mb-4 rounded-lg bg-brand-50/60 p-3 text-sm">
          <p className="mb-2">
            {suggestion.kind === "join" ? (
              <>Might belong to the family <b>{suggestion.familyName}</b>.</>
            ) : (
              <>
                Might be in the same family as{" "}
                {suggestion.products
                  .filter((p) => p.id !== productId)
                  .map((p, i, a) => (
                    <span key={p.id}>
                      <Link href={`/products/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.name}</Link>
                      {i < a.length - 1 ? ", " : ""}
                    </span>
                  ))}
                .
              </>
            )}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <form action={groupIntoFamily} className="flex flex-wrap items-end gap-2">
              {(suggestion.kind === "join" ? [{ id: productId }] : suggestion.products).map((p) => (
                <input key={p.id} type="hidden" name="productId" value={p.id} />
              ))}
              {suggestion.kind === "join" ? (
                <input type="hidden" name="familyId" value={suggestion.familyId} />
              ) : (
                <div>
                  <label className="label">Family name</label>
                  <input name="newFamilyName" defaultValue={suggestion.name} className="input" />
                </div>
              )}
              <button className="btn-primary">{suggestion.kind === "join" ? "Add to it" : "Make a family"}</button>
            </form>
            <form action={dismissFamilySuggestion}>
              {(suggestion.kind === "join" ? [{ id: productId }] : suggestion.products).map((p) => (
                <input key={p.id} type="hidden" name="productId" value={p.id} />
              ))}
              {suggestion.kind === "join" && <input type="hidden" name="familyId" value={suggestion.familyId} />}
              <button className="btn-ghost">Not a family</button>
            </form>
          </div>
        </div>
      )}
      <form action={setProductFamily} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <input type="hidden" name="productId" value={productId} />
        <div>
          <label className="label">Add to family</label>
          <select name="familyId" defaultValue="new" className="input">
            <option value="new">— new family —</option>
            {families.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">New family name</label>
          <input name="newFamilyName" className="input" placeholder="only for a new family" />
        </div>
        <div>
          <label className="label">This product&apos;s version</label>
          <input name="label" className="input" placeholder="e.g. US release, Burgundy" />
        </div>
        <div className="sm:col-span-3">
          <button className="btn-primary">Add to family</button>
        </div>
      </form>
    </div>
  );
}

import Link from "next/link";
import { updateLot } from "@/lib/actions";
import { type MoneyCtx } from "@/lib/format";

/**
 * Edit the purchase an item came from (date, approx flag, source, location and,
 * for a single purchase, what was paid). A lot's date/source/location are shared
 * by all its items, so saving here changes every item in the lot; lot cost stays
 * on the lot page. Posts to updateLot, which handles both purchase kinds.
 */
export default function PurchaseEditForm({
  purchase,
  itemCount,
  locations,
  m
}: {
  purchase: {
    id: string;
    kind: "SINGLE" | "LOT";
    title: string;
    source: string;
    isPersonal: boolean;
    purchasedAt: Date;
    purchasedAtApprox: boolean;
    costUsd: number;
    costJpy: number | null;
    locationId: string | null;
  };
  itemCount: number;
  locations: { id: string; name: string }[];
  m: MoneyCtx;
}) {
  const isLot = purchase.kind === "LOT";
  const locName = locations.find((l) => l.id === purchase.locationId)?.name ?? "";
  const listId = `purchase-locs-${purchase.id}`;
  return (
    <form action={updateLot} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={purchase.id} />
      {isLot && (
        <p className="sm:col-span-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
          This item came from the lot <Link href={`/lots/${purchase.id}`} className="font-medium underline">{purchase.title}</Link>.
          These details are shared, so saving changes them for all {itemCount} item{itemCount === 1 ? "" : "s"} in the lot.
          The lot&apos;s cost is edited on the lot page.
        </p>
      )}
      <div>
        <label className="label">Purchased</label>
        <input name="purchasedAt" type="date" defaultValue={new Date(purchase.purchasedAt).toISOString().slice(0, 10)} className="input" />
        <label className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
          <input type="checkbox" name="purchasedAtApprox" defaultChecked={purchase.purchasedAtApprox} /> Approximate (best guess)
        </label>
      </div>
      {!purchase.isPersonal && (
        <div>
          <label className="label">Source</label>
          <input name="source" defaultValue={purchase.source} className="input" />
        </div>
      )}
      <div>
        <label className="label">Location</label>
        <input name="location" list={listId} defaultValue={locName} autoComplete="off" className="input" placeholder="pick or type — blank clears" />
        <datalist id={listId}>
          {locations.map((l) => <option key={l.id} value={l.name} />)}
        </datalist>
      </div>
      {!isLot && !purchase.isPersonal && (
        <>
          {m.single && m.currency === "JPY" ? (
            // Yen-only: the USD amount is derived from the yen on save (at the
            // purchase's locked rate), so there's no stale hidden USD value.
            <input type="hidden" name="costFromJpy" value="1" />
          ) : (
            <div>
              <label className="label">Paid ($)</label>
              <input name="costUsd" inputMode="decimal" defaultValue={purchase.costUsd || ""} className="input" placeholder="0" />
            </div>
          )}
          <div className={m.single && m.currency === "USD" ? "hidden" : ""}>
            <label className="label">Paid (¥)</label>
            <input name="costJpy" inputMode="decimal" defaultValue={purchase.costJpy ?? ""} className="input" placeholder="optional" />
          </div>
        </>
      )}
      <div className="sm:col-span-2">
        <button className="btn-primary">{isLot ? "Save lot details" : "Save purchase details"}</button>
      </div>
    </form>
  );
}

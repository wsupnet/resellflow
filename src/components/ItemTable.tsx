"use client";

import { useState } from "react";
import { bulkUpdateItems } from "@/lib/actions";
import { CATEGORIES, ALL_CONDITIONS } from "@/lib/catalog";
import { type MoneyCtx } from "@/lib/format";
import { SortableTh } from "@/components/TableControls";
import ItemRow, { type ItemRowData } from "@/components/ItemRow";
import MergeDialog, { type MergeProduct } from "@/components/MergeDialog";

/**
 * Inventory item table with multi-select. Selecting rows reveals a bulk bar to
 * set condition and/or status on all selected items at once (bulkUpdateItems).
 */
export default function ItemTable({ rows, rate, locations = [], m }: { rows: ItemRowData[]; rate: number; locations?: string[]; m: MoneyCtx }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);

  // Distinct products behind the current selection — merge needs 2+.
  const mergeProductsList: MergeProduct[] = (() => {
    const by = new Map<string, MergeProduct>();
    for (const r of rows) {
      if (!selected.has(r.id) || !r.productId) continue;
      const existing = by.get(r.productId);
      if (existing) existing.count++;
      else by.set(r.productId, { productId: r.productId, name: r.productName, sku: r.sku, category: r.category, compPrice: r.compPrice, count: 1 });
    }
    return [...by.values()];
  })();
  const canMerge = mergeProductsList.length >= 2;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  const ids = [...selected];

  return (
    <div className="space-y-2">
      {ids.length > 0 && (
        <form
          action={bulkUpdateItems}
          onSubmit={() => setSelected(new Set())}
          className="flex flex-wrap items-end gap-2 rounded-lg border border-brand-100 bg-brand-50/50 p-3 text-sm"
        >
          {ids.map((id) => (
            <input key={id} type="hidden" name="itemId" value={id} />
          ))}
          <span className="font-medium text-brand-700">{ids.length} selected</span>
          <div>
            <label className="label">Set category</label>
            <select name="category" defaultValue="" className="input py-1.5">
              <option value="">— leave as-is —</option>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Set condition</label>
            <select name="condition" defaultValue="" className="input py-1.5">
              <option value="">— leave as-is —</option>
              {ALL_CONDITIONS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Set status</label>
            <select name="status" defaultValue="" className="input py-1.5">
              <option value="">— leave as-is —</option>
              <option value="UNLISTED">Unlisted</option>
              <option value="LISTED">Listed</option>
              <option value="SOLD">Sold</option>
              <option value="LOST">Lost (write-off)</option>
              <option value="DAMAGED">Damaged (write-off)</option>
            </select>
          </div>
          <div>
            <label className="label">Set location</label>
            <input name="location" list="bulk-loc-dl" defaultValue="" autoComplete="off" className="input py-1.5" placeholder="— leave as-is —" title="Applies to the whole lot each item came from" />
            <datalist id="bulk-loc-dl">
              {locations.map((l) => <option key={l} value={l} />)}
            </datalist>
          </div>
          <button className="btn-primary py-1.5">Apply</button>
          {canMerge && (
            <button type="button" onClick={() => setMerging(true)} className="btn-ghost py-1.5" title="Combine these into one product">
              Merge {mergeProductsList.length} →
            </button>
          )}
          <button type="button" onClick={() => setSelected(new Set())} className="btn-ghost py-1.5">
            Clear
          </button>
        </form>
      )}

      {merging && (
        <MergeDialog
          products={mergeProductsList}
          onClose={() => setMerging(false)}
          onMerged={() => setSelected(new Set())}
        />
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full rtable">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="th w-8 hidden md:table-cell">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
              </th>
              <SortableTh field="name">Item</SortableTh>
              <SortableTh field="status">Status</SortableTh>
              <SortableTh field="added">Added</SortableTh>
              <SortableTh field="cost">Cost</SortableTh>
              <SortableTh field="sold">Sold for</SortableTh>
              <SortableTh field="net">Net</SortableTh>
              <SortableTh field="roi">ROI</SortableTh>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <ItemRow key={r.id} data={r} selected={selected.has(r.id)} onToggle={toggle} rate={rate} m={m} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

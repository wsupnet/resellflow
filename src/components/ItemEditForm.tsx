"use client";

import { useState } from "react";
import { updateItem } from "@/lib/actions";
import { type MoneyCtx } from "@/lib/format";
import { CATEGORIES, conditionsFor, tracksCondition } from "@/lib/catalog";
import ScanButton from "@/components/ScanButton";
import { useCurrencyPrefs } from "@/components/CurrencyPrefs";

/** The item fields the editor touches. */
export interface ItemEditData {
  id: string;
  title: string;
  status: "UNLISTED" | "LISTED" | "SOLD" | "LOST" | "DAMAGED";
  estimatedValue: number | null;
  costOverrideUsd: number | null;
  costOverrideJpy: number | null;
  notes: string | null;
  sku: string | null;
  category: string | null;
  condition: string | null;
}

/**
 * Edit form for one item (title, status, category, condition, SKU, estimate,
 * cost override, notes). Shared by the inventory row editor and the item page.
 * State initializes from `data` on mount, so remount (key) to pick up new data.
 */
export default function ItemEditForm({ data, rate, m, cols = 4 }: { data: ItemEditData; rate: number; m: MoneyCtx; cols?: 2 | 4 }) {
  const { single } = useCurrencyPrefs();
  const [sku, setSku] = useState(data.sku ?? "");
  const [category, setCategory] = useState(data.category ?? "");
  // If the override was typed in yen, show the exact stored yen (JPY selected).
  const [override, setOverride] = useState(
    data.costOverrideJpy != null ? String(data.costOverrideJpy) : data.costOverrideUsd != null ? String(data.costOverrideUsd) : ""
  );
  // Existing override keeps its own currency; a fresh one defaults to the view currency.
  const [overrideCur, setOverrideCur] = useState<"USD" | "JPY">(
    data.costOverrideJpy != null ? "JPY" : data.costOverrideUsd != null ? "USD" : m.currency
  );

  // The override is stored in USD; convert from yen when that toggle is active.
  const overrideUsd =
    override.trim() === "" || !Number.isFinite(Number(override))
      ? ""
      : (overrideCur === "JPY" ? Number(override) / rate : Number(override)).toFixed(2);

  return (
    <form action={updateItem} className={`grid grid-cols-1 gap-3 ${cols === 4 ? "sm:grid-cols-4" : "sm:grid-cols-2"}`}>
      <input type="hidden" name="id" value={data.id} />
      <div className="sm:col-span-2">
        <label className="label">Title</label>
        <input name="title" defaultValue={data.title} className="input" />
      </div>
      <div>
        <label className="label">Status</label>
        <select name="status" defaultValue={data.status} className="input">
          <option value="UNLISTED">Unlisted</option>
          <option value="LISTED">Listed</option>
          <option value="SOLD">Sold</option>
          <option value="LOST">Lost (write-off)</option>
          <option value="DAMAGED">Damaged (write-off)</option>
        </select>
      </div>
      <div>
        <label className="label">Category</label>
        <select name="category" value={category} onChange={(e) => setCategory(e.target.value)} className="input">
          <option value="">— none —</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      {tracksCondition(category) ? (
        <div>
          <label className="label">Condition</label>
          <select name="condition" defaultValue={data.condition ?? ""} className="input">
            <option value="">— unset —</option>
            {(() => {
              const opts = conditionsFor(category);
              // Preserve a value set under a different list so it isn't lost.
              const list = data.condition && !opts.includes(data.condition) ? [data.condition, ...opts] : opts;
              return list.map((c) => <option key={c}>{c}</option>);
            })()}
          </select>
        </div>
      ) : (
        // Keep submitting condition so switching a tracked→untracked category clears it.
        <input type="hidden" name="condition" value="" />
      )}
      <div>
        <label className="label">Barcode / SKU</label>
        <div className="flex gap-2">
          <input name="sku" value={sku} onChange={(e) => setSku(e.target.value)} className="input font-mono" placeholder="scan or type a code" />
          <ScanButton onCode={setSku} className="btn-ghost shrink-0" label="" />
        </div>
      </div>
      <div>
        <label className="label">Est. value ($)</label>
        <input name="estimatedValue" inputMode="decimal" defaultValue={data.estimatedValue ?? ""} className="input" />
      </div>
      <div>
        <label className="label">Cost override</label>
        <div className="flex gap-2">
          <input
            inputMode="decimal"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            className="input"
            placeholder="blank = auto split"
          />
          {/* One-currency mode still shows the picker for an override stored in the other currency. */}
          {single && overrideCur === m.currency ? (
            <span className="self-center text-sm text-slate-500">{overrideCur === "JPY" ? "¥" : "$"}</span>
          ) : (
            <select
              value={overrideCur}
              onChange={(e) => setOverrideCur(e.target.value as "USD" | "JPY")}
              className="input w-20"
            >
              <option>USD</option>
              <option>JPY</option>
            </select>
          )}
        </div>
        {/* Always submitted in USD; the exact entered yen rides along when typed in ¥. */}
        <input type="hidden" name="costOverrideUsd" value={overrideUsd} />
        <input type="hidden" name="costOverrideJpy" value={overrideCur === "JPY" && overrideUsd !== "" ? override : ""} />
        {!single && overrideCur === "JPY" && overrideUsd !== "" && (
          <p className="mt-1 text-xs text-slate-400">≈ ${overrideUsd} at ¥{rate.toFixed(1)}/$1</p>
        )}
      </div>
      <div className="sm:col-span-2">
        <label className="label">Notes</label>
        <input name="notes" defaultValue={data.notes ?? ""} className="input" />
      </div>
      <div className="flex items-end gap-2">
        <button className="btn-primary">Save</button>
      </div>
    </form>
  );
}

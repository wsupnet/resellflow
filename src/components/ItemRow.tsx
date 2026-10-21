"use client";

import { useState } from "react";
import Link from "next/link";
import { updateItem, deleteItem } from "@/lib/actions";
import { shortDate, fmtMoney, type MoneyCtx } from "@/lib/format";
import { Net, Roi, StatusPill } from "@/components/ui";
import { CATEGORIES, conditionsFor, tracksCondition } from "@/lib/catalog";
import ScanButton from "@/components/ScanButton";
import ConfirmButton from "@/components/ConfirmButton";

export interface ItemRowData {
  id: string;
  title: string;
  status: "UNLISTED" | "LISTED" | "SOLD" | "LOST" | "DAMAGED";
  estimatedValue: number | null;
  costOverrideUsd: number | null;
  costOverrideJpy: number | null; // exact yen when the override was typed in yen
  notes: string | null;
  purchaseId: string;
  purchaseTitle: string;
  isLot: boolean;
  isPersonal: boolean;
  allocatedCost: number;
  gross: number;
  net: number | null;
  roi: number | null;
  timesSold: number;
  addedAt: string;
  daysInStock: number | null; // days sitting unsold (in-stock items only)
  sku: string | null;
  category: string | null;
  condition: string | null;
  photoCount: number;
  thumbId: string | null;
  // Product-level info (for the merge tool).
  productId: string | null;
  productName: string;
  compPrice: number | null;
}

export default function ItemRow({
  data,
  selected,
  onToggle,
  rate,
  m
}: {
  data: ItemRowData;
  selected: boolean;
  onToggle: (id: string) => void;
  rate: number;
  m: MoneyCtx;
}) {
  const [open, setOpen] = useState(false);
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
    <>
      <tr className={`border-b border-slate-50 hover:bg-slate-50/60 ${selected ? "bg-brand-50/40" : ""}`}>
        <td className="td w-8 hidden md:table-cell">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(data.id)}
            aria-label={`Select ${data.title}`}
          />
        </td>
        <td className="td cell-main" data-label="">

          <div className="flex items-center gap-2">
            {data.thumbId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/photo/${data.thumbId}?size=thumb`} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
            ) : (
              <Link href={`/items/${data.id}`} title="Add photos" className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-300 hover:bg-slate-200 hover:text-slate-500">
                📷
              </Link>
            )}
            <div>
              <Link href={`/items/${data.id}`} className="text-left font-medium text-slate-800 hover:text-brand-700">
                {data.title}
              </Link>
              {tracksCondition(data.category) && data.condition && (
                <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{data.condition}</span>
              )}
              {data.daysInStock != null && data.daysInStock >= 30 && (
                <span
                  className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    data.daysInStock >= 90 ? "bg-red-100 text-red-700" : data.daysInStock >= 60 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"
                  }`}
                  title="Days sitting unsold since purchase — consider relisting or discounting"
                >
                  {data.daysInStock}d unsold
                </span>
              )}
              <div className="text-xs text-slate-400">
            {data.isPersonal ? (
              <span className="pill bg-purple-100 text-purple-700">personal</span>
            ) : data.isLot ? (
              <Link href={`/lots/${data.purchaseId}`} className="hover:text-brand-600">
                from lot: {data.purchaseTitle}
              </Link>
            ) : (
              "single"
            )}
            {data.category && <> · {data.category}</>}
            {data.sku && <> · <span className="font-mono text-slate-500">{data.sku}</span></>}
            {data.timesSold > 0 && <> · sold {data.timesSold}× before</>}
            {data.photoCount > 0 && <> · {data.photoCount} photo{data.photoCount === 1 ? "" : "s"}</>}
              </div>
            </div>
          </div>
        </td>
        <td className="td" data-label="Status"><StatusPill status={data.status} /></td>
        <td className="td whitespace-nowrap text-slate-500" data-label="Added">{shortDate(data.addedAt)}</td>
        <td className="td" data-label="Cost">
          {fmtMoney(data.allocatedCost, m)}
          {data.costOverrideJpy != null && <span className="ml-1 text-xs text-slate-400">¥{data.costOverrideJpy.toLocaleString()}</span>}
          {data.costOverrideUsd != null && <span className="ml-1 text-xs text-amber-600">override</span>}
        </td>
        <td className="td" data-label="Sold for">{data.gross ? fmtMoney(data.gross, m) : "—"}</td>
        {/* Net shows for settled items: sold (profit) or written off (the loss). */}
        <td className="td" data-label="Net"><Net value={data.status === "SOLD" || data.status === "LOST" || data.status === "DAMAGED" ? data.net : null} m={m} /></td>
        <td className="td" data-label="ROI"><Roi value={data.status === "SOLD" ? data.roi : null} /></td>
        <td className="td cell-action text-right" data-label="">
          <button
            type="button"
            onClick={() => {
              // Re-seed from the current row data on every open, so the form always
              // shows the item's latest details (barcode, category, override) even
              // after saves/merges elsewhere re-rendered the row.
              if (!open) {
                setSku(data.sku ?? "");
                setCategory(data.category ?? "");
                setOverride(data.costOverrideJpy != null ? String(data.costOverrideJpy) : data.costOverrideUsd != null ? String(data.costOverrideUsd) : "");
                setOverrideCur(data.costOverrideJpy != null ? "JPY" : data.costOverrideUsd != null ? "USD" : m.currency);
              }
              setOpen((o) => !o);
            }}
            className="block w-full rounded-lg border border-slate-200 py-1.5 text-xs font-medium text-brand-600 md:inline md:w-auto md:border-0 md:py-0"
          >
            {open ? "Close" : "Edit"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-slate-100 bg-slate-50/60">
          <td colSpan={9} className="cell-block px-3 py-4" data-label="">
            <form action={updateItem} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
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
                  <select
                    value={overrideCur}
                    onChange={(e) => setOverrideCur(e.target.value as "USD" | "JPY")}
                    className="input w-20"
                  >
                    <option>USD</option>
                    <option>JPY</option>
                  </select>
                </div>
                {/* Always submitted in USD; the exact entered yen rides along when typed in ¥. */}
                <input type="hidden" name="costOverrideUsd" value={overrideUsd} />
                <input type="hidden" name="costOverrideJpy" value={overrideCur === "JPY" && overrideUsd !== "" ? override : ""} />
                {overrideCur === "JPY" && overrideUsd !== "" && (
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
            <p className="mt-2 text-xs text-slate-400">
              Same SKU = one product, so renaming here updates the whole group (every condition) — you only manage the name once.
              {tracksCondition(category) && " Condition splits the sales history so comps stay accurate."}
            </p>
            <div className="mt-2 flex items-center gap-4">
              <Link href={`/items/${data.id}`} className="text-xs text-brand-600 hover:underline">Manage photos →</Link>
              <form action={deleteItem}>
                <input type="hidden" name="id" value={data.id} />
                <ConfirmButton message={`Delete “${data.title}”? This removes the item and its photos permanently.`} className="text-xs text-red-500 hover:underline">
                  Delete item
                </ConfirmButton>
              </form>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

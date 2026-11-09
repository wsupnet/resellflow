"use client";

import { useState } from "react";
import Link from "next/link";
import { deleteItem } from "@/lib/actions";
import { shortDate, fmtMoney, type MoneyCtx } from "@/lib/format";
import { Net, Roi, StatusPill } from "@/components/ui";
import { tracksCondition } from "@/lib/catalog";
import ItemEditForm from "@/components/ItemEditForm";
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
  yen?: { allocatedCost: number; gross: number; net: number }; // Historical-mode yen at locked rates
  timesSold: number;
  addedAt: string;
  addedDay?: string;
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
  // Category for the hint under the editor (the form owns its own copy).
  const category = data.category ?? "";

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
        <td className="td whitespace-nowrap text-slate-500" data-label="Added">{shortDate(data.addedDay ?? data.addedAt)}</td>
        <td className="td" data-label="Cost">
          {fmtMoney(data.allocatedCost, m, data.yen?.allocatedCost)}
          {data.costOverrideJpy != null && <span className="ml-1 text-xs text-slate-400">¥{data.costOverrideJpy.toLocaleString()}</span>}
          {data.costOverrideUsd != null && <span className="ml-1 text-xs text-amber-600">override</span>}
        </td>
        <td className="td" data-label="Sold for">{data.gross ? fmtMoney(data.gross, m, data.yen?.gross) : "—"}</td>
        {/* Net shows for settled items: sold (profit) or written off (the loss). */}
        <td className="td" data-label="Net"><Net value={data.status === "SOLD" || data.status === "LOST" || data.status === "DAMAGED" ? data.net : null} m={m} yen={data.yen?.net} /></td>
        <td className="td" data-label="ROI"><Roi value={data.status === "SOLD" ? data.roi : null} /></td>
        <td className="td cell-action text-right" data-label="">
          <button
            type="button"
            onClick={() => {
              // The form mounts fresh on every open, so it always starts from the
              // item's latest details even after saves/merges re-rendered the row.
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
            <ItemEditForm data={data} rate={rate} m={m} />
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

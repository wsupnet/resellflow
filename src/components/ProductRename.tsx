"use client";

import { useState } from "react";
import { renameProduct } from "@/lib/actions";

/**
 * Inline "rename the master product" control for the by-product stock view.
 * Renaming cascades to every item in the group (see renameProduct), so the
 * group keeps one name with only condition varying.
 */
export default function ProductRename({ productId, name }: { productId: string; name: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Rename this product (applies to all conditions)"
        aria-label="Rename this product"
        className="shrink-0 rounded p-1 text-slate-400 hover:bg-brand-50 hover:text-brand-700"
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
          <path d="M13.5 3.5l3 3L7 16H4v-3z" />
        </svg>
      </button>
    );
  }

  return (
    <form action={renameProduct} className="flex items-center gap-1" onSubmit={() => setOpen(false)}>
      <input type="hidden" name="id" value={productId} />
      <input name="name" defaultValue={name} autoFocus className="input w-44 py-1 text-sm" />
      <button className="btn-primary px-2 py-1 text-xs">Save</button>
      <button type="button" onClick={() => setOpen(false)} className="px-1 text-xs text-slate-400 hover:text-slate-600">
        ✕
      </button>
    </form>
  );
}

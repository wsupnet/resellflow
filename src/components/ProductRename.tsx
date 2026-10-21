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
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-500 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
      >
        ✎ Rename
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

"use client";

import { useMemo, useState } from "react";
import { mergeProducts } from "@/lib/actions";

export interface MergeProduct {
  productId: string;
  name: string;
  sku: string | null;
  category: string | null;
  compPrice: number | null;
  count: number; // how many selected items belong to this product
}

/**
 * Field-by-field merge chooser. Given the distinct products behind the selected
 * items, the user picks which name / barcode / category / comp to keep; on
 * confirm all those products fold into one (items keep their lots) via
 * mergeProducts. The product owning the kept barcode becomes the survivor.
 */
export default function MergeDialog({
  products,
  onClose,
  onMerged
}: {
  products: MergeProduct[];
  onClose: () => void;
  onMerged: () => void;
}) {
  const names = useMemo(() => uniq(products.map((p) => p.name)), [products]);
  const skus = useMemo(() => uniq(products.map((p) => p.sku).filter((s): s is string => !!s)), [products]);
  const cats = useMemo(() => uniq(products.map((p) => p.category).filter((c): c is string => !!c)), [products]);
  const comps = useMemo(() => uniq(products.map((p) => p.compPrice).filter((c): c is number => c != null)), [products]);

  const [name, setName] = useState(names[0] ?? "");
  const [sku, setSku] = useState<string>(skus[0] ?? ""); // "" = no barcode
  const [category, setCategory] = useState<string>(cats[0] ?? ""); // "" = none
  const [comp, setComp] = useState<string>(comps[0] != null ? String(comps[0]) : ""); // "" = none
  const [busy, setBusy] = useState(false);

  const totalItems = products.reduce((a, p) => a + p.count, 0);

  async function submit() {
    setBusy(true);
    try {
      // Survivor = the product that owns the kept barcode; else the first product.
      const keepId =
        (sku && products.find((p) => p.sku === sku)?.productId) || products[0].productId;
      const fd = new FormData();
      for (const p of products) fd.append("productId", p.productId);
      fd.set("keepProductId", keepId);
      fd.set("name", name);
      if (sku) fd.set("sku", sku);
      if (category) fd.set("category", category);
      if (comp) fd.set("compPrice", comp);
      await mergeProducts(fd);
      onMerged();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">Merge into one product</h2>
        <p className="mt-1 text-sm text-slate-500">
          Combining {products.length} products ({totalItems} selected item{totalItems === 1 ? "" : "s"} + any others under them).
          Each item keeps its lot, condition, cost, and status — only these details unify, so the stock count adds up.
        </p>

        <div className="mt-4 space-y-4">
          <Field label="Name">
            <Choices name="name" options={names.map((n) => ({ value: n, label: n }))} value={name} onChange={setName} />
          </Field>

          <Field label="Barcode / SKU" hint="The barcode you don't keep is dropped.">
            <Choices
              name="sku"
              value={sku}
              onChange={setSku}
              options={[...skus.map((s) => ({ value: s, label: s })), { value: "", label: "No barcode" }]}
              mono
            />
          </Field>

          {(cats.length > 0) && (
            <Field label="Category">
              <Choices
                name="category"
                value={category}
                onChange={setCategory}
                options={[...cats.map((c) => ({ value: c, label: c })), { value: "", label: "None" }]}
              />
            </Field>
          )}

          {(comps.length > 0) && (
            <Field label="Comp price">
              <Choices
                name="comp"
                value={comp}
                onChange={setComp}
                options={[...comps.map((c) => ({ value: String(c), label: `$${c.toFixed(2)}` })), { value: "", label: "None" }]}
              />
            </Field>
          )}
        </div>

        <div className="mt-6 flex gap-2">
          <button onClick={submit} disabled={busy || !name} className="btn-primary flex-1">
            {busy ? "Merging…" : `Merge ${products.length} → 1`}
          </button>
          <button onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-sm font-medium text-slate-600">{label}</div>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function Choices({
  name,
  options,
  value,
  onChange,
  mono
}: {
  name: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
}) {
  // A single option needs no choice — just show it.
  if (options.length <= 1) {
    return <div className={`text-sm text-slate-700 ${mono ? "font-mono" : ""}`}>{options[0]?.label ?? "—"}</div>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label
          key={`${name}-${o.value}`}
          className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${
            value === o.value ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 hover:bg-slate-50"
          } ${mono && o.value ? "font-mono" : ""}`}
        >
          <input type="radio" name={name} className="sr-only" checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

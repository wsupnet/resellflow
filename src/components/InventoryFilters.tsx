"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CATEGORIES, ALL_CONDITIONS, conditionsFor, tracksCondition } from "@/lib/catalog";

type Opt = { value: string; label: string };
type Field = { param: string; label: string; any: string; options: Opt[]; itemsOnly?: boolean };

// URL params this panel owns. Everything else (q, view, status, sort, dir, per)
// passes through untouched when filters are applied or cleared.
const KEYS = ["type", "source", "location", "category", "condition", "missing", "age", "result", "roi"] as const;

/**
 * "Filters (N)" button + removable chips for what's applied + a drawer that
 * slides in from the right. Changes are staged in the drawer and only hit the
 * URL on Apply, so picking several filters on a phone is one reload, not five.
 */
export default function InventoryFilters({
  view,
  sources,
  locations
}: {
  view: "items" | "product";
  sources: string[];
  locations: { id: string; name: string }[];
}) {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const current = (): Record<string, string> => Object.fromEntries(KEYS.map((k) => [k, sp.get(k) ?? ""]));

  // Re-seed the draft from the URL each time the drawer opens (discarding any
  // unapplied edits from a previous open).
  useEffect(() => {
    if (open) setDraft(current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Esc closes; lock page scroll behind the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const cat = draft.category ?? "";
  const conditionOpts = cat ? (tracksCondition(cat) ? conditionsFor(cat) : []) : ALL_CONDITIONS;

  const groups: { title: string; note?: string; fields: Field[] }[] = [
    {
      title: "Product",
      fields: [
        { param: "category", label: "Category", any: "Any category", options: CATEGORIES.map((c) => ({ value: c, label: c })) },
        { param: "condition", label: "Condition", any: "Any condition", options: conditionOpts.map((c) => ({ value: c, label: c })) }
      ]
    },
    {
      title: "Where it came from",
      fields: [
        { param: "type", label: "Type", any: "All types", options: [
          { value: "lot", label: "From a lot" },
          { value: "single", label: "Singles" },
          { value: "personal", label: "Personal" }
        ] },
        { param: "source", label: "Source", any: "All sources", options: sources.map((s) => ({ value: s, label: s })) },
        { param: "location", label: "Location", any: "All locations", options: [{ value: "none", label: "— Unassigned —" }, ...locations.map((l) => ({ value: l.id, label: l.name }))] }
      ]
    },
    {
      title: "Stock",
      fields: [
        { param: "age", label: "Unsold for", any: "Any age", itemsOnly: true, options: [
          { value: "30", label: "30+ days" },
          { value: "60", label: "60+ days" },
          { value: "90", label: "90+ days" }
        ] },
        { param: "missing", label: "Missing info", any: "Anything", itemsOnly: true, options: [
          { value: "category", label: "No category" },
          { value: "condition", label: "No condition" },
          { value: "barcode", label: "No barcode" },
          { value: "location", label: "No location" },
          { value: "photo", label: "No photo" },
          { value: "value", label: "No est. value" }
        ] }
      ]
    },
    {
      title: "Sold results",
      note: "Setting either one shows sold items only.",
      fields: [
        { param: "result", label: "Outcome", any: "Any outcome", itemsOnly: true, options: [
          { value: "profit", label: "Made money" },
          { value: "loss", label: "Lost money" }
        ] },
        { param: "roi", label: "ROI", any: "Any ROI", itemsOnly: true, options: [
          { value: "25", label: "25%+" },
          { value: "50", label: "50%+" },
          { value: "100", label: "100%+" }
        ] }
      ]
    }
  ];
  const fields = groups.flatMap((g) => g.fields).filter((f) => view === "items" || !f.itemsOnly);

  // Chips/count reflect the APPLIED (URL) state, limited to what this view uses.
  const applied = fields
    .map((f) => {
      const v = sp.get(f.param);
      if (!v) return null;
      // Label lookup ignores the draft-driven condition list so a chip never goes blank.
      const opts = f.param === "condition" ? ALL_CONDITIONS.map((c) => ({ value: c, label: c })) : f.options;
      return { param: f.param, text: `${f.label}: ${opts.find((o) => o.value === v)?.label ?? v}` };
    })
    .filter((x): x is { param: string; text: string } => !!x);

  function push(next: Record<string, string>) {
    const p = new URLSearchParams(sp.toString());
    for (const k of KEYS) {
      if (next[k]) p.set(k, next[k]);
      else p.delete(k);
    }
    p.delete("page"); // new filters restart pagination
    router.push(`${pathname}?${p.toString()}`, { scroll: false });
  }

  function setField(param: string, value: string) {
    setDraft((d) => {
      const n = { ...d, [param]: value };
      // A condition that isn't valid for the newly chosen category gets dropped.
      if (param === "category" && n.condition) {
        const valid = value ? (tracksCondition(value) ? conditionsFor(value) : []) : ALL_CONDITIONS;
        if (!valid.includes(n.condition)) n.condition = "";
      }
      return n;
    });
  }

  const draftCount = fields.filter((f) => draft[f.param]).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`btn-ghost ml-auto shrink-0 px-3 py-1.5 ${applied.length ? "border-brand-300 text-brand-700" : ""}`}
        aria-haspopup="dialog"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <path d="M3 5h14M6 10h8M8.5 15h3" />
        </svg>
        Filters
        {applied.length > 0 && (
          <span className="rounded-full bg-brand-600 px-1.5 text-xs font-semibold leading-5 text-white">{applied.length}</span>
        )}
      </button>

      {/* Applied-filter chips wrap onto their own line under the toolbar row. */}
      <FilterChips
        chips={applied}
        onRemove={(param) => push({ ...current(), [param]: "", ...(param === "category" ? { condition: "" } : {}) })}
        onClear={() => push({})}
      />

      {/* Backdrop + drawer. Always mounted so the slide transition can run. */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-slate-200 shadow-xl transition-transform duration-200 ease-out ${open ? "translate-x-0" : "pointer-events-none translate-x-full"}`}
        style={{ backgroundColor: "rgb(var(--surface))" }}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold text-slate-800">Filters</h2>
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 text-xl leading-none text-slate-400 hover:bg-slate-100" aria-label="Close filters">
            ×
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {groups.map((g) => {
            const gf = g.fields.filter((f) => view === "items" || !f.itemsOnly);
            if (!gf.length) return null;
            return (
              <section key={g.title}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</h3>
                <div className="space-y-3">
                  {gf.map((f) => {
                    const disabled = f.param === "condition" && f.options.length === 0;
                    return (
                      <label key={f.param} className="block">
                        <span className="label">{f.label}</span>
                        <select
                          value={draft[f.param] ?? ""}
                          onChange={(e) => setField(f.param, e.target.value)}
                          disabled={disabled}
                          className="input disabled:opacity-50"
                        >
                          <option value="">{disabled ? "Not tracked for this category" : f.any}</option>
                          {f.options.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
                {g.note && <p className="mt-1.5 text-xs text-slate-400">{g.note}</p>}
              </section>
            );
          })}
        </div>

        <div className="flex gap-2 border-t border-slate-200 px-4 py-3">
          <button type="button" className="btn-ghost flex-1" onClick={() => setDraft({})} disabled={draftCount === 0}>
            Reset
          </button>
          <button
            type="button"
            className="btn-primary flex-[2]"
            onClick={() => {
              push(draft);
              setOpen(false);
            }}
          >
            Apply{draftCount ? ` (${draftCount})` : ""}
          </button>
        </div>
      </aside>
    </>
  );
}

function FilterChips({
  chips,
  onRemove,
  onClear
}: {
  chips: { param: string; text: string }[];
  onRemove: (param: string) => void;
  onClear: () => void;
}) {
  if (!chips.length) return null;
  return (
    <div className="flex basis-full flex-wrap items-center gap-1.5 text-xs">
      {chips.map((c) => (
        <button
          key={c.param}
          type="button"
          onClick={() => onRemove(c.param)}
          className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 font-medium text-brand-700 hover:bg-brand-100"
          aria-label={`Remove filter ${c.text}`}
        >
          {c.text}
          <span aria-hidden className="text-brand-500">×</span>
        </button>
      ))}
      <button type="button" onClick={onClear} className="px-1 py-1 text-slate-500 underline-offset-2 hover:underline">
        Clear all
      </button>
    </div>
  );
}

"use client";

import { useState } from "react";

/**
 * Collapses a tall entry form on phones so the list below is reachable without
 * scrolling past it. Collapsed by default on mobile; on desktop (lg+) the toggle
 * disappears and the content is always shown, since the two sit side by side
 * there and there's nothing to scroll past.
 */
export default function MobileCollapse({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="card mb-3 flex w-full items-center justify-between py-3 text-sm font-medium text-brand-700 lg:hidden"
      >
        <span>{open ? label.replace(/^\+ /, "") : label}</span>
        <span className={`text-xs text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {/* Hidden on mobile until expanded; always visible from lg up. */}
      <div className={open ? "block" : "hidden lg:block"}>{children}</div>
    </div>
  );
}

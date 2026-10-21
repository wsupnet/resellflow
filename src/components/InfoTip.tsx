"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A small ⓘ that explains a metric in plain language. Shows on hover (desktop)
 * and on tap (mobile). Click is swallowed so it works inside linked stat cards
 * without triggering navigation; tapping elsewhere closes it.
 */
export default function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <span
      ref={ref}
      className="relative inline-block align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="What does this mean?"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold normal-case text-slate-500 hover:bg-slate-300"
      >
        ?
      </button>
      {open && (
        <span className="absolute left-1/2 top-full z-30 mt-1.5 w-52 -translate-x-1/2 rounded-lg bg-slate-800 p-2.5 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-50 shadow-xl">
          {text}
        </span>
      )}
    </span>
  );
}

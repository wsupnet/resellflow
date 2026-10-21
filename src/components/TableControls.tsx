"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import clsx from "clsx";
import { PAGE_SIZES } from "@/lib/paginate";

/**
 * Standard table pager: "Showing X–Y of Z", numbered pages with a window
 * (1 … 4 [5] 6 … 20), and a page-size select. State lives in the URL
 * (`page`/`per`, scroll:false like every other control); the chosen size is
 * remembered in a `pageSize` cookie so it becomes the default everywhere.
 * Renders nothing when the list fits the smallest size.
 */
export function Pagination({ page, pages, total, start, end, per }: { page: number; pages: number; total: number; start: number; end: number; per: number }) {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  if (total <= PAGE_SIZES[0]) return null;

  function go(p: number) {
    const q = new URLSearchParams(sp.toString());
    if (p <= 1) q.delete("page");
    else q.set("page", String(p));
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
  }
  function setPer(v: number) {
    document.cookie = `pageSize=${v}; path=/; max-age=31536000; samesite=lax`;
    const q = new URLSearchParams(sp.toString());
    q.set("per", String(v));
    q.delete("page"); // a new size restarts at page 1
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
  }

  // Compact page-number window: first & last always, ±1 around the current page.
  const nums: (number | "…")[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-sm">
      <span className="text-xs text-slate-400">
        Showing {start + 1}–{end} of {total}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => go(page - 1)} disabled={page <= 1} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30">
            ‹
          </button>
          {nums.map((n, i) =>
            n === "…" ? (
              <span key={`e${i}`} className="px-1 text-slate-300">…</span>
            ) : (
              <button
                key={n}
                type="button"
                onClick={() => go(n)}
                className={`min-w-[2rem] rounded-lg px-2 py-1 ${n === page ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-500 hover:bg-slate-100"}`}
              >
                {n}
              </button>
            )
          )}
          <button type="button" onClick={() => go(page + 1)} disabled={page >= pages} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30">
            ›
          </button>
        </div>
      )}
      <label className="flex items-center gap-1.5 text-xs text-slate-400">
        Per page
        <select value={per} onChange={(e) => setPer(Number(e.target.value))} className="input w-auto py-1 text-xs">
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
    </div>
  );
}

/**
 * Live search box. Updates the `q` (or given) URL param as you type — debounced,
 * no Enter needed — while preserving every other param (status tab, filters, sort)
 * and staying put on the page (scroll:false), so on mobile the results just update
 * in place instead of jumping to the top.
 */
export function SearchBox({
  param = "q",
  placeholder,
  className = "input w-44 py-1.5"
}: {
  param?: string;
  placeholder?: string;
  className?: string;
}) {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const spString = sp.toString();
  const [value, setValue] = useState(sp.get(param) ?? "");

  // Reflect external changes to the param (e.g. clearing filters / following a link).
  useEffect(() => {
    setValue(sp.get(param) ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spString]);

  // Debounce URL updates so typing feels live without spamming navigations.
  useEffect(() => {
    if (value === (sp.get(param) ?? "")) return;
    const t = setTimeout(() => {
      const p = new URLSearchParams(spString);
      if (value) p.set(param, value);
      else p.delete(param);
      p.delete("page"); // a new search restarts pagination
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="search"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      // Enter would otherwise submit an enclosing form and scroll to the top.
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault();
      }}
      placeholder={placeholder}
      className={className}
    />
  );
}

/** A clickable column header that toggles sort field/direction via the URL. */
export function SortableTh({
  field,
  children,
  className
}: {
  field: string;
  children: React.ReactNode;
  className?: string;
}) {
  const sp = useSearchParams();
  const pathname = usePathname();
  const curField = sp.get("sort");
  const curDir = sp.get("dir") === "asc" ? "asc" : "desc";
  const active = curField === field;
  const nextDir = active && curDir === "desc" ? "asc" : "desc";

  const params = new URLSearchParams(sp.toString());
  params.set("sort", field);
  params.set("dir", nextDir);
  params.delete("page"); // re-sorting restarts pagination

  return (
    <th className={clsx("th", className)}>
      <Link
        href={`${pathname}?${params.toString()}`}
        scroll={false}
        className={clsx("inline-flex items-center gap-1 hover:text-slate-700", active && "text-slate-800")}
      >
        {children}
        <span className="text-[10px]">{active ? (curDir === "desc" ? "▼" : "▲") : "↕"}</span>
      </Link>
    </th>
  );
}

/** A dropdown filter that writes its value to a URL query param. */
export function FilterSelect({
  param,
  label,
  options
}: {
  param: string;
  label: string;
  options: { value: string; label: string }[];
}) {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const value = sp.get(param) ?? "";

  function set(v: string) {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(param, v);
    else p.delete(param);
    p.delete("page"); // changing a filter restarts pagination
    router.push(`${pathname}?${p.toString()}`, { scroll: false });
  }

  return (
    <select value={value} onChange={(e) => set(e.target.value)} className="input w-auto py-1.5 text-sm">
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

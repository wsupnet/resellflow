"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

/** Section sub-tabs (e.g. Inventory ⇄ Lots, Reports ⇄ Insights). */
export default function SubNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
      {items.map((i) => {
        const active = pathname === i.href || pathname.startsWith(i.href + "/");
        return (
          <Link
            key={i.href}
            href={i.href}
            className={clsx(
              "rounded-md px-3 py-1.5 font-medium",
              active ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            {i.label}
          </Link>
        );
      })}
    </div>
  );
}

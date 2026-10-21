"use client";

import { useRouter } from "next/navigation";
import { PERIODS, type Period } from "@/lib/period";

/**
 * Dashboard time-frame selector. The choice is remembered in a cookie so the
 * dashboard opens on whatever period you last looked at.
 */
export default function DashPeriod({ current }: { current: Period }) {
  const router = useRouter();

  function pick(key: Period) {
    document.cookie = `dashPeriod=${key}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-1 text-sm">
      {PERIODS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => pick(p.key)}
          className={`rounded-lg px-3 py-1.5 font-medium ${current === p.key ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100"}`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

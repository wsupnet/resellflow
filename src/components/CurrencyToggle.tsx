"use client";

import { useRouter } from "next/navigation";

/**
 * Flips the display currency for the whole app by setting a `viewCurrency` cookie,
 * then refreshing so server components re-render in the chosen currency.
 */
export default function CurrencyToggle({ current }: { current: "USD" | "JPY" }) {
  const router = useRouter();

  function set(cur: "USD" | "JPY") {
    document.cookie = `viewCurrency=${cur}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
      {(["USD", "JPY"] as const).map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => set(c)}
          className={`rounded-md px-2 py-1 ${current === c ? "bg-white text-brand-700 shadow-sm" : "text-slate-500"}`}
          aria-pressed={current === c}
        >
          {c === "USD" ? "$" : "¥"}
        </button>
      ))}
    </div>
  );
}

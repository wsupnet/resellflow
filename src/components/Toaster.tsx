"use client";

import { useEffect, useRef, useState } from "react";

/** A single toast that dismisses itself after a few seconds, independent of any
 *  parent re-render (the previous version's timer got cancelled on re-render). */
function ToastItem({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // slate-800/slate-50 invert together per theme, so the toast always pops
  // against the page (dark toast on light themes, light toast on dark).
  return (
    <div className="animate-toast-in pointer-events-auto flex items-center gap-3 rounded-xl border-l-4 border-emerald-400 bg-slate-800 px-4 py-3 text-sm font-medium text-slate-50 shadow-xl">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-500">✓</span>
      <span className="pr-1">{message}</span>
    </div>
  );
}

/** Read the flash cookie client-side ("nonce:message"), URL-decoded. */
function readFlashCookie(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)flash=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : "";
}

/** Slides a toast in at top-right whenever a new flash appears, then clears the
 *  cookie. It watches BOTH the server-rendered prop (instant on navigation) and
 *  the cookie itself (polled) — server actions set the cookie but don't always
 *  re-render this layout, so polling is what makes edit/save toasts reliable. */
export default function Toaster({ flash }: { flash?: string }) {
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const seen = useRef<string>("");

  useEffect(() => {
    function fire(candidate: string | undefined) {
      if (!candidate || candidate === seen.current) return;
      seen.current = candidate;
      const idx = candidate.indexOf(":");
      const message = idx >= 0 ? candidate.slice(idx + 1) : candidate;
      setToasts((t) => [...t, { id: Date.now() + Math.random(), message }]);
      document.cookie = "flash=; path=/; max-age=0";
    }
    fire(flash);
    const iv = setInterval(() => fire(readFlashCookie()), 500);
    return () => clearInterval(iv);
  }, [flash]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex max-w-[90vw] flex-col items-end gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} message={t.message} onDone={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))} />
      ))}
    </div>
  );
}

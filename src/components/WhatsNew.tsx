"use client";

import { useEffect, useState } from "react";
import { markWhatsNewSeen } from "@/lib/actions";
import type { ChangelogEntry } from "@/lib/changelog";

/**
 * One-time "what's new" dialog: release notes since the user's last dismissed
 * version, or a welcome for a brand-new account. Dismissing records the running
 * version, so it doesn't show again until the next update.
 */
export default function WhatsNew({ kind, entries, version }: { kind: "welcome" | "updates"; entries: ChangelogEntry[]; version: string }) {
  const [open, setOpen] = useState(true);

  function close() {
    setOpen(false);
    markWhatsNewSeen().catch(() => {});
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const welcome = kind === "welcome";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        className="card max-h-[85vh] w-full max-w-lg overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="whats-new-title" className="text-xl font-bold">
          {welcome ? "Welcome to ResellFlow" : "What's new"}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {welcome ? "Here's what you can do:" : `ResellFlow has been updated to version ${version}.`}
        </p>
        <div className="mt-4 space-y-5">
          {entries.map((e) => (
            <section key={e.version}>
              {!welcome && (
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Version {e.version}
                  {e.date && <span className="font-normal normal-case"> · {e.date}</span>}
                </h3>
              )}
              <ul className="space-y-2 text-sm">
                {e.items.map((it, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                    <span>
                      {it.title && <span className="font-semibold text-slate-800">{it.title}. </span>}
                      <span className="text-slate-600">{it.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={close} className="btn-primary" autoFocus>
            {welcome ? "Get started" : "Got it"}
          </button>
        </div>
      </div>
    </div>
  );
}

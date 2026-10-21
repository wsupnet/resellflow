"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import CurrencyToggle from "./CurrencyToggle";

type NavItem = { href: string; label: string; match?: string[] };

// Most-used, day-to-day destinations live in the top bar.
const PRIMARY: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/inventory", label: "Inventory", match: ["/inventory", "/lots"] },
  { href: "/sales", label: "Sales" },
  { href: "/reports", label: "Analytics", match: ["/reports", "/insights", "/trends"] }
];

// Less-frequent destinations tuck under a "More" menu (and Locations lives under Settings).
const MORE: NavItem[] = [
  { href: "/deal-checker", label: "Deal Checker" },
  { href: "/ledger", label: "Ledger" },
  { href: "/settings", label: "Settings", match: ["/settings", "/locations"] }
];

export default function Nav({ email, isAdmin, currency }: { email: string; isAdmin: boolean; currency: "USD" | "JPY" }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false); // mobile menu
  const [more, setMore] = useState(false); // desktop "More" dropdown

  const isActive = (item: NavItem) =>
    (item.match ?? [item.href]).some((p) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(p + "/")));

  const linkClass = (active: boolean) =>
    clsx("rounded-lg px-3 py-1.5 text-sm font-medium", active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100");

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="text-lg font-bold text-brand-700">ResellFlow</Link>

        <nav className="ml-4 hidden flex-1 items-center gap-1 md:flex">
          {PRIMARY.map((l) => (
            <Link key={l.href} href={l.href} className={linkClass(isActive(l))}>{l.label}</Link>
          ))}

          {/* More dropdown */}
          <div className="relative">
            <button
              onClick={() => setMore((o) => !o)}
              className={linkClass(MORE.some(isActive))}
            >
              More ▾
            </button>
            {more && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMore(false)} />
                <div className="absolute left-0 z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  {MORE.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      onClick={() => setMore(false)}
                      className={clsx("block px-3 py-2 text-sm font-medium", isActive(l) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100")}
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <CurrencyToggle current={currency} />
          <span className="hidden text-xs text-slate-500 sm:inline">
            {email}
            {isAdmin ? " · admin" : ""}
          </span>
          <form action="/api/auth/logout" method="post">
            <button className="btn-ghost py-1.5 text-xs">Sign out</button>
          </form>
          <button className="btn-ghost py-1.5 md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">☰</button>
        </div>
      </div>

      {open && (
        <nav className="grid grid-cols-2 gap-1 border-t border-slate-200 p-2 md:hidden">
          {[...PRIMARY, ...MORE].map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className={clsx("rounded-lg px-3 py-2 text-sm font-medium", isActive(l) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100")}>
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

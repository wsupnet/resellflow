"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export const SETTINGS_SECTIONS = [
  { slug: "fees", label: "Selling fees" },
  { slug: "currency", label: "Currency" },
  { slug: "preferences", label: "Preferences" },
  { slug: "privacy", label: "Barcodes & privacy" },
  { slug: "locations", label: "Locations" },
  { slug: "data", label: "Data" },
  { slug: "account", label: "Account" },
  { slug: "invites", label: "Invites", adminOnly: true }
] as const;

/** Settings section menu: a list down the left on desktop, a picker on phones. */
export default function SettingsNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const sections = SETTINGS_SECTIONS.filter((s) => !("adminOnly" in s && s.adminOnly) || isAdmin);
  const current = sections.find((s) => pathname === `/settings/${s.slug}` || pathname.startsWith(`/settings/${s.slug}/`))?.slug ?? "";

  return (
    <>
      <div className="md:hidden">
        <label className="label" htmlFor="settings-section">Section</label>
        <select id="settings-section" value={current} onChange={(e) => router.push(`/settings/${e.target.value}`)} className="input">
          {sections.map((s) => (
            <option key={s.slug} value={s.slug}>{s.label}</option>
          ))}
        </select>
      </div>
      <nav className="hidden md:block" aria-label="Settings sections">
        <ul className="space-y-1">
          {sections.map((s) => {
            const active = s.slug === current;
            return (
              <li key={s.slug}>
                <Link
                  href={`/settings/${s.slug}`}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-lg px-3 py-2 text-sm ${active ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  {s.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

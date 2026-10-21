import clsx from "clsx";
import Link from "next/link";
import { usd, pct, fmtMoney, type MoneyCtx } from "@/lib/format";
import InfoTip from "@/components/InfoTip";

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
  href,
  help
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "bad";
  // When set, the whole card links to a breakdown/audit view of its number.
  href?: string;
  // Plain-language explanation of the metric, shown from a small ⓘ on hover/tap.
  help?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
        {help && <InfoTip text={help} />}
        {href && <span className="text-slate-300">→</span>}
      </div>
      <div
        className={clsx(
          "mt-1 text-2xl font-bold",
          tone === "good" && "text-emerald-600",
          tone === "bad" && "text-red-600"
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="card block transition hover:border-brand-300 hover:shadow">
        {inner}
      </Link>
    );
  }
  return <div className="card">{inner}</div>;
}

/** Money value colored green/red by sign. Pass `m` to honor the yen toggle
 *  (and `yen` for a locked historical value). */
export function Net({ value, m, yen }: { value: number | null | undefined; m?: MoneyCtx; yen?: number }) {
  if (value == null) return <span className="text-slate-400">—</span>;
  return (
    <span className={value >= 0 ? "font-medium text-emerald-600" : "font-medium text-red-600"}>
      {m ? fmtMoney(value, m, yen) : usd(value)}
    </span>
  );
}

export function Roi({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-slate-400">—</span>;
  return <span className={value >= 0 ? "text-emerald-600" : "text-red-600"}>{pct(value)}</span>;
}

export function StatusPill({ status }: { status: "UNLISTED" | "LISTED" | "SOLD" | "LOST" | "DAMAGED" }) {
  const map = {
    UNLISTED: "bg-slate-100 text-slate-600",
    LISTED: "bg-amber-100 text-amber-700",
    SOLD: "bg-emerald-100 text-emerald-700",
    LOST: "bg-red-100 text-red-700",
    DAMAGED: "bg-orange-100 text-orange-700"
  } as const;
  return <span className={clsx("pill", map[status])}>{status.toLowerCase()}</span>;
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-lg font-semibold text-slate-800">{children}</h2>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card text-center text-sm text-slate-500">{children}</div>;
}

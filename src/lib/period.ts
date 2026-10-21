// Shared report-period resolution, used by the Reports page and the CSV export.

export type Period = "this-month" | "this-quarter" | "this-year" | "all" | "custom";

export const PERIODS: { key: Period; label: string }[] = [
  { key: "this-month", label: "This month" },
  { key: "this-quarter", label: "This quarter" },
  { key: "this-year", label: "This year" },
  { key: "all", label: "All time" }
];

export function normalizePeriod(p?: string): Period {
  return (["this-month", "this-quarter", "this-year", "all", "custom"].includes(p ?? "") ? p : "this-year") as Period;
}

/** Resolve a period (+ optional custom from/to) into a [start, end] range + label. */
export function resolveRange(period: Period, from?: string, to?: string): { start: Date; end: Date; label: string } {
  const now = new Date();
  const y = now.getFullYear();
  if (period === "this-month") {
    return { start: new Date(y, now.getMonth(), 1), end: now, label: now.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
  }
  if (period === "this-quarter") {
    const q = Math.floor(now.getMonth() / 3);
    return { start: new Date(y, q * 3, 1), end: now, label: `Q${q + 1} ${y}` };
  }
  if (period === "all") {
    return { start: new Date(0), end: now, label: "All time" };
  }
  if (period === "custom" && from && to) {
    const s = new Date(from);
    const e = new Date(to);
    e.setHours(23, 59, 59, 999);
    if (!isNaN(+s) && !isNaN(+e)) return { start: s, end: e, label: `${from} → ${to}` };
  }
  return { start: new Date(y, 0, 1), end: now, label: String(y) };
}

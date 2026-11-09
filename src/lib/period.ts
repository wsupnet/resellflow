import { DEFAULT_TZ, dayFromYmd, endOfDay, todayDay } from "./tz";

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

/**
 * Resolve a period (+ optional custom from/to) into a [start, end] range + label.
 * Ranges are in calendar-day instants (UTC midnight, like stored purchase/sale
 * dates), with "today" taken in the user's timezone `tz`. The end is the end of
 * today, so a sale dated today always counts even when the user is ahead of UTC.
 */
export function resolveRange(period: Period, from?: string, to?: string, tz: string = DEFAULT_TZ): { start: Date; end: Date; label: string } {
  const today = todayDay(tz);
  const end = endOfDay(today);
  const y = today.getUTCFullYear();
  const mo = today.getUTCMonth();
  if (period === "this-month") {
    return { start: new Date(Date.UTC(y, mo, 1)), end, label: today.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) };
  }
  if (period === "this-quarter") {
    const q = Math.floor(mo / 3);
    return { start: new Date(Date.UTC(y, q * 3, 1)), end, label: `Q${q + 1} ${y}` };
  }
  if (period === "all") {
    return { start: new Date(0), end, label: "All time" };
  }
  if (period === "custom" && from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const s = dayFromYmd(from);
    const e = endOfDay(dayFromYmd(to));
    if (!isNaN(+s) && !isNaN(+e)) return { start: s, end: e, label: `${from} → ${to}` };
  }
  return { start: new Date(Date.UTC(y, 0, 1)), end, label: String(y) };
}

// Timezone handling.
//
// Two kinds of dates live in the database:
//  • Calendar days — purchase / sale / expense dates. Stored as UTC midnight of
//    the day the user picked ("2026-11-09" → 2026-11-09T00:00Z) and always
//    displayed in UTC, so a typed date never slips a day whatever the timezone.
//  • Moments — createdAt, writtenOffAt and the like. Real timestamps, shown and
//    bucketed in the user's timezone.
//
// The user's timezone decides what "today" is (blank date fields, report
// periods ending today) and which calendar day a moment falls on.

// Pure helpers only — safe in client components. The DB lookup lives in usertz.ts.

export const DEFAULT_TZ = "UTC";

/** True when `tz` is an IANA zone this runtime knows (e.g. "America/Los_Angeles"). */
export function isValidTz(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Every IANA zone the runtime supports, for the Settings picker. */
export function allTimezones(): string[] {
  const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  return list.includes("UTC") ? list : ["UTC", ...list];
}

/** "YYYY-MM-DD" of the calendar day `d` falls on in `tz`. */
export function ymdInTz(d: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Today's date in `tz` as "YYYY-MM-DD" (for date-input defaults and file names). */
export function todayYmd(tz: string): string {
  return ymdInTz(new Date(), tz);
}

/** A "YYYY-MM-DD" string → its calendar-day instant (UTC midnight). */
export function dayFromYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Today in `tz` as a calendar-day instant. */
export function todayDay(tz: string): Date {
  return dayFromYmd(todayYmd(tz));
}

/** The calendar day a moment falls on in `tz`, as a calendar-day instant. */
export function momentToDay(d: Date | string, tz: string): Date {
  return dayFromYmd(ymdInTz(new Date(d), tz));
}

/**
 * Parse a date typed into a form. A plain "YYYY-MM-DD" becomes that calendar
 * day; blank means today in the user's timezone. Anything else that Date can
 * read (CSV imports with full timestamps) is reduced to its calendar day in `tz`.
 * Returns null for unreadable input.
 */
export function parseEntryDate(raw: string | null | undefined, tz: string): Date | null {
  const s = (raw ?? "").trim();
  if (!s) return todayDay(tz);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = dayFromYmd(s);
    return isNaN(+d) ? null : d;
  }
  const d = new Date(s);
  return isNaN(+d) ? null : momentToDay(d, tz);
}

/** End of a calendar day (23:59:59.999 UTC of that day). */
export function endOfDay(day: Date): Date {
  return new Date(+day + 86400000 - 1);
}

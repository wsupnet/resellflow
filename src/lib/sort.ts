export type SortDir = "asc" | "desc";

export function dirOf(v: string | undefined | null): SortDir {
  return v === "asc" ? "asc" : "desc";
}

type Sortable = number | string | Date | null | undefined;

function toComparable(v: Sortable): number | string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  return v;
}

/** Stable sort with nulls always pushed to the end, regardless of direction. */
export function sortRows<T>(rows: T[], getter: (r: T) => Sortable, dir: SortDir): T[] {
  const mult = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = toComparable(getter(a));
    const bv = toComparable(getter(b));
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    let c: number;
    if (typeof av === "string" && typeof bv === "string") c = av.localeCompare(bv);
    else c = (av as number) - (bv as number);
    return c * mult;
  });
}

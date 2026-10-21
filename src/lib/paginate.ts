// Shared table pagination. Pure (no server imports) so both server pages and
// the client <Pagination> control can use it. The chosen page size is
// remembered in a `pageSize` cookie (set client-side by <Pagination>); the
// `per` URL param overrides it for the current view.

export const PAGE_SIZES = [15, 30, 50, 75, 100] as const;
export const DEFAULT_PAGE_SIZE = 15;

/** Resolve the page size: URL param wins, then the remembered cookie, else default. */
export function resolvePer(param: string | undefined, cookie: string | undefined): number {
  const n = Number(param ?? cookie);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

export interface Paged<T> {
  rows: T[];
  page: number; // clamped to [1, pages], so a stale ?page=99 shows the last page
  pages: number;
  total: number;
  start: number; // 0-based index of the first row shown
  end: number; // exclusive
}

export function paginate<T>(all: T[], pageParam: string | undefined, per: number): Paged<T> {
  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / per));
  const page = Math.min(Math.max(1, Math.floor(Number(pageParam)) || 1), pages);
  const start = (page - 1) * per;
  const end = Math.min(start + per, total);
  return { rows: all.slice(start, end), page, pages, total, start, end };
}

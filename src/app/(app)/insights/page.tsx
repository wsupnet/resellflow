import Link from "next/link";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { getVariantStats, rollupStats, ROI_MIN_SALES, type VariantStat } from "@/lib/queries";
import { prisma } from "@/lib/db";
import { HBarChart } from "@/components/Charts";
import { Roi } from "@/components/ui";
import SubNav from "@/components/SubNav";
import { Pagination } from "@/components/TableControls";
import { resolvePer, paginate } from "@/lib/paginate";
import { fmtMoney, moneyUnit, toView } from "@/lib/format";
import { getMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

type SortKey = "score" | "profit" | "roi" | "freq" | "speed";

const SORTS: { key: SortKey; label: string; help: string }[] = [
  { key: "score", label: "Blended", help: "profit per sale × how often it sells × ROI — the default buy-more signal" },
  { key: "profit", label: "Total profit", help: "most total net profit earned" },
  { key: "roi", label: "ROI", help: `highest average return on cost — needs ${ROI_MIN_SALES}+ sales to rank, so one lucky sale can't top the list` },
  { key: "freq", label: "Most sold", help: "highest number of times sold" },
  { key: "speed", label: "Fastest selling", help: "shortest average days from purchase to sold" }
];

function sortStats(stats: VariantStat[], key: SortKey): VariantStat[] {
  const c = [...stats];
  if (key === "profit") return c.sort((a, b) => b.totalNet - a.totalNet);
  if (key === "roi") {
    // Too few sales to trust the ROI → ranked after every variant that has enough.
    const trusted = (s: VariantStat) => (s.timesSold >= ROI_MIN_SALES ? 1 : 0);
    return c.sort((a, b) => trusted(b) - trusted(a) || (b.avgRoi ?? -Infinity) - (a.avgRoi ?? -Infinity));
  }
  if (key === "freq") return c.sort((a, b) => b.timesSold - a.timesSold);
  if (key === "speed") return c.sort((a, b) => (a.avgDaysToSell ?? Infinity) - (b.avgDaysToSell ?? Infinity));
  return c.sort((a, b) => b.score - a.score);
}

export default async function InsightsPage(
  props: { searchParams: Promise<{ sort?: string; sales?: string; group?: string; page?: string; per?: string }> }
) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  // "individual" drops bundle sales (whose per-item price is a cost-share estimate).
  const individualOnly = searchParams.sales === "individual";
  const m = await getMoney(user.id);
  const all = await getVariantStats(user.id, { individualOnly, m });
  // Families mode: every product in a family (all conditions) becomes one
  // combined row; products without a family stay as their own rows.
  const byFamily = searchParams.group === "family";
  let rows = all;
  if (byFamily) {
    const fams = await prisma.family.findMany({ where: { userId: user.id }, select: { id: true, name: true } });
    const famName = new Map(fams.map((f) => [f.id, f.name]));
    const grouped = new Map<string, VariantStat[]>();
    rows = [];
    for (const v of all) {
      if (v.familyId && famName.has(v.familyId)) grouped.set(v.familyId, [...(grouped.get(v.familyId) ?? []), v]);
      else rows.push(v);
    }
    for (const [id, vs] of grouped) rows.push(rollupStats(vs, `fam:${id}`, famName.get(id)!));
  }
  // Insights is about what sells — only rows with at least one sale.
  const stats = rows.filter((s) => s.timesSold > 0);

  const sort = (SORTS.some((s) => s.key === searchParams.sort)
    ? searchParams.sort
    : "score") as SortKey;
  const sorted = sortStats(stats, sort);
  const qs = (o: { sort?: string; sales?: string; group?: string }) => {
    const p = new URLSearchParams();
    const so = o.sort ?? sort;
    const sa = o.sales ?? (individualOnly ? "individual" : "");
    const gr = o.group ?? (byFamily ? "family" : "");
    if (so !== "score") p.set("sort", so);
    if (sa) p.set("sales", sa);
    if (gr) p.set("group", gr);
    const q = p.toString();
    return q ? `/insights?${q}` : "/insights";
  };

  // Each product opens its sales breakdown, filtered to the same condition and
  // the same individual-sales choice so the numbers match this row.
  const breakdownHref = (s: VariantStat) => {
    if (s.key.startsWith("fam:")) return `/families/${s.key.slice(4)}`;
    if (s.productId.startsWith("item:")) return `/items/${s.productId.slice(5)}`;
    const p = new URLSearchParams();
    if (s.condition) p.set("condition", s.condition);
    if (individualOnly) p.set("sales", "individual");
    const q = p.toString();
    return `/products/${s.productId}${q ? `?${q}` : ""}`;
  };

  const u = moneyUnit(m);
  const chartData = sorted.slice(0, 10).map((s) => ({
    href: breakdownHref(s),
    name: s.name.length > 22 ? s.name.slice(0, 21) + "…" : s.name,
    fullName: s.name, // hover tooltip shows the untruncated name
    value:
      // Money lenses follow the view currency; the rest are %/counts/days.
      sort === "profit" ? toView(s.totalNet, m, s.totalNetYen)
      : sort === "roi" ? (s.avgRoi ?? 0) * 100
      : sort === "freq" ? s.timesSold
      : sort === "speed" ? (s.avgDaysToSell ?? 0)
      // Blended: plot the score itself so bar lengths follow the ranking.
      : s.score
  }));
  const chartFmt =
    sort === "roi" ? { symbol: "", suffix: "%", decimals: 1 }
    : sort === "freq" ? { symbol: "", suffix: "", decimals: 0 }
    : sort === "speed" ? { symbol: "", suffix: "d", decimals: 0 }
    : sort === "score" ? { symbol: "", suffix: "", decimals: 1 }
    : { symbol: u.symbol, suffix: "", decimals: u.decimals };

  // The chart always ranks the full set; only the table paginates.
  const per = resolvePer(searchParams.per, (await cookies()).get("pageSize")?.value);
  const pg = paginate(sorted, searchParams.page, per);

  return (
    <div className="space-y-6">
      <SubNav items={[{ href: "/reports", label: "Reports" }, { href: "/insights", label: "Insights" }, { href: "/trends", label: "Trends" }]} />
      <div>
        <h1 className="text-2xl font-bold">Insights — what to buy more of</h1>
        <p className="mt-1 text-sm text-slate-500">
          Based on what you&apos;ve actually sold. Switch the lens to compare winners by different measures and make the call yourself.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-sm">
        {SORTS.map((s) => (
          <Link
            key={s.key}
            href={qs({ sort: s.key })}
            title={s.help}
            className={`rounded-lg px-3 py-1.5 font-medium ${sort === s.key ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100"}`}
          >
            {s.label}
          </Link>
        ))}
        <div className="ml-auto flex gap-1 rounded-lg bg-slate-100 p-0.5 text-xs" title="Families combine every version of a product into one row (products without a family stay as they are)">
          <Link href={qs({ group: "" })} scroll={false} className={`rounded px-2 py-1 font-medium ${!byFamily ? "bg-white shadow-sm" : "text-slate-500"}`}>
            Products
          </Link>
          <Link href={qs({ group: "family" })} scroll={false} className={`rounded px-2 py-1 font-medium ${byFamily ? "bg-white shadow-sm" : "text-slate-500"}`}>
            Families
          </Link>
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-xs" title="Bundle sales split one price across items by cost, so their per-item numbers are estimates">
          <Link href={qs({ sales: "" })} scroll={false} className={`rounded px-2 py-1 font-medium ${!individualOnly ? "bg-white shadow-sm" : "text-slate-500"}`}>
            All sales
          </Link>
          <Link href={qs({ sales: "individual" })} scroll={false} className={`rounded px-2 py-1 font-medium ${individualOnly ? "bg-white shadow-sm" : "text-slate-500"}`}>
            Individual only
          </Link>
        </div>
      </div>
      <p className="-mt-3 text-xs text-slate-400">{SORTS.find((s) => s.key === sort)?.help}</p>

      {sorted.length === 0 ? (
        <div className="card text-center text-sm text-slate-500">
          No sales history yet. Once you record sales, your best-performing products show up here.
        </div>
      ) : (
        <>
          <div className="card">
            <h2 className="mb-2 text-sm font-semibold text-slate-600">
              Top 10 by {SORTS.find((s) => s.key === sort)?.label}
              {sort === "roi" ? " (%)" : sort === "freq" ? " (count)" : sort === "speed" ? " (days)" : sort === "score" ? " (score)" : ` (${u.symbol})`}
            </h2>
            <p className="-mt-1 mb-2 text-xs text-slate-400">Click a product (bar or name) to see every sale behind its numbers.</p>
            {sort === "speed" ? (
              // A bar chart of days is misleading here — lower is better and same-day
              // sales are 0 (invisible). The table below is ranked fastest-first.
              <p className="py-6 text-center text-sm text-slate-400">
                Ranked fastest-first in the table below — fewest days from purchase to sale (0 = sold the same day).
              </p>
            ) : (
              <HBarChart data={chartData} symbol={chartFmt.symbol} suffix={chartFmt.suffix} decimals={chartFmt.decimals} />
            )}
          </div>

          <div className="card overflow-x-auto">
            <table className="min-w-full rtable">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th">Product</th>
                  <th className="th">Times sold</th>
                  <th className="th">Total net</th>
                  <th className="th">Avg net / sale</th>
                  <th className="th">Avg ROI</th>
                  <th className="th">Avg days to sell</th>
                  <th className="th">Blended score</th>
                </tr>
              </thead>
              <tbody>
                {pg.rows.map((s) => (
                  <tr key={s.key} className="border-b border-slate-50">
                    <td className="td cell-main font-medium" data-label="">
                      <Link href={breakdownHref(s)} className="text-slate-800 hover:text-brand-700 hover:underline">{s.name}</Link>
                      {s.key.startsWith("fam:") && <span className="ml-2 pill bg-indigo-50 text-indigo-700">family</span>}
                    </td>
                    <td className="td" data-label="Times sold">
                      {s.timesSold}
                      {s.bundleSold > 0 && (
                        <span className="ml-1.5 pill bg-purple-100 text-purple-700" title="Sold inside a bundle — that sale's price was split across its items by cost">
                          {s.bundleSold === s.timesSold ? "all in bundles" : `${s.bundleSold} in bundle${s.bundleSold === 1 ? "" : "s"}`}
                        </span>
                      )}
                    </td>
                    <td className="td" data-label="Total net">{fmtMoney(s.totalNet, m, s.totalNetYen)}</td>
                    <td className="td" data-label="Avg net / sale">{fmtMoney(s.avgNet, m, s.totalNetYen != null && s.timesSold ? s.totalNetYen / s.timesSold : undefined)}</td>
                    <td className="td" data-label="Avg ROI">
                      <Roi value={s.avgRoi} />
                      {s.avgRoi != null && s.timesSold < ROI_MIN_SALES && (
                        <span className="block text-[10px] text-slate-400" title={`Fewer than ${ROI_MIN_SALES} sales — too few to trust this ROI`}>few sales</span>
                      )}
                    </td>
                    <td className="td" data-label="Avg days to sell">{s.avgDaysToSell == null ? "—" : `${Math.round(s.avgDaysToSell)}d`}</td>
                    <td className="td text-slate-500" data-label="Blended score">{s.score.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination {...pg} per={per} />
          </div>
        </>
      )}
    </div>
  );
}

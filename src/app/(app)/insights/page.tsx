import Link from "next/link";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { getVariantStats, type VariantStat } from "@/lib/queries";
import { HBarChart } from "@/components/Charts";
import { Roi } from "@/components/ui";
import SubNav from "@/components/SubNav";
import { Pagination } from "@/components/TableControls";
import { resolvePer, paginate } from "@/lib/paginate";
import { fmtMoney, moneyUnit } from "@/lib/format";
import { getMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

type SortKey = "score" | "profit" | "roi" | "freq" | "speed";

const SORTS: { key: SortKey; label: string; help: string }[] = [
  { key: "score", label: "Blended", help: "profit per sale × how often it sells × ROI — the default buy-more signal" },
  { key: "profit", label: "Total profit", help: "most total net profit earned" },
  { key: "roi", label: "ROI", help: "highest average return on cost" },
  { key: "freq", label: "Most sold", help: "highest number of times sold" },
  { key: "speed", label: "Fastest selling", help: "shortest average days from purchase to sold" }
];

function sortStats(stats: VariantStat[], key: SortKey): VariantStat[] {
  const c = [...stats];
  if (key === "profit") return c.sort((a, b) => b.totalNet - a.totalNet);
  if (key === "roi") return c.sort((a, b) => (b.avgRoi ?? -Infinity) - (a.avgRoi ?? -Infinity));
  if (key === "freq") return c.sort((a, b) => b.timesSold - a.timesSold);
  if (key === "speed") return c.sort((a, b) => (a.avgDaysToSell ?? Infinity) - (b.avgDaysToSell ?? Infinity));
  return c.sort((a, b) => b.score - a.score);
}

export default async function InsightsPage({ searchParams }: { searchParams: { sort?: string; page?: string; per?: string } }) {
  const user = await requireUser();
  const [all, m] = await Promise.all([getVariantStats(user.id), getMoney(user.id)]);
  // Insights is about what sells — only variants with at least one sale.
  const stats = all.filter((s) => s.timesSold > 0);

  const sort = (SORTS.some((s) => s.key === searchParams.sort)
    ? searchParams.sort
    : "score") as SortKey;
  const sorted = sortStats(stats, sort);

  const u = moneyUnit(m);
  const chartData = sorted.slice(0, 10).map((s) => ({
    name: s.name.length > 22 ? s.name.slice(0, 21) + "…" : s.name,
    fullName: s.name, // hover tooltip shows the untruncated name
    value:
      // Money lenses convert at the live rate (rate = 1 for USD); the rest are %/counts/days.
      sort === "profit" ? s.totalNet * m.rate
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
  const per = resolvePer(searchParams.per, cookies().get("pageSize")?.value);
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

      <div className="flex flex-wrap gap-1 text-sm">
        {SORTS.map((s) => (
          <Link
            key={s.key}
            href={`/insights?sort=${s.key}`}
            title={s.help}
            className={`rounded-lg px-3 py-1.5 font-medium ${sort === s.key ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100"}`}
          >
            {s.label}
          </Link>
        ))}
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
                    <td className="td cell-main font-medium" data-label="">{s.name}</td>
                    <td className="td" data-label="Times sold">{s.timesSold}</td>
                    <td className="td" data-label="Total net">{fmtMoney(s.totalNet, m)}</td>
                    <td className="td" data-label="Avg net / sale">{fmtMoney(s.avgNet, m)}</td>
                    <td className="td" data-label="Avg ROI"><Roi value={s.avgRoi} /></td>
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

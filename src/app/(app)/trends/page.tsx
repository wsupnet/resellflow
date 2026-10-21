import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getSeasonality } from "@/lib/queries";
import { HBarChart } from "@/components/Charts";
import SubNav from "@/components/SubNav";
import { SectionTitle } from "@/components/ui";
import InfoTip from "@/components/InfoTip";
import { fmtMoney, moneyUnit } from "@/lib/format";
import { getMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

type Metric = "units" | "gross" | "net";
const METRICS: { key: Metric; label: string }[] = [
  { key: "units", label: "Items sold" },
  { key: "gross", label: "Gross sales" },
  { key: "net", label: "Net profit" }
];

export default async function TrendsPage({ searchParams }: { searchParams: { metric?: string } }) {
  const user = await requireUser();
  const [data, m] = await Promise.all([getSeasonality(user.id), getMoney(user.id)]);

  const metric = (METRICS.some((x) => x.key === searchParams.metric) ? searchParams.metric : "units") as Metric;
  const isMoney = metric !== "units";
  const u = moneyUnit(m);

  // Bars go on a Jan→Dec axis; money metrics convert at the live rate.
  const chartData = data.byMonth.map((mo) => ({
    name: mo.label,
    value: metric === "units" ? mo.units : (metric === "gross" ? mo.gross : mo.net) * m.rate
  }));
  const chartFmt = isMoney
    ? { symbol: u.symbol, suffix: "", decimals: u.decimals }
    : { symbol: "", suffix: "", decimals: 0 };

  // Best month overall (by the chosen metric) for the headline line.
  const best = data.byMonth.reduce(
    (acc, mo) => {
      const v = metric === "units" ? mo.units : metric === "gross" ? mo.gross : mo.net;
      return v > acc.v ? { label: mo.label, v } : acc;
    },
    { label: "—", v: -Infinity }
  );

  return (
    <div className="space-y-6">
      <SubNav
        items={[
          { href: "/reports", label: "Reports" },
          { href: "/insights", label: "Insights" },
          { href: "/trends", label: "Trends" }
        ]}
      />
      <div>
        <h1 className="text-2xl font-bold">Seasonality — when things sell</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every year folded onto one Jan–Dec axis, so recurring patterns show up. Use it to line up stock before the months
          that move.
        </p>
      </div>

      {data.totalSales === 0 ? (
        <div className="card text-center text-sm text-slate-500">
          No sales yet — once you record some, your seasonal patterns show up here.
        </div>
      ) : (
        <>
          {/* Metric toggle */}
          <div className="flex flex-wrap gap-1 text-sm">
            {METRICS.map((x) => (
              <Link
                key={x.key}
                href={`/trends?metric=${x.key}`}
                className={`rounded-lg px-3 py-1.5 font-medium ${metric === x.key ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100"}`}
              >
                {x.label}
              </Link>
            ))}
          </div>

          {data.yearsSpanned < 2 && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              You have under a year of sales history, so this is really just your months so far — it gets more meaningful as a
              true seasonal pattern once you&apos;ve sold across multiple years.
            </div>
          )}

          <div className="card">
            <SectionTitle>
              <span className="inline-flex items-center gap-1.5">
                {METRICS.find((x) => x.key === metric)?.label} by month
                <InfoTip text="Every sale is placed in the calendar month it sold, then all years are added together on one Jan–Dec axis. A tall bar means that month reliably moves product — plan to have stock listed just before it. Switch the toggle to view the same pattern by items sold, gross sales, or net profit." />
              </span>
              {best.v > 0 && <span className="ml-2 text-sm font-normal text-slate-400">· best month: {best.label}</span>}
            </SectionTitle>
            <HBarChart data={chartData} symbol={chartFmt.symbol} suffix={chartFmt.suffix} decimals={chartFmt.decimals} />
          </div>

          <div className="card overflow-x-auto">
            <SectionTitle>
              <span className="inline-flex items-center gap-1.5">
                Best month per category
                <InfoTip text="For each category, the calendar month it has sold the most units in across all your history — plus its all-time totals. Use it to know what to stock when: if games peak in December, buy them in the fall." />
              </span>
            </SectionTitle>
            <table className="min-w-full rtable">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th">Category</th>
                  <th className="th">Peak month</th>
                  <th className="th">Items sold</th>
                  <th className="th">Gross</th>
                  <th className="th">Net</th>
                </tr>
              </thead>
              <tbody>
                {data.byCategory.map((c) => (
                  <tr key={c.category} className="border-b border-slate-50">
                    <td className="td cell-main font-medium" data-label="">{c.category}</td>
                    <td className="td" data-label="Peak month">
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{c.peakMonth}</span>
                    </td>
                    <td className="td" data-label="Items sold">{c.units}</td>
                    <td className="td" data-label="Gross">{fmtMoney(c.gross, m)}</td>
                    <td className="td" data-label="Net">{fmtMoney(c.net, m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-400">Peak = the calendar month that category has sold the most units in.</p>
          </div>
        </>
      )}
    </div>
  );
}

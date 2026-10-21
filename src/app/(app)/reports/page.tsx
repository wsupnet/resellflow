import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getReport } from "@/lib/queries";
import { MonthlyNetChart } from "@/components/Charts";
import { StatCard, SectionTitle } from "@/components/ui";
import SubNav from "@/components/SubNav";
import { pct, moneyUnit, fmtDeduction } from "@/lib/format";
import { PERIODS as PRESETS, normalizePeriod, resolveRange } from "@/lib/period";
import { getMoney, fmtMoney, type MoneyCtx } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams
}: {
  searchParams: { period?: string; from?: string; to?: string };
}) {
  const user = await requireUser();
  const period = normalizePeriod(searchParams.period);
  const { start, end, label } = resolveRange(period, searchParams.from, searchParams.to);
  const m = await getMoney(user.id);
  const csvQuery = new URLSearchParams({ type: "report", period, ...(searchParams.from ? { from: searchParams.from } : {}), ...(searchParams.to ? { to: searchParams.to } : {}) }).toString();
  const r = await getReport(user.id, start, end, m.currency === "JPY" && m.mode === "historical" ? { live: m.rate } : undefined);

  const otherExpenses = r.attributedExpenses + r.generalExpenses;
  const otherExpensesYen = (r.attributedExpensesYen ?? 0) + (r.generalExpensesYen ?? 0);

  // Monthly trend chart: convert at the live rate (rate = 1 for USD).
  const u = moneyUnit(m);
  const monthlyChart = r.monthly.map((x) => ({ ...x, net: x.net * m.rate, gross: x.gross * m.rate }));

  return (
    <div className="space-y-6">
      <SubNav items={[{ href: "/reports", label: "Reports" }, { href: "/insights", label: "Insights" }, { href: "/trends", label: "Trends" }]} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="mt-1 text-sm text-slate-500">
            Realized profit &amp; loss — a sale&apos;s revenue, fees, and the cost of its items are all counted in the period it sold.
            Showing <b>{label}</b>.
          </p>
        </div>
        <a href={`/api/export?${csvQuery}`} className="btn-ghost shrink-0">Download CSV</a>
      </div>

      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 text-sm">
          {PRESETS.map((p) => (
            <Link
              key={p.key}
              href={`/reports?period=${p.key}`}
              className={`rounded-lg px-3 py-1.5 font-medium ${period === p.key ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100"}`}
            >
              {p.label}
            </Link>
          ))}
        </div>
        <form className="ml-auto flex items-end gap-2 text-sm">
          <input type="hidden" name="period" value="custom" />
          <div>
            <label className="label text-[11px]">From</label>
            <input type="date" name="from" defaultValue={searchParams.from ?? ""} className="input py-1.5 text-sm" />
          </div>
          <div>
            <label className="label text-[11px]">To</label>
            <input type="date" name="to" defaultValue={searchParams.to ?? ""} className="input py-1.5 text-sm" />
          </div>
          <button className={`btn-ghost py-1.5 text-sm ${period === "custom" ? "border-brand-300 text-brand-700" : ""}`}>Apply</button>
        </form>
      </div>

      {/* P&L summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Gross sales"
          value={fmtMoney(r.gross, m, r.grossYen)}
          sub={`${r.salesCount} sale${r.salesCount === 1 ? "" : "s"} · ${r.itemsSold} item${r.itemsSold === 1 ? "" : "s"}`}
          help="The total sticker price of everything sold in this period, before any fees or costs come out."
        />
        <StatCard
          label="Net profit"
          value={fmtMoney(r.net, m, r.netYen)}
          tone={r.net >= 0 ? "good" : "bad"}
          sub="after fees, COGS & expenses"
          help="What you actually kept from this period's sales: sale prices minus selling fees, minus what the sold items cost you to buy, minus expenses (and any lost/damaged write-offs)."
        />
        <StatCard
          label="ROI"
          value={r.roi == null ? "—" : pct(r.roi)}
          tone={(r.roi ?? 0) >= 0 ? "good" : "bad"}
          sub={`on ${fmtMoney(r.totalSpend, m, r.totalSpendYen)} spend`}
          help="Return on investment: for every $1 spent behind this period's sales (item cost + fees + expenses), how much profit came back. 100% = you doubled your money."
        />
        <StatCard
          label="Avg net / sale"
          value={r.salesCount ? fmtMoney(r.net / r.salesCount, m, r.netYen != null ? r.netYen / r.salesCount : undefined) : "—"}
          help="Net profit divided by the number of sales — roughly what a typical sale put in your pocket this period."
        />
      </div>

      {/* P&L breakdown */}
      <div className="card">
        <SectionTitle>Profit &amp; loss</SectionTitle>
        <table className="min-w-full">
          <tbody className="text-sm">
            <tr className="border-b border-slate-100">
              <td className="td">Gross sales</td>
              <td className="td text-right font-medium">{fmtMoney(r.gross, m, r.grossYen)}</td>
            </tr>
            <tr className="border-b border-slate-50">
              <td className="td pl-6 text-slate-500">− Selling fees</td>
              <td className="td text-right text-red-600">−{fmtMoney(r.fees, m, r.feesYen)}</td>
            </tr>
            <tr className="border-b border-slate-50">
              <td className="td pl-6 text-slate-500">− Cost of goods sold</td>
              <td className="td text-right text-red-600">−{fmtMoney(r.cogs, m, r.cogsYen)}</td>
            </tr>
            <tr className="border-b border-slate-50">
              <td className="td pl-6 text-slate-500">
                {/* "Other expenses" can include ledger CREDITS (refunds/rebates), which
                    flip the total negative — fmtDeduction picks +/- so it never double-negates. */}
                {fmtDeduction(otherExpenses, m, otherExpensesYen).isCredit ? "+" : "−"} Other expenses/credits
                <span className="ml-1 text-xs text-slate-400">({fmtMoney(r.attributedExpenses, m, r.attributedExpensesYen)} attached + {fmtMoney(r.generalExpenses, m, r.generalExpensesYen)} general)</span>
              </td>
              <td className={`td text-right ${fmtDeduction(otherExpenses, m, otherExpensesYen).isCredit ? "text-emerald-600" : "text-red-600"}`}>
                {fmtDeduction(otherExpenses, m, otherExpensesYen).text}
              </td>
            </tr>
            {r.writeOffCount > 0 && (
              <tr className="border-b border-slate-50">
                <td className="td pl-6 text-slate-500">
                  − Write-offs
                  <span className="ml-1 text-xs text-slate-400">({r.writeOffCount} lost/damaged item{r.writeOffCount === 1 ? "" : "s"})</span>
                </td>
                <td className="td text-right text-red-600">−{fmtMoney(r.writeOffCost, m, r.writeOffCostYen)}</td>
              </tr>
            )}
            <tr className="bg-slate-50">
              <td className="td text-base font-semibold">Net profit</td>
              <td className={`td text-right text-base font-bold ${r.net >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtMoney(r.net, m, r.netYen)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {r.itemsSold === 0 ? (
        <div className="card text-center text-sm text-slate-500">No sales in this period.</div>
      ) : (
        <>
          {/* Monthly trend */}
          <div className="card">
            <SectionTitle>Net profit by month</SectionTitle>
            <MonthlyNetChart data={monthlyChart} symbol={u.symbol} decimals={u.decimals} />
          </div>

          {/* Location — where your profit actually comes from */}
          <div className="card overflow-x-auto">
            <SectionTitle>By location</SectionTitle>
            <Breakdown rows={r.byLocation} firstCol="Location" m={m} />
          </div>

          {/* Platform + source */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="card overflow-x-auto">
              <SectionTitle>By platform</SectionTitle>
              <Breakdown rows={r.byPlatform} firstCol="Platform" m={m} />
            </div>
            <div className="card overflow-x-auto">
              <SectionTitle>By source</SectionTitle>
              <Breakdown rows={r.bySource} firstCol="Source" m={m} />
            </div>
          </div>

          {/* Expenses by category */}
          <div className="card overflow-x-auto">
            <SectionTitle>Ledger expenses by category</SectionTitle>
            {r.byCategory.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">No ledger expenses dated in this period.</p>
            ) : (
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="th">Category</th>
                    <th className="th text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {r.byCategory.map((c) => (
                    <tr key={c.key} className="border-b border-slate-50">
                      <td className="td">{c.key}</td>
                      <td className="td text-right">{fmtMoney(c.amount, m, c.amountYen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Breakdown({ rows, firstCol, m }: { rows: { key: string; count: number; gross: number; net: number; grossYen?: number; netYen?: number }[]; firstCol: string; m: MoneyCtx }) {
  if (rows.length === 0) return <p className="py-4 text-center text-sm text-slate-500">Nothing yet.</p>;
  return (
    <table className="min-w-full">
      <thead>
        <tr className="border-b border-slate-100">
          <th className="th capitalize">{firstCol}</th>
          <th className="th text-right">Sold</th>
          <th className="th text-right">Gross</th>
          <th className="th text-right">Net</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-slate-50">
            <td className="td capitalize">{row.key}</td>
            <td className="td text-right text-slate-500">{row.count}</td>
            <td className="td text-right">{fmtMoney(row.gross, m, row.grossYen)}</td>
            <td className={`td text-right ${row.net >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtMoney(row.net, m, row.netYen)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

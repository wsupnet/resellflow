import Link from "next/link";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { getFinancials, yenView } from "@/lib/queries";
import { getMoney, fmtMoney } from "@/lib/money";
import { normalizePeriod, resolveRange, type Period } from "@/lib/period";
import { StatCard, StatusPill, Net, SectionTitle } from "@/components/ui";
import { Pagination } from "@/components/TableControls";
import { resolvePer, paginate } from "@/lib/paginate";
import { pct, shortDate, fmtDeduction } from "@/lib/format";

export const dynamic = "force-dynamic";

type Metric = "net-total" | "realized" | "flip" | "gross" | "personal" | "stock";

interface Row {
  id: string;
  title: string;
  lotTitle: string;
  lotId: string;
  status: "UNLISTED" | "LISTED" | "SOLD" | "LOST" | "DAMAGED";
  isPersonal: boolean;
  date: Date | null; // sold date (or write-off date) when relevant
  gross: number;
  fees: number;
  cost: number;
  exp: number;
  net: number;
  est: number | null;
  y?: { gross: number; fees: number; cost: number; exp: number; net: number; est: number }; // Historical-mode yen
}

const METRIC_INFO: Record<Metric, { title: string; blurb: string }> = {
  "net-total": {
    title: "Net profit (total) — audit",
    blurb: "Cash-basis: every item's sale proceeds minus its fees, expenses, and allocated cost — including items still unsold (their cost counts, no proceeds yet) — minus general expenses."
  },
  realized: {
    title: "Realized net — audit",
    blurb: "Sold-basis: items sold in the period (proceeds − fees − cost − expenses) plus write-offs marked in the period (cost as a loss), minus general expenses dated in the period."
  },
  flip: {
    title: "Flip net & ROI — audit",
    blurb: "The flip business only (items you paid for; personal belongings excluded). Sold-basis, including write-offs and general business expenses. ROI = net / total spend."
  },
  gross: {
    title: "Gross sales — audit",
    blurb: "Every item sold in the period with its sale proceeds. Fees/cost columns shown for context; the card's number is the gross column's total."
  },
  personal: {
    title: "Personal belongings — audit",
    blurb: "Items you already owned (no purchase cost) that sold in the period. Net = proceeds − fees − expenses."
  },
  stock: {
    title: "Items in stock — audit",
    blurb: "Everything currently unlisted or listed, with each item's allocated share of its lot cost — this is the money tied up in inventory."
  }
};

export default async function BreakdownPage(
  props: {
    searchParams: Promise<{ metric?: string; period?: string; page?: string; per?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const [bundle, m] = await Promise.all([getFinancials(user.id), getMoney(user.id)]);
  const yv = yenView(bundle, m); // Historical-mode yen, else null

  const metric = (Object.keys(METRIC_INFO).includes(searchParams.metric ?? "") ? searchParams.metric : "realized") as Metric;
  const period: Period = searchParams.period ? normalizePeriod(searchParams.period) : "all";
  const { start, end, label } = resolveRange(period);
  const inRange = (d: Date | string) => {
    const x = +new Date(d);
    return x >= +start && x <= +end;
  };

  // Lookups: sale + purchase behind each item.
  const saleByItem = new Map<string, (typeof bundle.sales)[number]>();
  for (const s of bundle.sales) for (const l of s.lines) saleByItem.set(l.itemId, s);

  // One row per item, with the same per-item financials every page uses —
  // so these lines sum EXACTLY to the dashboard card.
  const allRows: Row[] = [];
  for (const p of bundle.purchases) {
    for (const i of p.items) {
      const f = bundle.itemFin.get(i.id);
      if (!f) continue;
      const sale = saleByItem.get(i.id);
      const writeOff = i.status === "LOST" || i.status === "DAMAGED";
      allRows.push({
        id: i.id,
        title: i.title,
        lotTitle: p.title,
        lotId: p.id,
        status: i.status,
        isPersonal: p.isPersonal,
        date: sale ? new Date(sale.soldAt) : writeOff ? new Date(i.writtenOffAt ?? i.createdAt) : null,
        gross: f.gross,
        fees: f.feeShare,
        cost: f.allocatedCost,
        exp: f.expense,
        net: f.net,
        est: i.estimatedValue,
        y: yv
          ? (() => {
              const fy = yv.fin(i.id);
              const est = yv.lotsYenById.get(p.id)?.items.find((x) => x.id === i.id)?.estimatedValue ?? 0;
              return { gross: fy?.gross ?? 0, fees: fy?.feeShare ?? 0, cost: fy?.allocatedCost ?? 0, exp: fy?.expense ?? 0, net: fy?.net ?? 0, est };
            })()
          : undefined
      });
    }
  }

  const generalExpensesAll = bundle.expenses.filter((e) => !e.purchaseId && !e.itemId && !e.saleId);

  // ── Select rows + general expenses per metric ──
  // A SOLD item without a sale record (data smell — marked sold by hand) has no
  // date; it still counts in the all-time view so totals tie to the dashboard.
  const soldInRange = (r: Row) => r.status === "SOLD" && (r.date ? inRange(r.date) : period === "all");
  const writtenOffInRange = (r: Row) => (r.status === "LOST" || r.status === "DAMAGED") && r.date != null && inRange(r.date);

  let rows: Row[] = [];
  let generalExpenses: typeof generalExpensesAll = [];
  if (metric === "net-total") {
    rows = allRows; // every item: sold contribute proceeds, unsold contribute their cost
    generalExpenses = generalExpensesAll;
  } else if (metric === "realized") {
    rows = allRows.filter((r) => soldInRange(r) || writtenOffInRange(r));
    generalExpenses = generalExpensesAll.filter((e) => inRange(e.date));
  } else if (metric === "flip") {
    rows = allRows.filter((r) => !r.isPersonal && (soldInRange(r) || writtenOffInRange(r)));
    generalExpenses = generalExpensesAll.filter((e) => inRange(e.date));
  } else if (metric === "gross" ) {
    rows = allRows.filter(soldInRange);
  } else if (metric === "personal") {
    // All-time also lists unsold personal items carrying attached expenses, so
    // the total ties exactly to the dashboard's personal net.
    rows = allRows.filter((r) => r.isPersonal && (soldInRange(r) || (period === "all" && r.exp > 0)));
  } else {
    rows = allRows.filter((r) => r.status === "UNLISTED" || r.status === "LISTED");
  }
  rows = metric === "stock" ? rows.sort((a, b) => b.cost - a.cost) : rows.sort((a, b) => b.net - a.net);

  const sum = (get: (r: Row) => number) => rows.reduce((a, r) => a + get(r), 0);
  const generalTotal = generalExpenses.reduce((a, e) => a + e.amountUsd, 0);
  const gross = sum((r) => r.gross);
  const fees = sum((r) => r.fees);
  const cost = sum((r) => r.cost);
  const exp = sum((r) => r.exp) + generalTotal;
  const net = gross - fees - cost - exp;
  const spend = cost + fees + exp;
  // The same sums in yen (Historical mode); undefined elsewhere so fmtMoney converts live.
  const eY = (e: { id: string }) => yv?.expenseYenById.get(e.id) ?? 0;
  const sumY = (k: keyof NonNullable<Row["y"]>) => (yv ? rows.reduce((a, r) => a + (r.y?.[k] ?? 0), 0) : undefined);
  const generalTotalY = yv ? generalExpenses.reduce((a, e) => a + eY(e), 0) : undefined;
  const Y = yv
    ? (() => {
        const g = sumY("gross")!, f = sumY("fees")!, c = sumY("cost")!, x = sumY("exp")! + generalTotalY!;
        return { gross: g, fees: f, cost: c, exp: x, net: g - f - c - x, spend: c + f + x, est: sumY("est")! };
      })()
    : undefined;

  // Header cards per metric — the FIRST one reconciles to the dashboard card.
  const header =
    metric === "gross"
      ? [
          { label: "Gross sales", value: fmtMoney(gross, m, Y?.gross), tone: "default" as const },
          { label: "Items sold", value: String(rows.length) },
          { label: "Net after all costs", value: fmtMoney(net, m, Y?.net), tone: net >= 0 ? ("good" as const) : ("bad" as const) }
        ]
      : metric === "stock"
        ? [
            { label: "Items in stock", value: String(rows.length) },
            { label: "Cost tied up", value: fmtMoney(cost, m, Y?.cost) },
            { label: "Est. resale value", value: fmtMoney(rows.reduce((a, r) => a + (r.est ?? 0), 0), m, Y?.est) }
          ]
        : metric === "flip"
          ? [
              { label: "Flip net", value: fmtMoney(net, m, Y?.net), tone: net >= 0 ? ("good" as const) : ("bad" as const) },
              { label: "Total spend", value: fmtMoney(spend, m, Y?.spend) },
              { label: "Flip ROI", value: spend > 0 ? pct(net / spend) : "—", tone: net >= 0 ? ("good" as const) : ("bad" as const) }
            ]
          : [
              { label: METRIC_INFO[metric].title.replace(" — audit", ""), value: fmtMoney(net, m, Y?.net), tone: net >= 0 ? ("good" as const) : ("bad" as const) },
              { label: "Gross − fees − cost − exp", value: `${fmtMoney(gross, m, Y?.gross)} − ${fmtMoney(fees, m, Y?.fees)} − ${fmtMoney(cost, m, Y?.cost)} − ${fmtMoney(exp, m, Y?.exp)}` },
              { label: "Line items", value: String(rows.length + generalExpenses.length) }
            ];

  const showMoneyCols = metric !== "stock";

  // Only the table body paginates — the header cards, footer totals, and grand
  // total are ALWAYS the full set so they keep reconciling to the dashboard card.
  const perPage = resolvePer(searchParams.per, (await cookies()).get("pageSize")?.value);
  const pg = paginate(rows, searchParams.page, perPage);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Dashboard</Link>
        <h1 className="mt-1 text-2xl font-bold">{METRIC_INFO[metric].title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {METRIC_INFO[metric].blurb} Showing <b>{label}</b>.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {header.map((h) => (
          <StatCard key={h.label} label={h.label} value={h.value} tone={"tone" in h ? h.tone : "default"} />
        ))}
      </div>

      <div className="card overflow-x-auto">
        <SectionTitle>Contributing items ({rows.length})</SectionTitle>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Nothing contributed in this period.</p>
        ) : (
          <table className="min-w-full rtable">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th">Item</th>
                <th className="th">Status</th>
                <th className="th">{metric === "stock" ? "Added" : "Date"}</th>
                {showMoneyCols && <th className="th">Proceeds</th>}
                {showMoneyCols && <th className="th">Fees</th>}
                <th className="th">Cost</th>
                {showMoneyCols && <th className="th">Exp</th>}
                {showMoneyCols && <th className="th">Net</th>}
              </tr>
            </thead>
            <tbody>
              {pg.rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="td cell-main" data-label="">
                    <Link href={`/items/${r.id}`} className="font-medium text-slate-800 hover:text-brand-700">{r.title}</Link>
                    <div className="text-xs text-slate-400">
                      {r.isPersonal ? "personal" : <Link href={`/lots/${r.lotId}`} className="hover:text-brand-600">{r.lotTitle}</Link>}
                    </div>
                  </td>
                  <td className="td" data-label="Status"><StatusPill status={r.status} /></td>
                  <td className="td whitespace-nowrap text-slate-500" data-label="Date">{r.date ? shortDate(r.date) : "—"}</td>
                  {showMoneyCols && <td className="td" data-label="Proceeds">{r.gross ? fmtMoney(r.gross, m, r.y?.gross) : "—"}</td>}
                  {showMoneyCols && <td className="td text-slate-500" data-label="Fees">{r.fees ? `−${fmtMoney(r.fees, m, r.y?.fees)}` : "—"}</td>}
                  <td className="td text-slate-500" data-label="Cost">{r.cost ? `−${fmtMoney(r.cost, m, r.y?.cost)}` : "—"}</td>
                  {showMoneyCols && <td className={r.exp ? (r.exp < 0 ? "td text-emerald-600" : "td text-slate-500") : "td text-slate-500"} data-label="Exp">{r.exp ? fmtDeduction(r.exp, m, r.y?.exp).text : "—"}</td>}
                  {showMoneyCols && <td className="td" data-label="Net"><Net value={r.net} m={m} yen={r.y?.net} /></td>}
                </tr>
              ))}
            </tbody>
            {showMoneyCols && (
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 font-medium">
                  {/* Full-set totals (all pages), so the audit still reconciles. */}
                  <td className="td cell-main" data-label="">All items total</td>
                  <td className="td hidden md:table-cell" />
                  <td className="td hidden md:table-cell" />
                  <td className="td" data-label="Proceeds">{fmtMoney(gross, m, Y?.gross)}</td>
                  <td className="td" data-label="Fees">−{fmtMoney(fees, m, Y?.fees)}</td>
                  <td className="td" data-label="Cost">−{fmtMoney(cost, m, Y?.cost)}</td>
                  <td className="td" data-label="Exp">{fmtDeduction(exp - generalTotal, m, Y ? Y.exp - generalTotalY! : undefined).text}</td>
                  <td className="td" data-label="Net"><Net value={net + generalTotal} m={m} yen={Y ? Y.net + generalTotalY! : undefined} /></td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
        {rows.length > 0 && <Pagination {...pg} per={perPage} />}
      </div>

      {generalExpenses.length > 0 && (
        <div className="card">
          <SectionTitle>General expenses &amp; credits (unattached, dated in period)</SectionTitle>
          <ul className="text-sm">
            {generalExpenses.map((e) => {
              const d = fmtDeduction(e.amountUsd, m, yv ? eY(e) : undefined);
              return (
                <li key={e.id} className="flex justify-between border-b border-slate-50 py-1.5 last:border-0">
                  <span className="text-slate-600">
                    {e.category}
                    {e.description && <span className="text-slate-400"> · {e.description}</span>}
                    <span className="ml-2 text-xs text-slate-400">{shortDate(e.date)}</span>
                  </span>
                  <span className={d.isCredit ? "text-emerald-600" : "text-red-600"}>{d.text}</span>
                </li>
              );
            })}
            {(() => {
              const d = fmtDeduction(generalTotal, m, generalTotalY);
              return (
                <li className="flex justify-between pt-2 font-medium">
                  <span>General total</span>
                  <span className={d.isCredit ? "text-emerald-600" : "text-red-600"}>{d.text}</span>
                </li>
              );
            })()}
          </ul>
        </div>
      )}

      {/* The gross metric reconciles via its HEADER card (gross), not this net
          figure — showing "matches the dashboard card" under a net total there
          would be wrong, so the banner is skipped for it. */}
      {showMoneyCols && metric !== "gross" && (
        <div className="card flex items-center justify-between bg-slate-50 text-sm">
          <span className="font-semibold">Grand total{generalExpenses.length > 0 ? " (items − general expenses)" : ""} — matches the dashboard card</span>
          <span className="text-base font-bold"><Net value={net} m={m} yen={Y?.net} /></span>
        </div>
      )}
    </div>
  );
}

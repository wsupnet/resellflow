import Link from "next/link";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { getFinancials, getMonthlySeries, summarizeLots, totalsYen } from "@/lib/queries";
import { tracksCondition } from "@/lib/catalog";
import { StatCard, Net, Roi, SectionTitle } from "@/components/ui";
import { MonthlyNetChart, HBarChart } from "@/components/Charts";
import { pct, moneyUnit } from "@/lib/format";
import { getMoney, fmtMoney } from "@/lib/money";
import InfoTip from "@/components/InfoTip";
import { normalizePeriod, resolveRange, type Period } from "@/lib/period";
import DashPeriod from "@/components/DashPeriod";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const bundle = await getFinancials(user.id);
  const series = await getMonthlySeries(user.id);
  const m = await getMoney(user.id);
  const t = bundle.totals;
  // Historical mode: yen totals at locked per-transaction rates (all-time figures only).
  const ty = m.currency === "JPY" && m.mode === "historical" ? totalsYen(bundle, m.rate) : null;

  // Time frame: remembered in a cookie so the dashboard opens on whatever
  // period was last viewed. Default = all time.
  const rawPeriod = cookies().get("dashPeriod")?.value;
  const period: Period = rawPeriod ? normalizePeriod(rawPeriod) : "all";
  const allTime = period === "all";
  const { start, end, label } = resolveRange(period);
  const inRange = (d: Date | string) => {
    const x = +new Date(d);
    return x >= +start && x <= +end;
  };

  // ── Realized (sold-basis) stats for the selected range, split flip/personal.
  //    Mirrors the Reports engine: a sale's revenue/fees/COGS count in the
  //    period it SOLD; general ledger expenses count by their own date. ──
  const blankR = () => ({ gross: 0, fees: 0, cogs: 0, expense: 0, items: 0 });
  const rFlip = blankR();
  const rPersonal = blankR();
  let rSales = 0;
  const soldAtByItem = new Map<string, Date>();
  for (const s of bundle.sales) {
    for (const l of s.lines) soldAtByItem.set(l.itemId, new Date(s.soldAt));
    if (!inRange(s.soldAt)) continue;
    rSales++;
    for (const l of s.lines) {
      const f = bundle.itemFin.get(l.itemId);
      if (!f) continue;
      const b = f.isPersonal ? rPersonal : rFlip;
      b.gross += f.gross;
      b.fees += f.feeShare;
      b.cogs += f.allocatedCost;
      b.expense += f.expense;
      b.items++;
    }
  }
  rFlip.expense += bundle.expenses
    .filter((e) => !e.purchaseId && !e.itemId && !e.saleId && inRange(e.date))
    .reduce((a, e) => a + e.amountUsd, 0);

  // Write-offs (lost/damaged) marked in the range: their cost is a realized loss.
  const rWO = { count: 0, cost: 0 };
  for (const p of bundle.purchases)
    for (const i of p.items) {
      if (i.status !== "LOST" && i.status !== "DAMAGED") continue;
      if (!inRange(i.writtenOffAt ?? i.createdAt)) continue;
      rWO.count++;
      rWO.cost += bundle.itemFin.get(i.id)?.allocatedCost ?? 0;
    }

  const rNet = (b: ReturnType<typeof blankR>) => b.gross - b.fees - b.cogs - b.expense;
  const rSpend = (b: ReturnType<typeof blankR>) => b.cogs + b.fees + b.expense;
  // Write-off losses land in the flip bucket (personal items have no cost basis).
  const rFlipNet = rNet(rFlip) - rWO.cost;
  const rFlipRoi = rSpend(rFlip) + rWO.cost > 0 ? rFlipNet / (rSpend(rFlip) + rWO.cost) : null;
  const rGross = rFlip.gross + rPersonal.gross;
  const rItemsSold = rFlip.items + rPersonal.items;
  const rPurchases = bundle.purchases.filter((p) => inRange(p.purchasedAt)).length;

  const itemsAll = bundle.purchases.flatMap((p) => p.items);
  // In stock = not sold and not written off (lost/damaged are out of inventory).
  const unsold = itemsAll.filter((i) => i.status === "UNLISTED" || i.status === "LISTED").length;

  // Data-hygiene gaps → deep-link into the inventory "Missing…" filter.
  const gaps = [
    { key: "category", label: "no category", n: itemsAll.filter((i) => !i.product?.category).length },
    { key: "barcode", label: "no barcode", n: itemsAll.filter((i) => !i.product?.sku).length },
    { key: "condition", label: "no condition", n: itemsAll.filter((i) => tracksCondition(i.product?.category) && !i.condition).length },
    { key: "photo", label: "no photo", n: itemsAll.filter((i) => i.photos.length === 0).length }
  ].filter((g) => g.n > 0);

  // Aging inventory: items still unsold this long since purchase, at each tier.
  // Tiers are cumulative (90+ is a subset of 60+ is a subset of 30+), so only the
  // count matters — no double-flagging in the UI, just three funnel numbers.
  const nowMs = Date.now();
  const daysUnsold = (purchasedAt: Date) => Math.floor((nowMs - +purchasedAt) / 86400000);
  const inStockAges = bundle.purchases.flatMap((p) =>
    p.items.filter((i) => i.status === "UNLISTED" || i.status === "LISTED").map(() => daysUnsold(p.purchasedAt))
  );
  const aging = [30, 60, 90].map((days) => ({ days, n: inStockAges.filter((a) => a >= days).length })).filter((a) => a.n > 0);

  // Best & worst lots by net (portfolio-level, always all-time)
  const lots = summarizeLots(bundle).sort((a, b) => b.roll.net - a.roll.net);
  const topLots = lots.slice(0, 5);

  // Top sold items by net profit (within the selected range)
  const itemTitle = new Map<string, string>();
  for (const p of bundle.purchases) for (const i of p.items) itemTitle.set(i.id, i.title);
  const topItems = [...bundle.itemFin.values()]
    .filter((f) => {
      if (!f.sold) return false;
      if (allTime) return true;
      const d = soldAtByItem.get(f.itemId);
      return d != null && inRange(d);
    })
    .sort((a, b) => b.net - a.net)
    .slice(0, 10)
    .map((f) => {
      const name = itemTitle.get(f.itemId) ?? "item";
      // Charts convert at the live rate (rate = 1 for USD). fullName feeds the hover tooltip.
      return { name: name.length > 24 ? name.slice(0, 23) + "…" : name, fullName: name, value: f.net * m.rate };
    });
  const u = moneyUnit(m);
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const chartSeries = series
    .filter((s) => allTime || (s.month >= monthKey(start) && s.month <= monthKey(end)))
    .map((s) => ({ ...s, net: s.net * m.rate, gross: s.gross * m.rate }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex gap-2">
          <Link href="/inventory" className="btn-ghost">+ Add inventory</Link>
          <Link href="/sales" className="btn-primary">+ Record sale</Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <DashPeriod current={period} />
        <span className="text-xs text-slate-400">Showing <b>{label}</b>{!allTime && " · sold-basis"}</span>
      </div>

      {allTime ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Net profit (total)"
            value={fmtMoney(t.net, m, ty?.net)}
            tone={t.net >= 0 ? "good" : "bad"}
            sub="after fees & expenses"
            href="/breakdown?metric=net-total&period=all"
            help="Your all-in cash position: everything earned from sales minus everything spent — selling fees, expenses, and the cost of ALL inventory bought, even items that haven't sold yet. It goes up as your unsold stock sells."
          />
          <StatCard
            label="Flip ROI"
            value={pct(t.flip.realizedRoi)}
            tone={(t.flip.realizedRoi ?? 0) >= 0 ? "good" : "bad"}
            sub={`on sold items · all-in ${pct(t.flip.roi)} counting unsold stock`}
            href="/breakdown?metric=flip&period=all"
            help="Return on the money you put into items that have finished selling: for every $1 spent on them (cost + fees + expenses), how much profit came back. 100% = you doubled your money. Personal belongings don't count."
          />
          <StatCard
            label="Gross sales"
            value={fmtMoney(t.gross, m, ty?.gross)}
            sub={`fees ${fmtMoney(t.fees, m, ty?.fees)} · exp ${fmtMoney(t.expenses, m, ty?.expenses)}`}
            href="/breakdown?metric=gross&period=all"
            help="The total sticker price of everything you've sold — before any fees, costs, or expenses come out. The 'top line'."
          />
          <StatCard
            label="Realized net"
            value={fmtMoney(t.realizedNet, m, ty?.realizedNet)}
            tone={t.realizedNet >= 0 ? "good" : "bad"}
            sub={t.writeOffCount > 0 ? `excl. unsold stock · incl. ${t.writeOffCount} write-off${t.writeOffCount === 1 ? "" : "s"} −${fmtMoney(t.writeOffCost, m, ty?.writeOffCost)}` : "excludes unsold inventory cost"}
            href="/breakdown?metric=realized&period=all"
            help="Profit on finished business only: sold items' proceeds minus their fees, cost, and expenses (lost/damaged items count as losses). Unlike Net profit (total), it ignores money tied up in inventory still waiting to sell."
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label={`Net profit (${label})`}
            value={fmtMoney(rFlipNet + rNet(rPersonal), m)}
            tone={rFlipNet + rNet(rPersonal) >= 0 ? "good" : "bad"}
            sub={rWO.count > 0 ? `realized · incl. ${rWO.count} write-off${rWO.count === 1 ? "" : "s"} −${fmtMoney(rWO.cost, m)}` : "realized on sales in this period"}
            href={`/breakdown?metric=realized&period=${period}`}
            help="Profit made on sales during this period: what those items sold for, minus their fees, what they cost to buy, and expenses. Lost/damaged items marked in this period count as losses."
          />
          <StatCard
            label="Flip ROI"
            value={pct(rFlipRoi)}
            tone={(rFlipRoi ?? 0) >= 0 ? "good" : "bad"}
            sub={`net / ${fmtMoney(rSpend(rFlip) + rWO.cost, m)} spend on settled items`}
            href={`/breakdown?metric=flip&period=${period}`}
            help="Return on the money behind this period's sales: for every $1 those items cost (purchase + fees + expenses), how much profit came back. 100% = doubled your money. Personal belongings don't count."
          />
          <StatCard
            label="Gross sales"
            value={fmtMoney(rGross, m)}
            sub={`fees ${fmtMoney(rFlip.fees + rPersonal.fees, m)} · exp ${fmtMoney(rFlip.expense + rPersonal.expense, m)}`}
            href={`/breakdown?metric=gross&period=${period}`}
            help="The total sticker price of everything sold in this period — before any fees, costs, or expenses come out."
          />
          <StatCard
            label="Sales"
            value={String(rSales)}
            sub={`${rItemsSold} item${rItemsSold === 1 ? "" : "s"} sold`}
            href="/sales"
            help="How many sales you recorded in this period, and how many individual items those sales included (one sale can bundle several items)."
          />
        </div>
      )}

      {(allTime ? t.personal.count > 0 : rPersonal.items > 0) && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="card lg:col-span-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                Personal belongings (separate bucket)
                <InfoTip text="Things you already owned and are selling off — they cost the business nothing to acquire. Kept separate so their 'free' profit doesn't inflate your flip ROI." />
              </div>
              <Link href={`/breakdown?metric=personal&period=${period}`} className="text-xs text-brand-600 hover:underline">audit →</Link>
            </div>
            {allTime ? (
              <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span>Net <b className="text-emerald-600">{fmtMoney(t.personal.net, m, ty?.personal.net)}</b></span>
                <span>Gross {fmtMoney(t.personal.gross, m, ty?.personal.gross)}</span>
                <span className="text-slate-500">{t.personal.count} item{t.personal.count === 1 ? "" : "s"} you already owned</span>
              </div>
            ) : (
              <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span>Net <b className="text-emerald-600">{fmtMoney(rNet(rPersonal), m)}</b></span>
                <span>Gross {fmtMoney(rPersonal.gross, m)}</span>
                <span className="text-slate-500">{rPersonal.items} sold this period</span>
              </div>
            )}
            <div className="mt-1 text-xs text-slate-400">Excluded from Flip ROI (no purchase cost). Included in total net.</div>
          </div>
          <StatCard
            label="Flip net only"
            value={allTime ? fmtMoney(t.flip.realizedNet, m, ty?.flip.realizedNet) : fmtMoney(rFlipNet, m)}
            tone={(allTime ? t.flip.realizedNet : rFlipNet) >= 0 ? "good" : "bad"}
            sub={allTime ? `sold items · all-in ${fmtMoney(t.flip.net, m, ty?.flip.net)} w/ unsold stock` : "profit from items you bought"}
            href={`/breakdown?metric=flip&period=${period}`}
            help="Profit from sold items you actually paid for — the flip business by itself, with personal belongings taken out."
          />
          <StatCard label="Items / lots" value={String(bundle.purchases.length)} sub={`${bundle.sales.length} sales`} href="/lots" help="Every purchase you've recorded — single items and multi-item lots both count as one purchase here." />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Items in stock" value={String(unsold)} sub="unlisted + listed" href="/breakdown?metric=stock" help="Items you're currently holding that haven't sold — both listed and not-yet-listed. Lost/damaged write-offs aren't counted." />
        <StatCard label="Items sold" value={String(rItemsSold)} sub={allTime ? undefined : label} href={`/breakdown?metric=gross&period=${period}`} help="How many individual items have sold (in the selected time frame)." />
        <StatCard label="Lots / purchases" value={String(rPurchases)} sub={allTime ? undefined : `bought in ${label}`} href="/lots" help="How many buys you made (in the selected time frame) — a whole lot counts as one purchase." />
        <StatCard label="Sales recorded" value={String(rSales)} sub={allTime ? undefined : label} href="/sales" help="How many sales you recorded (in the selected time frame) — one sale can include several items." />
      </div>

      {gaps.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-medium text-slate-700">Tidy up your catalog:</span>
            {gaps.map((g) => (
              <Link
                key={g.key}
                href={`/inventory?view=items&missing=${g.key}`}
                className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                {g.n} {g.label} →
              </Link>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-400">Tap a chip to filter those items, then multi-select and bulk-edit.</p>
        </div>
      )}

      {aging.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-medium text-slate-700">Aging inventory:</span>
            {aging.map((a) => (
              <Link
                key={a.days}
                href={`/inventory?view=items&age=${a.days}`}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                  a.days >= 90 ? "bg-red-50 text-red-700 hover:bg-red-100" : a.days >= 60 ? "bg-amber-50 text-amber-800 hover:bg-amber-100" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {a.n} unsold {a.days}+ days →
              </Link>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-400">Sitting a while — worth a price drop, a relist, or bundling into a lot.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <SectionTitle>Net profit by month</SectionTitle>
          <MonthlyNetChart data={chartSeries} symbol={u.symbol} decimals={u.decimals} />
        </div>
        <div className="card">
          <SectionTitle>Top items by net profit{allTime ? "" : ` (${label})`}</SectionTitle>
          <HBarChart data={topItems} symbol={u.symbol} decimals={u.decimals} />
        </div>
      </div>

      <div className="card">
        <SectionTitle action={<Link href="/lots" className="text-sm text-brand-600">View all →</Link>}>
          Top lots by net (all time)
        </SectionTitle>
        {topLots.length === 0 ? (
          <p className="text-sm text-slate-500">No purchases yet. Add some inventory to get started.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th">Lot</th>
                  <th className="th">Items</th>
                  <th className="th">Cost</th>
                  <th className="th">Net</th>
                  <th className="th">ROI</th>
                </tr>
              </thead>
              <tbody>
                {topLots.map(({ purchase, roll }) => (
                  <tr key={purchase.id} className="border-b border-slate-50">
                    <td className="td">
                      <Link href={`/lots/${purchase.id}`} className="font-medium text-brand-700">
                        {purchase.title}
                      </Link>
                    </td>
                    <td className="td text-slate-500">{roll.soldCount}/{roll.itemCount} sold</td>
                    <td className="td">{fmtMoney(roll.cost, m)}</td>
                    <td className="td"><Net value={roll.net} m={m} /></td>
                    <td className="td"><Roi value={roll.roi} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

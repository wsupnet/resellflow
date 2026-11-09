import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getProductUnits, getProductSales, ROI_MIN_SALES } from "@/lib/queries";
import { tracksCondition } from "@/lib/catalog";
import SaleBreakdownCard from "@/components/SaleBreakdownCard";
import { StatCard, Net, Roi, StatusPill } from "@/components/ui";
import ProductRename from "@/components/ProductRename";
import { shortDate, purchaseDate } from "@/lib/format";
import { getMoney, fmtMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

/** Every unit you've had of one product, each with its purchase date and an edit link. */
export default async function ProductPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ condition?: string; sales?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const product = await prisma.product.findFirst({ where: { id: params.id, userId: user.id } });
  if (!product) notFound();

  // Opened from Insights: one condition (condition-tracked products) and the same
  // "individual sales only" choice, so the totals match the row clicked.
  const tracks = tracksCondition(product.category);
  const condition = tracks && searchParams.condition ? searchParams.condition : null;
  const individualOnly = searchParams.sales === "individual";
  const [allUnits, sales, m] = await Promise.all([
    getProductUnits(user.id, product.id),
    getProductSales(user.id, product.id, { condition, individualOnly }),
    getMoney(user.id)
  ]);
  const conditions = tracks ? [...new Set(allUnits.map((u) => u.condition || "Unspecified"))].sort() : [];
  const units = condition ? allUnits.filter((u) => (u.condition || "Unspecified") === condition) : allUnits;
  const qs = (o: { condition?: string | null; sales?: string }) => {
    const p = new URLSearchParams();
    const c = o.condition === undefined ? condition : o.condition;
    const sa = o.sales ?? (individualOnly ? "individual" : "");
    if (c) p.set("condition", c);
    if (sa) p.set("sales", sa);
    const q = p.toString();
    return q ? `?${q}` : "?";
  };

  // How the Insights averages come out of these sales.
  const counted = sales.filter((x) => x.counted);
  const roiSales = counted.filter((x) => x.roi != null);
  const avgRoi = roiSales.length ? roiSales.reduce((a, x) => a + x.roi!, 0) / roiSales.length : null;
  const totalNet = counted.reduce((a, x) => a + x.net, 0);
  const dayed = counted.filter((x) => x.daysToSell != null);
  const avgDays = dayed.length ? dayed.reduce((a, x) => a + x.daysToSell!, 0) / dayed.length : null;
  const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
  const inStock = units.filter((u) => u.status === "UNLISTED" || u.status === "LISTED");
  const sold = units.filter((u) => u.status === "SOLD");
  const avgSale = sold.length ? sold.reduce((a, u) => a + u.gross, 0) / sold.length : null;
  const tiedUp = inStock.reduce((a, u) => a + u.allocatedCost, 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/inventory" className="text-sm text-brand-600">← Inventory</Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{product.name}</h1>
          <ProductRename productId={product.id} name={product.name} />
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {product.sku && <span className="font-mono">{product.sku} · </span>}
          {product.category ?? "no category"}
          {product.compPrice != null && <> · comp {fmtMoney(product.compPrice, m)}</>}
        </p>
      </div>

      {(conditions.length > 1 || individualOnly || condition) && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {conditions.length > 0 && (
            <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
              <Link href={qs({ condition: null })} scroll={false} className={`rounded px-2 py-1 font-medium ${!condition ? "bg-white shadow-sm" : "text-slate-500"}`}>
                All conditions
              </Link>
              {conditions.map((c) => (
                <Link key={c} href={qs({ condition: c })} scroll={false} className={`rounded px-2 py-1 font-medium ${condition === c ? "bg-white shadow-sm" : "text-slate-500"}`}>
                  {c === "Unspecified" ? "Unspecified" : c}
                </Link>
              ))}
            </div>
          )}
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            <Link href={qs({ sales: "" })} scroll={false} className={`rounded px-2 py-1 font-medium ${!individualOnly ? "bg-white shadow-sm" : "text-slate-500"}`}>
              All sales
            </Link>
            <Link href={qs({ sales: "individual" })} scroll={false} className={`rounded px-2 py-1 font-medium ${individualOnly ? "bg-white shadow-sm" : "text-slate-500"}`}>
              Individual sales only
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="In stock" value={String(inStock.length)} sub={`${inStock.filter((u) => u.status === "LISTED").length} listed`} />
        <StatCard label="Sold" value={String(sold.length)} />
        <StatCard label="Avg sale" value={avgSale == null ? "—" : fmtMoney(avgSale, m)} />
        <StatCard label="Cost tied up" value={fmtMoney(tiedUp, m)} sub="in-stock units" />
      </div>

      <div className="card">
        <h2 className="mb-1 text-lg font-semibold">Sales breakdown ({sales.length})</h2>
        {sales.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            {condition ? `No ${condition} units of this product have sold yet.` : "None of these have sold yet."}
          </p>
        ) : (
          <>
            <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>Sales counted: <b>{counted.length}</b>{counted.length < sales.length && <span className="text-slate-400"> of {sales.length}</span>}</span>
                <span>Total net: <b><Net value={totalNet} m={m} /></b></span>
                <span>Avg ROI: <b><Roi value={avgRoi} /></b></span>
                <span>Avg days to sell: <b>{avgDays == null ? "—" : `${Math.round(avgDays)}d`}</b></span>
              </div>
              {avgRoi != null && (
                <p className="mt-2 text-xs text-slate-500">
                  Avg ROI is the average of each sale&apos;s own ROI:{" "}
                  {roiSales.length === 1 ? (
                    <>one sale at {pct(roiSales[0].roi!)}</>
                  ) : roiSales.length <= 8 ? (
                    <>({roiSales.map((x) => pct(x.roi!)).join(" + ")}) ÷ {roiSales.length} = {pct(avgRoi)}</>
                  ) : (
                    <>{roiSales.length} sales averaging {pct(avgRoi)}</>
                  )}
                  . Each sale&apos;s ROI is its net ÷ what it cost you (purchase share + fees + expenses).
                  {counted.length < ROI_MIN_SALES && ` With fewer than ${ROI_MIN_SALES} sales, treat it as a rough guide.`}
                  {counted.length < sales.length && " Bundle sales are left out because Individual sales only is on."}
                </p>
              )}
            </div>
            <div className="space-y-3">
              {sales.map((x) => (
                <SaleBreakdownCard key={x.itemId} s={x} m={m} />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h2 className="mb-1 text-lg font-semibold">Units ({units.length})</h2>
        <p className="mb-3 text-xs text-slate-400">Open a unit to edit it, including its purchase date.</p>
        {units.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No items are linked to this product.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full rtable">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th">Unit</th>
                  <th className="th">Status</th>
                  <th className="th">Purchased</th>
                  <th className="th">From</th>
                  <th className="th">Cost</th>
                  <th className="th">Sold</th>
                  <th className="th">Net</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="td cell-main" data-label="">
                      <div className="flex items-center gap-2">
                        {u.thumbId ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/photo/${u.thumbId}?size=thumb`} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                        ) : (
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-300">▦</span>
                        )}
                        <div>
                          <Link href={`/items/${u.id}`} className="font-medium text-slate-800 hover:text-brand-700">{u.title}</Link>
                          {u.condition && <div className="text-xs text-slate-500">{u.condition}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="td" data-label="Status"><StatusPill status={u.status} /></td>
                    <td className="td whitespace-nowrap text-slate-500" data-label="Purchased">{purchaseDate(u)}</td>
                    <td className="td text-slate-500" data-label="From">
                      {u.isLot ? <Link href={`/lots/${u.purchaseId}`} className="hover:text-brand-700">lot: {u.purchaseTitle}</Link> : u.source}
                    </td>
                    <td className="td" data-label="Cost">{fmtMoney(u.allocatedCost, m)}</td>
                    <td className="td whitespace-nowrap" data-label="Sold">
                      {u.soldAt ? <>{fmtMoney(u.gross, m)} <span className="text-xs text-slate-400">{shortDate(u.soldAt)}</span></> : "—"}
                    </td>
                    <td className="td" data-label="Net"><Net value={u.net} m={m} /></td>
                    <td className="td cell-action text-right" data-label="">
                      <Link href={`/items/${u.id}`} className="text-xs font-medium text-brand-600">Edit →</Link>
                    </td>
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

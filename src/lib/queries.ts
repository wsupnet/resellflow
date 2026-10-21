import "server-only";
import { prisma } from "./db";
import { variantKey, variantLabel, tracksCondition } from "./catalog";
import {
  computeItemFinancials,
  rollupLot,
  computeTotals,
  type FinLot,
  type FinSale,
  type FinExpense,
  type ItemFinancials,
  type Totals
} from "./finance";

/**
 * Loads a user's full sourcing/selling dataset and computes all financials in
 * memory. The dataset is small (hundreds–low thousands of rows) so this is fast
 * and keeps the lot-allocation / cross-lot logic in one place.
 */
export async function getFinancials(userId: string) {
  const [purchases, sales, expenses] = await Promise.all([
    prisma.purchase.findMany({
      where: { userId },
      include: {
        items: {
          include: { saleLine: true, product: true, photos: { select: { id: true }, orderBy: { order: "asc" } } },
          orderBy: { createdAt: "asc" }
        }
      },
      orderBy: { purchasedAt: "desc" }
    }),
    prisma.sale.findMany({
      where: { userId },
      include: { lines: { include: { item: true } } },
      orderBy: { soldAt: "desc" }
    }),
    prisma.expense.findMany({ where: { userId }, orderBy: { date: "desc" } })
  ]);

  const finExpenses = expenses.map((e) => ({
    amountUsd: e.amountUsd,
    purchaseId: e.purchaseId,
    itemId: e.itemId,
    saleId: e.saleId
  }));
  const generalExpense = expenses
    .filter((e) => !e.purchaseId && !e.itemId && !e.saleId)
    .reduce((a, e) => a + e.amountUsd, 0);

  const finLots: FinLot[] = purchases.map((p) => ({
    id: p.id,
    costUsd: p.costUsd,
    taxUsd: p.taxUsd,
    isPersonal: p.isPersonal,
    items: p.items.map((i) => ({
      id: i.id,
      status: i.status,
      estimatedValue: i.estimatedValue,
      costOverrideUsd: i.costOverrideUsd,
      salePrice: i.saleLine?.salePrice ?? null
    }))
  }));

  const finSales: FinSale[] = sales.map((s) => ({
    id: s.id,
    shippingFee: s.shippingFee,
    ebayFee: s.ebayFee,
    mercariFee: s.mercariFee,
    adFee: s.adFee,
    lines: s.lines.map((l) => ({ itemId: l.itemId, salePrice: l.salePrice }))
  }));

  const itemFin = computeItemFinancials(finLots, finSales, finExpenses);
  const totals = computeTotals(finLots, itemFin, generalExpense);

  return { purchases, sales, expenses, finLots, itemFin, totals };
}

export type FinancialsBundle = Awaited<ReturnType<typeof getFinancials>>;

/**
 * Re-express the whole dataset in yen using each transaction's LOCKED rate
 * (Purchase.fxRate for cost, Sale.fxRate for proceeds/fees), falling back to the
 * live rate for records saved before rates were captured. Because the finance
 * math is proportional and currency-agnostic, we can run the exact same engine on
 * these yen inputs to get correct historical yen totals/lots/items.
 * `live` is JPY per USD.
 */
export function buildYen(bundle: FinancialsBundle, live: number) {
  const jpy = (fx?: number | null) => (fx && fx > 0 ? 1 / fx : live); // stored fxRate is USD per JPY

  const saleRateOfItem = new Map<string, number>();
  const saleRateById = new Map<string, number>();
  for (const s of bundle.sales) {
    const r = jpy(s.fxRate);
    saleRateById.set(s.id, r);
    for (const l of s.lines) saleRateOfItem.set(l.itemId, r);
  }
  const purchaseRateById = new Map<string, number>();

  // Wherever the EXACT entered-yen amount was stored (costJpy/taxJpy/priceJpy/
  // fee *Jpy/costOverrideJpy), use it verbatim; otherwise convert at the locked
  // (or live-fallback) rate.
  const lotsYen: FinLot[] = bundle.purchases.map((p) => {
    const pr = jpy(p.fxRate);
    purchaseRateById.set(p.id, pr);
    return {
      id: p.id,
      isPersonal: p.isPersonal,
      costUsd: p.costJpy ?? p.costUsd * pr,
      taxUsd: p.taxJpy ?? p.taxUsd * pr,
      items: p.items.map((i) => ({
        id: i.id,
        status: i.status,
        estimatedValue: i.estimatedValue != null ? i.estimatedValue * pr : null,
        costOverrideUsd: i.costOverrideUsd != null ? i.costOverrideJpy ?? i.costOverrideUsd * pr : null,
        salePrice: i.saleLine ? i.saleLine.priceJpy ?? i.saleLine.salePrice * (saleRateOfItem.get(i.id) ?? pr) : null
      }))
    };
  });

  const salesYen: FinSale[] = bundle.sales.map((s) => {
    const r = jpy(s.fxRate);
    return {
      id: s.id,
      shippingFee: s.shippingFeeJpy ?? s.shippingFee * r,
      ebayFee: s.ebayFeeJpy ?? s.ebayFee * r,
      mercariFee: s.mercariFeeJpy ?? s.mercariFee * r,
      adFee: s.adFeeJpy ?? s.adFee * r,
      lines: s.lines.map((l) => ({ itemId: l.itemId, salePrice: l.priceJpy ?? l.salePrice * r }))
    };
  });

  const expenseYenById = new Map<string, number>();
  const expensesYen: FinExpense[] = bundle.expenses.map((e) => {
    let r = live;
    if (e.saleId && saleRateById.has(e.saleId)) r = saleRateById.get(e.saleId)!;
    else if (e.purchaseId && purchaseRateById.has(e.purchaseId)) r = purchaseRateById.get(e.purchaseId)!;
    else if (e.itemId && saleRateOfItem.has(e.itemId)) r = saleRateOfItem.get(e.itemId)!;
    const amt = e.amountUsd * r;
    expenseYenById.set(e.id, amt);
    return { amountUsd: amt, purchaseId: e.purchaseId, itemId: e.itemId, saleId: e.saleId };
  });

  const itemFinYen = computeItemFinancials(lotsYen, salesYen, expensesYen);
  const generalYen = expensesYen.filter((e) => !e.purchaseId && !e.itemId && !e.saleId).reduce((a, e) => a + e.amountUsd, 0);
  const lotsYenById = new Map(lotsYen.map((l) => [l.id as string, l]));
  return { lotsYen, lotsYenById, itemFinYen, generalYen, expenseYenById };
}

/** Portfolio totals in yen at locked rates (for Historical mode). */
export function totalsYen(bundle: FinancialsBundle, live: number): Totals {
  const y = buildYen(bundle, live);
  return computeTotals(y.lotsYen, y.itemFinYen, y.generalYen);
}

/**
 * Full breakdown for a single item: its financials plus a line-by-line split of
 * the fees and ledger expenses attributed to it (sale fees and lot/sale-level
 * expenses are split by this item's share, the same way the totals are computed).
 */
export async function getItemDetail(userId: string, itemId: string) {
  const bundle = await getFinancials(userId);

  let item: (typeof bundle.purchases)[number]["items"][number] | null = null;
  let lot: (typeof bundle.purchases)[number] | null = null;
  for (const p of bundle.purchases) {
    const found = p.items.find((i) => i.id === itemId);
    if (found) {
      item = found;
      lot = p;
      break;
    }
  }
  if (!item || !lot) return null;

  const fin = bundle.itemFin.get(itemId) ?? null;

  // Locate the sale this item was sold on and its share of that sale.
  let sale: (typeof bundle.sales)[number] | null = null;
  let weight = 0;
  for (const s of bundle.sales) {
    const line = s.lines.find((l) => l.itemId === itemId);
    if (line) {
      sale = s;
      const sum = s.lines.reduce((a, l) => a + l.salePrice, 0);
      weight = sum > 0 ? line.salePrice / sum : 1 / s.lines.length;
      break;
    }
  }

  const fees = sale
    ? [
        { label: "Shipping", amount: sale.shippingFee * weight },
        { label: "eBay fee", amount: sale.ebayFee * weight },
        { label: "Mercari fee", amount: sale.mercariFee * weight },
        { label: "Ad fee", amount: sale.adFee * weight }
      ].filter((f) => Math.abs(f.amount) > 0.005)
    : [];

  // Lot-attached expenses split by each item's allocated cost.
  const lotCostByItem = new Map(lot.items.map((i) => [i.id, bundle.itemFin.get(i.id)?.allocatedCost ?? 0]));
  const lotCostSum = [...lotCostByItem.values()].reduce((a, b) => a + b, 0);

  const expenses: { label: string; category: string; amount: number; scope: string }[] = [];
  for (const e of bundle.expenses) {
    if (e.itemId === itemId) {
      expenses.push({ label: e.description || e.category, category: e.category, amount: e.amountUsd, scope: "this item" });
    } else if (sale && e.saleId === sale.id) {
      expenses.push({ label: e.description || e.category, category: e.category, amount: e.amountUsd * weight, scope: "share of sale" });
    } else if (e.purchaseId === lot.id) {
      const w = lotCostSum > 0 ? (lotCostByItem.get(itemId) ?? 0) / lotCostSum : 1 / lot.items.length;
      expenses.push({ label: e.description || e.category, category: e.category, amount: e.amountUsd * w, scope: "share of lot" });
    }
  }

  // Days to sell (purchase → sold), or days in stock so far if unsold.
  const purchaseMs = +new Date(lot.purchasedAt);
  let daysToSell: number | null = null;
  let daysInStock: number | null = null;
  if (sale) daysToSell = Math.max(0, Math.round((+new Date(sale.soldAt) - purchaseMs) / 86400000));
  else daysInStock = Math.max(0, Math.round((Date.now() - purchaseMs) / 86400000));

  // How many of this exact variant (product + condition) you've sold before.
  const cat = item.product?.category ?? null;
  const myKey = item.product ? variantKey(item.product.id, cat, item.condition) : `item:${item.id}`;
  let variantSold = 0;
  let variantDaysSum = 0;
  let variantDaysN = 0;
  for (const p of bundle.purchases) {
    for (const i of p.items) {
      const k = i.product ? variantKey(i.product.id, i.product.category, i.condition) : `item:${i.id}`;
      if (k !== myKey) continue;
      const f = bundle.itemFin.get(i.id);
      if (!f?.sold) continue;
      variantSold++;
      const sd = bundle.sales.find((s) => s.lines.some((l) => l.itemId === i.id))?.soldAt;
      if (sd) { variantDaysSum += Math.max(0, Math.round((+new Date(sd) - +new Date(p.purchasedAt)) / 86400000)); variantDaysN++; }
    }
  }
  const variantAvgDaysToSell = variantDaysN ? variantDaysSum / variantDaysN : null;
  const tracksCond = tracksCondition(cat);

  return { item, lot, fin, sale, fees, expenses, daysToSell, daysInStock, variantSold, variantAvgDaysToSell, tracksCond };
}

/** All of a user's saved sourcing locations (for pickers + the Locations page). */
export async function listLocations(userId: string) {
  return prisma.location.findMany({ where: { userId }, orderBy: { name: "asc" } });
}

/** Lot summaries with rolled-up profitability. */
export function summarizeLots(bundle: FinancialsBundle) {
  return bundle.purchases.map((p, idx) => {
    const roll = rollupLot(bundle.finLots[idx], bundle.itemFin);
    return { purchase: p, roll };
  });
}

/** Monthly net-profit series for charts (by sale month). */
export async function getMonthlySeries(userId: string) {
  const bundle = await getFinancials(userId);
  const byMonth = new Map<string, { gross: number; net: number; fees: number }>();

  for (const sale of bundle.sales) {
    const key = new Date(sale.soldAt).toISOString().slice(0, 7); // YYYY-MM
    const entry = byMonth.get(key) ?? { gross: 0, net: 0, fees: 0 };
    for (const line of sale.lines) {
      const f = bundle.itemFin.get(line.itemId);
      if (!f) continue;
      entry.gross += f.gross;
      entry.fees += f.feeShare;
      entry.net += f.net;
    }
    byMonth.set(key, entry);
  }

  // Write-offs (lost/damaged) are realized losses in the month they were marked —
  // so the monthly net dips like the dashboard cards do, instead of ignoring them.
  for (const p of bundle.purchases)
    for (const i of p.items) {
      if (i.status !== "LOST" && i.status !== "DAMAGED") continue;
      const key = new Date(i.writtenOffAt ?? i.createdAt).toISOString().slice(0, 7);
      const entry = byMonth.get(key) ?? { gross: 0, net: 0, fees: 0 };
      entry.net -= bundle.itemFin.get(i.id)?.allocatedCost ?? 0;
      byMonth.set(key, entry);
    }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));
}

export interface SeasonalityData {
  // 12 rows (Jan…Dec), aggregating every year together.
  byMonth: { month: number; label: string; units: number; gross: number; net: number }[];
  // Per category: which calendar month it sells the most (by units), + totals.
  byCategory: { category: string; peakMonth: string; units: number; gross: number; net: number }[];
  yearsSpanned: number; // distinct calendar years with a sale — for the "thin data" note
  totalSales: number;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Month-of-year SEASONALITY: fold every year onto a single Jan–Dec axis so
 * recurring seasonal patterns surface (holidays, back-to-school, etc.). A sale's
 * revenue/net counts in the calendar month it sold. Also computes each category's
 * peak selling month.
 */
export async function getSeasonality(userId: string): Promise<SeasonalityData> {
  const bundle = await getFinancials(userId);

  const months = MONTH_LABELS.map((label, i) => ({ month: i, label, units: 0, gross: 0, net: 0 }));
  // category -> per-month {units, gross, net}
  const cat = new Map<string, { units: number; gross: number; net: number }[]>();
  const years = new Set<number>();
  let totalSales = 0;

  const catOf = new Map<string, string | null>();
  for (const p of bundle.purchases) for (const i of p.items) catOf.set(i.id, i.product?.category ?? null);

  for (const s of bundle.sales) {
    const d = new Date(s.soldAt);
    const mi = d.getMonth();
    years.add(d.getFullYear());
    totalSales++;
    for (const l of s.lines) {
      const f = bundle.itemFin.get(l.itemId);
      if (!f) continue;
      months[mi].units += 1;
      months[mi].gross += f.gross;
      months[mi].net += f.net;

      const c = catOf.get(l.itemId) || "Uncategorized";
      const arr = cat.get(c) ?? MONTH_LABELS.map(() => ({ units: 0, gross: 0, net: 0 }));
      arr[mi].units += 1;
      arr[mi].gross += f.gross;
      arr[mi].net += f.net;
      cat.set(c, arr);
    }
  }

  const byCategory = [...cat.entries()]
    .map(([category, arr]) => {
      let peak = 0;
      for (let i = 1; i < 12; i++) if (arr[i].units > arr[peak].units) peak = i;
      const units = arr.reduce((a, b) => a + b.units, 0);
      const gross = arr.reduce((a, b) => a + b.gross, 0);
      const net = arr.reduce((a, b) => a + b.net, 0);
      return { category, peakMonth: units > 0 ? MONTH_LABELS[peak] : "—", units, gross, net };
    })
    .sort((a, b) => b.units - a.units);

  return { byMonth: months, byCategory, yearsSpanned: years.size, totalSales };
}

export interface VariantStat {
  key: string; // product, or product+condition for condition-tracked categories
  productId: string;
  name: string; // display label (includes condition when tracked)
  baseName: string; // product name without condition
  category: string | null;
  condition: string | null;
  sku: string | null;
  compPrice: number | null;
  timesSold: number;
  totalNet: number;
  avgNet: number | null;
  avgRoi: number | null;
  totalCost: number;
  avgBuyPrice: number | null; // avg acquisition cost per unit (USD), sold + in-stock
  avgSalePrice: number | null;
  recentAvg: number | null; // avg of the last 3 sales
  lastSalePrice: number | null;
  lastSaleDate: string | null;
  avgDaysToSell: number | null; // purchase date → sold date
  score: number; // blended buy-more score
  inStock: number;
  listed: number;
  costTiedUp: number;
  thumbId: string | null;
}

/**
 * Per-variant stats — grouped by product, and further by condition for
 * condition-tracked categories (games/movies/etc.). Powers insights, the deal
 * checker, and the inventory stock view, including avg days-to-sell (demand).
 */
export async function getVariantStats(userId: string): Promise<VariantStat[]> {
  const bundle = await getFinancials(userId);

  // item -> sale date + gross; item -> purchase date.
  const saleOf = new Map<string, number>();
  for (const s of bundle.sales) for (const l of s.lines) saleOf.set(l.itemId, +new Date(s.soldAt));
  const purchaseOf = new Map<string, number>();
  for (const p of bundle.purchases) for (const i of p.items) purchaseOf.set(i.id, +new Date(p.purchasedAt));

  interface Agg {
    productId: string;
    baseName: string;
    category: string | null;
    condition: string | null;
    sku: string | null;
    compPrice: number | null;
    thumbId: string | null;
    net: number;
    cost: number;
    buyCostSum: number; // acquisition cost of every unit (sold + in-stock)
    buyN: number;
    roiSum: number;
    roiN: number;
    sold: number;
    sales: { price: number; date: number }[];
    daysSum: number;
    daysN: number;
    inStock: number;
    listed: number;
    costTiedUp: number;
  }
  const agg = new Map<string, Agg>();

  for (const p of bundle.purchases) {
    for (const i of p.items) {
      const cat = i.product?.category ?? null;
      const cond = tracksCondition(cat) ? i.condition ?? "Unspecified" : null;
      const productId = i.product?.id ?? `item:${i.id}`;
      const key = i.product ? variantKey(productId, cat, i.condition) : productId;
      const a =
        agg.get(key) ??
        {
          productId,
          baseName: i.product?.name ?? i.title,
          category: cat,
          condition: cond,
          sku: i.product?.sku ?? null,
          compPrice: i.product?.compPrice ?? null,
          thumbId: null,
          net: 0, cost: 0, buyCostSum: 0, buyN: 0, roiSum: 0, roiN: 0, sold: 0, sales: [], daysSum: 0, daysN: 0, inStock: 0, listed: 0, costTiedUp: 0
        };
      if (!a.thumbId && i.photos[0]) a.thumbId = i.photos[0].id;
      const fin = bundle.itemFin.get(i.id);
      // Average acquisition cost spans every unit you've handled, sold or not.
      if (fin) { a.buyCostSum += fin.allocatedCost; a.buyN++; }
      if (fin?.sold) {
        a.net += fin.net;
        a.cost += fin.allocatedCost;
        if (fin.roi != null) { a.roiSum += fin.roi; a.roiN++; }
        a.sold++;
        const date = saleOf.get(i.id) ?? 0;
        a.sales.push({ price: fin.gross, date });
        const pd = purchaseOf.get(i.id);
        if (date && pd) { a.daysSum += Math.max(0, Math.round((date - pd) / 86400000)); a.daysN++; }
      } else if (i.status !== "LOST" && i.status !== "DAMAGED") {
        // Written-off items are neither stock nor tied-up cost (the money is gone).
        a.inStock++;
        if (i.status === "LISTED") a.listed++;
        a.costTiedUp += fin?.allocatedCost ?? 0;
      }
      agg.set(key, a);
    }
  }

  const stats: VariantStat[] = [...agg.entries()].map(([key, a]) => {
    const sales = a.sales.sort((x, y) => y.date - x.date);
    const avgSalePrice = a.sold ? sales.reduce((s, x) => s + x.price, 0) / a.sold : null;
    const recent = sales.slice(0, 3);
    const recentAvg = recent.length ? recent.reduce((s, x) => s + x.price, 0) / recent.length : null;
    const avgNet = a.sold ? a.net / a.sold : null;
    const avgRoi = a.roiN ? a.roiSum / a.roiN : null;
    const freqFactor = Math.log2(1 + a.sold);
    const roiFactor = 1 + Math.max(-0.5, Math.min(2, avgRoi ?? 0));
    return {
      key,
      productId: a.productId,
      name: variantLabel(a.baseName, a.category, a.condition === "Unspecified" ? null : a.condition),
      baseName: a.baseName,
      category: a.category,
      condition: a.condition,
      sku: a.sku,
      compPrice: a.compPrice,
      timesSold: a.sold,
      totalNet: a.net,
      avgNet,
      avgRoi,
      totalCost: a.cost,
      avgBuyPrice: a.buyN ? a.buyCostSum / a.buyN : null,
      avgSalePrice,
      recentAvg,
      lastSalePrice: sales[0]?.price ?? null,
      lastSaleDate: sales[0]?.date ? new Date(sales[0].date).toISOString() : null,
      avgDaysToSell: a.daysN ? a.daysSum / a.daysN : null,
      score: (avgNet ?? 0) * freqFactor * roiFactor,
      inStock: a.inStock,
      listed: a.listed,
      costTiedUp: a.costTiedUp,
      thumbId: a.thumbId
    };
  });

  return stats;
}

export interface ReportData {
  gross: number;
  fees: number;
  cogs: number; // cost of goods sold (allocated cost of items sold in the period)
  attributedExpenses: number; // ledger expenses tied to those sold items/lots/sales
  generalExpenses: number; // unattached ledger expenses dated in the period
  writeOffCost: number; // allocated cost of items marked lost/damaged in the period
  writeOffCount: number;
  net: number;
  totalSpend: number; // cogs + fees + all expenses (the ROI denominator)
  roi: number | null;
  itemsSold: number;
  salesCount: number;
  monthly: { month: string; gross: number; net: number }[];
  byPlatform: { key: string; count: number; gross: number; net: number; grossYen?: number; netYen?: number }[];
  bySource: { key: string; count: number; gross: number; net: number; grossYen?: number; netYen?: number }[];
  byLocation: { key: string; count: number; gross: number; net: number; grossYen?: number; netYen?: number }[];
  byCategory: { key: string; amount: number; amountYen?: number }[];
  // Present only in Historical mode: the same figures at locked per-transaction rates.
  grossYen?: number;
  feesYen?: number;
  cogsYen?: number;
  attributedExpensesYen?: number;
  generalExpensesYen?: number;
  writeOffCostYen?: number;
  netYen?: number;
  totalSpendYen?: number;
}

/**
 * Realized (sold-basis) P&L for a date range: a sale's revenue, fees, and the
 * cost of the items on it are all recognized in the period the sale happened
 * (soldAt). Unattached ledger expenses are recognized by their own date. Reuses
 * the per-item financials so the numbers reconcile with everything else.
 */
export async function getReport(userId: string, start: Date, end: Date, hist?: { live: number }): Promise<ReportData> {
  const bundle = await getFinancials(userId);
  const inRange = (d: Date) => d >= start && d <= end;

  // Historical mode: the same figures re-expressed in yen at locked rates.
  const yen = hist ? buildYen(bundle, hist.live) : null;
  const finY = (id: string) => yen?.itemFinYen.get(id);

  const saleByItem = new Map<string, (typeof bundle.sales)[number]>();
  for (const s of bundle.sales) for (const l of s.lines) saleByItem.set(l.itemId, s);
  const locations = await prisma.location.findMany({ where: { userId }, select: { id: true, name: true } });
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const sourceByItem = new Map<string, string>();
  const locationByItem = new Map<string, string>();
  for (const p of bundle.purchases)
    for (const i of p.items) {
      sourceByItem.set(i.id, p.source);
      locationByItem.set(i.id, p.locationId ? locName.get(p.locationId) ?? "— unknown —" : "— unassigned —");
    }

  type Grp = { count: number; gross: number; net: number; grossYen: number; netYen: number };
  const grp = (): Grp => ({ count: 0, gross: 0, net: 0, grossYen: 0, netYen: 0 });
  let gross = 0, fees = 0, cogs = 0, attributedExpenses = 0, net = 0, itemsSold = 0;
  let grossYen = 0, feesYen = 0, cogsYen = 0, attributedExpensesYen = 0, netYen = 0;
  const bySource = new Map<string, Grp>();
  const byLocation = new Map<string, Grp>();
  const monthly = new Map<string, { gross: number; net: number }>();

  for (const [itemId, f] of bundle.itemFin) {
    if (!f.sold) continue;
    const s = saleByItem.get(itemId);
    if (!s || !inRange(new Date(s.soldAt))) continue;
    const fy = finY(itemId);
    gross += f.gross; fees += f.feeShare; cogs += f.allocatedCost; attributedExpenses += f.expense; net += f.net;
    grossYen += fy?.gross ?? 0; feesYen += fy?.feeShare ?? 0; cogsYen += fy?.allocatedCost ?? 0; attributedExpensesYen += fy?.expense ?? 0; netYen += fy?.net ?? 0;
    itemsSold++;

    const src = sourceByItem.get(itemId) ?? "Unknown";
    const sc = bySource.get(src) ?? grp();
    sc.count++; sc.gross += f.gross; sc.net += f.net; sc.grossYen += fy?.gross ?? 0; sc.netYen += fy?.net ?? 0; bySource.set(src, sc);

    const loc = locationByItem.get(itemId) ?? "— unassigned —";
    const lc = byLocation.get(loc) ?? grp();
    lc.count++; lc.gross += f.gross; lc.net += f.net; lc.grossYen += fy?.gross ?? 0; lc.netYen += fy?.net ?? 0; byLocation.set(loc, lc);

    const mk = new Date(s.soldAt).toISOString().slice(0, 7);
    const m = monthly.get(mk) ?? { gross: 0, net: 0 };
    m.gross += f.gross; m.net += f.net; monthly.set(mk, m);
  }

  // Sales in the period → platform breakdown + count.
  const salesInPeriod = bundle.sales.filter((s) => inRange(new Date(s.soldAt)));
  const byPlatform = new Map<string, Grp>();
  for (const s of salesInPeriod) {
    const g = s.lines.reduce((a, l) => a + l.salePrice, 0);
    const n = s.lines.reduce((a, l) => a + (bundle.itemFin.get(l.itemId)?.net ?? 0), 0);
    const gy = s.lines.reduce((a, l) => a + (finY(l.itemId)?.gross ?? 0), 0);
    const ny = s.lines.reduce((a, l) => a + (finY(l.itemId)?.net ?? 0), 0);
    const p = byPlatform.get(s.platform) ?? grp();
    p.count++; p.gross += g; p.net += n; p.grossYen += gy; p.netYen += ny; byPlatform.set(s.platform, p);
  }

  // Write-offs (lost/damaged) recognized in the period they were marked — their
  // allocated cost is a realized loss, like COGS with no revenue against it.
  let writeOffCost = 0, writeOffCount = 0, writeOffCostYen = 0;
  for (const p of bundle.purchases)
    for (const i of p.items) {
      if (i.status !== "LOST" && i.status !== "DAMAGED") continue;
      // Older records without a stamp fall back to their created date.
      const woDate = new Date(i.writtenOffAt ?? i.createdAt);
      if (!inRange(woDate)) continue;
      const c = bundle.itemFin.get(i.id)?.allocatedCost ?? 0;
      writeOffCost += c;
      writeOffCostYen += finY(i.id)?.allocatedCost ?? 0;
      writeOffCount++;
      // Reflect the loss in the monthly trend so the chart matches the net figure.
      const mk = woDate.toISOString().slice(0, 7);
      const mm = monthly.get(mk) ?? { gross: 0, net: 0 };
      mm.net -= c;
      monthly.set(mk, mm);
    }

  // Ledger expenses dated in the period: category breakdown + general (unattached) total.
  let generalExpenses = 0, generalExpensesYen = 0;
  const byCategory = new Map<string, { amount: number; amountYen: number }>();
  for (const e of bundle.expenses) {
    if (!inRange(new Date(e.date))) continue;
    const ey = yen?.expenseYenById.get(e.id) ?? 0;
    const c = byCategory.get(e.category) ?? { amount: 0, amountYen: 0 };
    c.amount += e.amountUsd; c.amountYen += ey; byCategory.set(e.category, c);
    if (!e.purchaseId && !e.itemId && !e.saleId) { generalExpenses += e.amountUsd; generalExpensesYen += ey; }
  }

  const netFinal = net - generalExpenses - writeOffCost; // net already nets out fees, cogs, attributed expenses
  const totalSpend = cogs + fees + attributedExpenses + generalExpenses + writeOffCost;
  const netFinalYen = netYen - generalExpensesYen - writeOffCostYen;
  const totalSpendYen = cogsYen + feesYen + attributedExpensesYen + generalExpensesYen + writeOffCostYen;

  const grpOut = (m: Map<string, Grp>, lower = false) =>
    [...m.entries()]
      .map(([key, v]) => ({ key: lower ? key.toLowerCase() : key, count: v.count, gross: v.gross, net: v.net, ...(hist ? { grossYen: v.grossYen, netYen: v.netYen } : {}) }))
      .sort((a, b) => b.net - a.net);

  return {
    gross,
    fees,
    cogs,
    attributedExpenses,
    generalExpenses,
    writeOffCost,
    writeOffCount,
    net: netFinal,
    totalSpend,
    roi: totalSpend > 0 ? netFinal / totalSpend : null,
    itemsSold,
    salesCount: salesInPeriod.length,
    monthly: [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v })),
    byPlatform: grpOut(byPlatform, true),
    bySource: grpOut(bySource),
    byLocation: grpOut(byLocation),
    byCategory: [...byCategory.entries()].map(([key, v]) => ({ key, amount: v.amount, ...(hist ? { amountYen: v.amountYen } : {}) })).sort((a, b) => b.amount - a.amount),
    ...(hist
      ? { grossYen, feesYen, cogsYen, attributedExpensesYen, generalExpensesYen, writeOffCostYen, netYen: netFinalYen, totalSpendYen }
      : {})
  };
}

export type { ItemFinancials };

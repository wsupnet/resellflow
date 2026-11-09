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
      salePrice: i.saleLine?.salePrice ?? null,
      priceAllocated: i.saleLine?.allocated ?? false
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
        salePrice: i.saleLine ? i.saleLine.priceJpy ?? i.saleLine.salePrice * (saleRateOfItem.get(i.id) ?? pr) : null,
        priceAllocated: i.saleLine?.allocated ?? false
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
    const amt = e.amountJpy ?? e.amountUsd * r;
    expenseYenById.set(e.id, amt);
    return { amountUsd: amt, purchaseId: e.purchaseId, itemId: e.itemId, saleId: e.saleId };
  });

  const itemFinYen = computeItemFinancials(lotsYen, salesYen, expensesYen);
  const generalYen = expensesYen.filter((e) => !e.purchaseId && !e.itemId && !e.saleId).reduce((a, e) => a + e.amountUsd, 0);
  const lotsYenById = new Map(lotsYen.map((l) => [l.id as string, l]));
  return { lotsYen, lotsYenById, itemFinYen, generalYen, expenseYenById };
}

/**
 * Per-row yen at locked rates for tables, or null unless the view is yen in
 * Historical mode. Pages pass these as fmtMoney's `yen` argument next to the
 * USD figure, summing both sides the same way.
 */
export function yenView(bundle: FinancialsBundle, m: { currency: string; mode: string; rate: number }) {
  if (m.currency !== "JPY" || m.mode !== "historical") return null;
  const y = buildYen(bundle, m.rate);
  return {
    ...y,
    fin: (itemId: string) => y.itemFinYen.get(itemId),
    roll: (purchaseId: string) => rollupLot(y.lotsYenById.get(purchaseId)!, y.itemFinYen)
  };
}
export type YenView = NonNullable<ReturnType<typeof yenView>>;

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
/**
 * The sale an item was on, and its share of that sale's fees plus every ledger
 * expense attributed to it (item / share of sale / share of lot) — the same
 * split finance.ts uses for net.
 */
export function itemCostBreakdown(bundle: FinancialsBundle, lot: FinancialsBundle["purchases"][number], itemId: string) {
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

  return { sale, weight, fees, expenses };
}

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

  const { sale, fees, expenses } = itemCostBreakdown(bundle, lot, itemId);

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
      if (sd && !p.purchasedAtApprox) { variantDaysSum += Math.max(0, Math.round((+new Date(sd) - +new Date(p.purchasedAt)) / 86400000)); variantDaysN++; }
    }
  }
  const variantAvgDaysToSell = variantDaysN ? variantDaysSum / variantDaysN : null;
  const tracksCond = tracksCondition(cat);

  const dateApprox = lot.purchasedAtApprox;

  // Every unit of the same product, for the "pick which one to edit" switcher.
  const units = item.productId ? await getProductUnits(userId, item.productId, bundle) : [];

  return { item, lot, fin, sale, fees, expenses, daysToSell, daysInStock, dateApprox, variantSold, variantAvgDaysToSell, tracksCond, units };
}

/** All of a user's saved sourcing locations (for pickers + the Locations page). */
/** One unit (item) of a product, with its purchase + sale context. */
export interface ProductUnit {
  id: string;
  title: string;
  condition: string | null;
  status: "UNLISTED" | "LISTED" | "SOLD" | "LOST" | "DAMAGED";
  purchaseId: string;
  purchaseTitle: string;
  isLot: boolean;
  source: string;
  purchasedAt: Date;
  purchasedAtApprox: boolean;
  allocatedCost: number;
  gross: number;
  net: number | null;
  soldAt: Date | null;
  thumbId: string | null;
}

/**
 * Every unit of a product (all conditions), newest purchase first. Reuses an
 * already-loaded financials bundle when given.
 */
export async function getProductUnits(userId: string, productId: string, bundle?: FinancialsBundle): Promise<ProductUnit[]> {
  const b = bundle ?? (await getFinancials(userId));
  const soldAt = new Map<string, Date>();
  for (const s of b.sales) for (const l of s.lines) soldAt.set(l.itemId, s.soldAt);
  const units: ProductUnit[] = [];
  for (const p of b.purchases)
    for (const i of p.items) {
      if (i.productId !== productId) continue;
      const f = b.itemFin.get(i.id);
      units.push({
        id: i.id,
        title: i.title,
        condition: i.condition,
        status: i.status,
        purchaseId: p.id,
        purchaseTitle: p.title,
        isLot: p.kind === "LOT",
        source: p.source,
        purchasedAt: p.purchasedAt,
        purchasedAtApprox: p.purchasedAtApprox,
        allocatedCost: f?.allocatedCost ?? 0,
        gross: f?.gross ?? 0,
        net: f?.sold || i.status === "LOST" || i.status === "DAMAGED" ? f?.net ?? null : null,
        soldAt: soldAt.get(i.id) ?? null,
        thumbId: i.photos[0]?.id ?? null
      });
    }
  return units.sort((a, b2) => +b2.purchasedAt - +a.purchasedAt || a.id.localeCompare(b2.id));
}

/** Everything behind one sold unit's numbers, for the product sales breakdown. */
export interface SaleBreakdown {
  itemId: string;
  title: string;
  condition: string | null;
  purchase: {
    id: string;
    isLot: boolean;
    title: string;
    source: string;
    isPersonal: boolean;
    date: Date;
    approx: boolean;
    paid: number; // single: cost + tax; lot: the lot's total cost + tax
    itemCount: number; // items in the lot (1 for a single)
    shareMethod: "single" | "override" | "proportional" | "personal";
    // What weighted this item's share of the lot (finance.ts allocateLot):
    // its own sale price, its estimated value, or the average of the others.
    weightBasis: "sale" | "estimate" | "average" | null;
  };
  sale: {
    id: string;
    date: Date;
    platform: string;
    price: number; // this item's line price (its share, for a bundle)
    bundled: boolean; // price is a split of a bundle total
    bundleTotal: number | null;
    lineCount: number;
  };
  fees: { label: string; amount: number }[];
  expenses: { label: string; category: string; amount: number; scope: string }[];
  allocatedCost: number;
  feeShare: number;
  expense: number;
  net: number;
  roi: number | null;
  daysToSell: number | null; // null when the purchase date is a best guess
  /** False when the Insights "individual sales only" view leaves this one out. */
  counted: boolean;
}

/**
 * Per-sale breakdown for a product's sold units (optionally one condition),
 * newest sale first. `individualOnly` mirrors the Insights toggle: bundle
 * sales stay listed but are marked not counted.
 */
export async function getProductSales(
  userId: string,
  productId: string,
  opts: { condition?: string | null; individualOnly?: boolean } = {}
): Promise<SaleBreakdown[]> {
  const bundle = await getFinancials(userId);
  const out: SaleBreakdown[] = [];
  for (const p of bundle.purchases)
    for (const i of p.items) {
      if (i.productId !== productId) continue;
      // Condition filter ("Unspecified" = no condition set), as Insights groups them.
      if (opts.condition != null && (i.condition || "Unspecified") !== opts.condition) continue;
      const f = bundle.itemFin.get(i.id);
      if (!f?.sold) continue;
      const { sale, fees, expenses } = itemCostBreakdown(bundle, p, i.id);
      if (!sale) continue;
      const line = sale.lines.find((l) => l.itemId === i.id)!;
      const bundled = !!line.allocated;
      const approx = p.purchasedAtApprox;
      const weightBasis =
        p.kind !== "LOT" || p.isPersonal || i.costOverrideUsd != null ? null
        : line.salePrice > 0 && !bundled ? "sale"
        : i.estimatedValue != null && i.estimatedValue > 0 ? "estimate"
        : "average";
      out.push({
        itemId: i.id,
        title: i.title,
        condition: i.condition,
        purchase: {
          id: p.id,
          isLot: p.kind === "LOT",
          title: p.title,
          source: p.source,
          isPersonal: p.isPersonal,
          date: p.purchasedAt,
          approx,
          paid: p.costUsd + p.taxUsd,
          itemCount: p.items.length,
          shareMethod: p.isPersonal ? "personal" : i.costOverrideUsd != null ? "override" : p.kind === "LOT" ? "proportional" : "single",
          weightBasis
        },
        sale: {
          id: sale.id,
          date: sale.soldAt,
          platform: sale.platform,
          price: f.gross,
          bundled,
          bundleTotal: bundled ? sale.bundleTotal ?? sale.lines.reduce((a, l) => a + l.salePrice, 0) : null,
          lineCount: sale.lines.length
        },
        fees,
        expenses,
        allocatedCost: f.allocatedCost,
        feeShare: f.feeShare,
        expense: f.expense,
        net: f.net,
        roi: f.roi,
        daysToSell: approx ? null : Math.max(0, Math.round((+new Date(sale.soldAt) - +new Date(p.purchasedAt)) / 86400000)),
        counted: !(opts.individualOnly && bundled)
      });
    }
  return out.sort((a, b) => +b.sale.date - +a.sale.date);
}

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
export async function getMonthlySeries(userId: string, m?: { currency: string; mode: string; rate: number }) {
  const bundle = await getFinancials(userId);
  const yv = m ? yenView(bundle, m) : null; // Historical mode: also sum yen at locked rates
  const byMonth = new Map<string, { gross: number; net: number; fees: number; grossYen?: number; netYen?: number }>();

  for (const sale of bundle.sales) {
    const key = new Date(sale.soldAt).toISOString().slice(0, 7); // YYYY-MM
    const entry = byMonth.get(key) ?? { gross: 0, net: 0, fees: 0 };
    for (const line of sale.lines) {
      const f = bundle.itemFin.get(line.itemId);
      if (!f) continue;
      entry.gross += f.gross;
      entry.fees += f.feeShare;
      entry.net += f.net;
      const fy = yv?.fin(line.itemId);
      if (fy) {
        entry.grossYen = (entry.grossYen ?? 0) + fy.gross;
        entry.netYen = (entry.netYen ?? 0) + fy.net;
      }
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
      if (yv) entry.netYen = (entry.netYen ?? 0) - (yv.fin(i.id)?.allocatedCost ?? 0);
      byMonth.set(key, entry);
    }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));
}

export interface SeasonalityData {
  // 12 rows (Jan…Dec), aggregating every year together.
  byMonth: { month: number; label: string; units: number; gross: number; net: number; grossYen?: number; netYen?: number }[];
  // Per category: which calendar month it sells the most (by units), + totals.
  byCategory: { category: string; peakMonth: string; units: number; gross: number; net: number; grossYen?: number; netYen?: number }[];
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
export async function getSeasonality(userId: string, m?: { currency: string; mode: string; rate: number }): Promise<SeasonalityData> {
  const bundle = await getFinancials(userId);
  const yv = m ? yenView(bundle, m) : null; // Historical mode: also sum yen at locked rates

  const months = MONTH_LABELS.map((label, i) => ({ month: i, label, units: 0, gross: 0, net: 0, grossYen: 0, netYen: 0 }));
  // category -> per-month {units, gross, net}
  const cat = new Map<string, { units: number; gross: number; net: number; grossYen: number; netYen: number }[]>();
  const years = new Set<number>();
  let totalSales = 0;

  const catOf = new Map<string, string | null>();
  for (const p of bundle.purchases) for (const i of p.items) catOf.set(i.id, i.product?.category ?? null);

  for (const s of bundle.sales) {
    const d = new Date(s.soldAt);
    // Sale dates are calendar days stored at UTC midnight — read them in UTC.
    const mi = d.getUTCMonth();
    years.add(d.getUTCFullYear());
    totalSales++;
    for (const l of s.lines) {
      const f = bundle.itemFin.get(l.itemId);
      if (!f) continue;
      const fy = yv?.fin(l.itemId);
      months[mi].units += 1;
      months[mi].gross += f.gross;
      months[mi].net += f.net;
      months[mi].grossYen += fy?.gross ?? 0;
      months[mi].netYen += fy?.net ?? 0;

      const c = catOf.get(l.itemId) || "Uncategorized";
      const arr = cat.get(c) ?? MONTH_LABELS.map(() => ({ units: 0, gross: 0, net: 0, grossYen: 0, netYen: 0 }));
      arr[mi].units += 1;
      arr[mi].gross += f.gross;
      arr[mi].net += f.net;
      arr[mi].grossYen += fy?.gross ?? 0;
      arr[mi].netYen += fy?.net ?? 0;
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
      const yen = yv ? { grossYen: arr.reduce((a, b) => a + b.grossYen, 0), netYen: arr.reduce((a, b) => a + b.netYen, 0) } : {};
      return { category, peakMonth: units > 0 ? MONTH_LABELS[peak] : "—", units, gross, net, ...yen };
    })
    .sort((a, b) => b.units - a.units);

  // Yen fields only mean something in Historical mode.
  const byMonth = yv ? months : months.map(({ grossYen: _g, netYen: _n, ...rest }) => rest);
  return { byMonth, byCategory, yearsSpanned: years.size, totalSales };
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
  totalNetYen?: number; // Historical-mode yen at locked rates
  avgRoi: number | null;
  totalCost: number;
  avgBuyPrice: number | null; // avg acquisition cost per unit (USD), sold + in-stock
  avgSalePrice: number | null;
  recentAvg: number | null; // avg of the last 3 sales
  lastSalePrice: number | null;
  lastSaleDate: string | null;
  avgDaysToSell: number | null; // purchase date → sold date
  score: number; // blended buy-more score
  bundleSold: number; // of timesSold, how many sold inside a bundle (price = cost share of the bundle total)
  inStock: number;
  listed: number;
  costTiedUp: number;
  thumbId: string | null;
}

/** Sales needed before a variant's ROI is trusted: ranks in the ROI lens and
 *  counts fully in the blended score. */
export const ROI_MIN_SALES = 3;

/**
 * Per-variant stats — grouped by product, and further by condition for
 * condition-tracked categories (games/movies/etc.). Powers insights, the deal
 * checker, and the inventory stock view, including avg days-to-sell (demand).
 */
export async function getVariantStats(
  userId: string,
  opts: { individualOnly?: boolean; m?: { currency: string; mode: string; rate: number } } = {}
): Promise<VariantStat[]> {
  const bundle = await getFinancials(userId);
  const yv = opts.m ? yenView(bundle, opts.m) : null; // Historical mode: also sum yen net

  // item -> sale date + gross; item -> purchase date.
  const saleOf = new Map<string, number>();
  // Items whose sale price is a derived share of a bundle total, not a typed price.
  const bundled = new Set<string>();
  for (const s of bundle.sales)
    for (const l of s.lines) {
      saleOf.set(l.itemId, +new Date(s.soldAt));
      if (l.allocated) bundled.add(l.itemId);
    }
  const purchaseOf = new Map<string, number>();
  // Best-guess purchase dates are skipped so they don't skew avg days-to-sell.
  for (const p of bundle.purchases) {
    if (p.purchasedAtApprox) continue;
    for (const i of p.items) purchaseOf.set(i.id, +new Date(p.purchasedAt));
  }

  interface Agg {
    productId: string;
    baseName: string;
    category: string | null;
    condition: string | null;
    sku: string | null;
    compPrice: number | null;
    thumbId: string | null;
    net: number;
    netYen: number;
    cost: number;
    buyCostSum: number; // acquisition cost of every unit (sold + in-stock)
    buyN: number;
    roiSum: number;
    roiN: number;
    sold: number;
    bundleSold: number;
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
          net: 0, netYen: 0, cost: 0, buyCostSum: 0, buyN: 0, roiSum: 0, roiN: 0, sold: 0, bundleSold: 0, sales: [], daysSum: 0, daysN: 0, inStock: 0, listed: 0, costTiedUp: 0
        };
      if (!a.thumbId && i.photos[0]) a.thumbId = i.photos[0].id;
      const fin = bundle.itemFin.get(i.id);
      // Average acquisition cost spans every unit you've handled, sold or not.
      if (fin) { a.buyCostSum += fin.allocatedCost; a.buyN++; }
      // "Individual sales only" leaves bundle sales out of the sales stats entirely.
      if (fin?.sold && opts.individualOnly && bundled.has(i.id)) {
        agg.set(key, a);
        continue;
      }
      if (fin?.sold) {
        if (bundled.has(i.id)) a.bundleSold++;
        a.net += fin.net;
        a.netYen += yv?.fin(i.id)?.net ?? 0;
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
    // ROI from one or two sales is mostly luck, so its pull on the blended score
    // ramps up with sales count and only counts in full from ROI_MIN_SALES on.
    const roiConfidence = Math.min(1, a.sold / ROI_MIN_SALES);
    const roiFactor = 1 + Math.max(-0.5, Math.min(2, avgRoi ?? 0)) * roiConfidence;
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
      ...(yv ? { totalNetYen: a.netYen } : {}),
      avgRoi,
      totalCost: a.cost,
      avgBuyPrice: a.buyN ? a.buyCostSum / a.buyN : null,
      avgSalePrice,
      recentAvg,
      lastSalePrice: sales[0]?.price ?? null,
      lastSaleDate: sales[0]?.date ? new Date(sales[0].date).toISOString() : null,
      avgDaysToSell: a.daysN ? a.daysSum / a.daysN : null,
      score: (avgNet ?? 0) * freqFactor * roiFactor,
      bundleSold: a.bundleSold,
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

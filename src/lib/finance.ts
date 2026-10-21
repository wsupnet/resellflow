/**
 * Finance engine — the heart of ResellFlow.
 *
 * Two hard problems from the spreadsheet are solved here:
 *
 *  1. LOT COST ALLOCATION. A lot is bought for one price (+ tax). Its cost is
 *     spread across the items it contains, weighted by each item's sale price
 *     (the user's chosen method). Unsold items fall back to their estimated
 *     value, then to an even split. A per-item manual override wins outright.
 *
 *  2. CROSS-LOT / BUNDLE SALES & ROLL-UP. A sale can contain items from several
 *     different lots. Sale-level fees are split across its lines by sale price.
 *     Each item's net then rolls back to the lot it ORIGINATED from, so a lot's
 *     true profitability is correct no matter where its items ended up.
 *
 * All math is in USD (the reporting currency). Functions are pure so they can be
 * reused on any server route and unit-tested.
 */

const EPS = 1e-9;

// ─────────────── input shapes (decoupled from Prisma) ───────────────

export interface FinSaleLine {
  itemId: string;
  salePrice: number;
}

export interface FinSale {
  id?: string;
  shippingFee: number;
  ebayFee: number;
  mercariFee: number;
  adFee: number;
  lines: FinSaleLine[];
}

// A ledger expense, optionally attached to a lot (purchaseId), item, or sale.
export interface FinExpense {
  amountUsd: number;
  purchaseId?: string | null;
  itemId?: string | null;
  saleId?: string | null;
}

export interface FinItem {
  id: string;
  status: "UNLISTED" | "LISTED" | "SOLD" | "LOST" | "DAMAGED";
  estimatedValue: number | null;
  costOverrideUsd: number | null;
  // The sale line this item sold on, if any. salePrice is its gross.
  salePrice: number | null;
}

export interface FinLot {
  id?: string;
  costUsd: number;
  taxUsd: number;
  isPersonal?: boolean;
  items: FinItem[];
}

// ─────────────── lot cost allocation ───────────────

/** Returns a map of itemId -> allocated USD cost for one lot/purchase. */
export function allocateLot(lot: FinLot): Map<string, number> {
  const result = new Map<string, number>();
  const allocable = (lot.costUsd || 0) + (lot.taxUsd || 0);

  const overridden = lot.items.filter((i) => i.costOverrideUsd != null);
  let remaining = allocable;
  for (const i of overridden) {
    const c = i.costOverrideUsd as number;
    result.set(i.id, c);
    remaining -= c;
  }

  const pool = lot.items.filter((i) => i.costOverrideUsd == null);
  if (pool.length === 0) return result;

  if (remaining <= EPS) {
    for (const i of pool) result.set(i.id, 0);
    return result;
  }

  const weightOf = (i: FinItem): number | null => {
    if (i.salePrice != null && i.salePrice > 0) return i.salePrice;
    if (i.estimatedValue != null && i.estimatedValue > 0) return i.estimatedValue;
    return null;
  };

  const weights = pool.map(weightOf);
  const known = weights.filter((w): w is number => w != null);

  if (known.length === 0) {
    const even = remaining / pool.length;
    for (const i of pool) result.set(i.id, even);
    return result;
  }

  // Items with no signal get the average of the known weights.
  const avg = known.reduce((a, b) => a + b, 0) / known.length;
  const filled = weights.map((w) => (w == null ? avg : w));
  const total = filled.reduce((a, b) => a + b, 0) || 1;
  pool.forEach((i, idx) => {
    result.set(i.id, remaining * (filled[idx] / total));
  });
  return result;
}

// ─────────────── sale fee splitting ───────────────

/** Splits a sale's total fees across its line items, weighted by sale price. */
export function splitSaleFees(sale: FinSale): Map<string, number> {
  const totalFees =
    (sale.shippingFee || 0) +
    (sale.ebayFee || 0) +
    (sale.mercariFee || 0) +
    (sale.adFee || 0);
  const result = new Map<string, number>();
  if (sale.lines.length === 0) return result;

  const sum = sale.lines.reduce((a, l) => a + (l.salePrice || 0), 0);
  if (sum <= EPS) {
    const even = totalFees / sale.lines.length;
    for (const l of sale.lines) result.set(l.itemId, even);
    return result;
  }
  for (const l of sale.lines) {
    result.set(l.itemId, totalFees * ((l.salePrice || 0) / sum));
  }
  return result;
}

// ─────────────── combined per-item financials ───────────────

export interface ItemFinancials {
  itemId: string;
  allocatedCost: number;
  gross: number;
  feeShare: number;
  expense: number; // ledger expenses attributed to this item
  net: number; // gross - feeShare - allocatedCost - expense
  roi: number | null; // net / (allocatedCost + feeShare + expense); null when no cost basis
  sold: boolean;
  writtenOff: boolean; // LOST/DAMAGED — cost is a realized loss, no sale coming
  isPersonal: boolean;
}

/**
 * Distribute ledger expenses down to individual items. Item-attached expenses go
 * straight to the item; sale-attached are split across that sale's lines by price;
 * lot-attached are split across that lot's items by allocated cost. Unattached
 * (general) expenses are returned as a lump for the portfolio totals.
 */
export function distributeExpenses(
  lots: FinLot[],
  sales: FinSale[],
  expenses: FinExpense[],
  costByItem: Map<string, number>
): { byItem: Map<string, number>; general: number } {
  const byItem = new Map<string, number>();
  let general = 0;
  const add = (id: string, amt: number) => byItem.set(id, (byItem.get(id) ?? 0) + amt);

  const lotById = new Map<string, FinLot>();
  for (const l of lots) if (l.id) lotById.set(l.id, l);
  const saleById = new Map<string, FinSale>();
  for (const s of sales) if (s.id) saleById.set(s.id, s);

  for (const e of expenses) {
    const amt = e.amountUsd || 0;
    if (e.itemId) {
      add(e.itemId, amt);
    } else if (e.saleId && saleById.has(e.saleId)) {
      const sale = saleById.get(e.saleId)!;
      const sum = sale.lines.reduce((a, l) => a + (l.salePrice || 0), 0);
      if (sum <= EPS) sale.lines.forEach((l) => add(l.itemId, amt / (sale.lines.length || 1)));
      else sale.lines.forEach((l) => add(l.itemId, amt * ((l.salePrice || 0) / sum)));
    } else if (e.purchaseId && lotById.has(e.purchaseId)) {
      const lot = lotById.get(e.purchaseId)!;
      const weights = lot.items.map((i) => costByItem.get(i.id) ?? 0);
      const sum = weights.reduce((a, b) => a + b, 0);
      if (sum <= EPS) lot.items.forEach((i) => add(i.id, amt / (lot.items.length || 1)));
      else lot.items.forEach((i, idx) => add(i.id, amt * (weights[idx] / sum)));
    } else {
      general += amt;
    }
  }
  return { byItem, general };
}

/**
 * Compute financials for every item, given all lots and all sales.
 * Pass the complete (per-user) dataset; everything is computed in memory.
 */
export function computeItemFinancials(
  lots: FinLot[],
  sales: FinSale[],
  expenses: FinExpense[] = []
): Map<string, ItemFinancials> {
  // 1) allocate cost within each lot
  const cost = new Map<string, number>();
  for (const lot of lots) {
    for (const [id, c] of allocateLot(lot)) cost.set(id, c);
  }

  // 2) split fees within each sale + capture gross
  const fee = new Map<string, number>();
  const gross = new Map<string, number>();
  for (const sale of sales) {
    for (const [id, f] of splitSaleFees(sale)) fee.set(id, f);
    for (const l of sale.lines) gross.set(l.itemId, l.salePrice || 0);
  }

  // 3) distribute ledger expenses down to items
  const { byItem: expByItem } = distributeExpenses(lots, sales, expenses, cost);

  // 4) combine per item
  const out = new Map<string, ItemFinancials>();
  for (const lot of lots) {
    for (const item of lot.items) {
      const allocatedCost = cost.get(item.id) ?? 0;
      const g = gross.get(item.id) ?? 0;
      const feeShare = fee.get(item.id) ?? 0;
      const expense = expByItem.get(item.id) ?? 0;
      const net = g - feeShare - allocatedCost - expense;
      const sold = item.status === "SOLD" || gross.has(item.id);
      out.set(item.id, {
        itemId: item.id,
        allocatedCost,
        gross: g,
        feeShare,
        expense,
        net,
        // ROI = net / total money in (acquisition cost + fees + attributed expenses).
        // Null when there's no acquisition cost (personal/free items) — an ROI on
        // a $0 cost basis is meaningless and otherwise pollutes the insights.
        roi: allocatedCost > EPS ? net / (allocatedCost + feeShare + expense) : null,
        sold,
        writtenOff: !sold && (item.status === "LOST" || item.status === "DAMAGED"),
        isPersonal: lot.isPersonal ?? false
      });
    }
  }
  return out;
}

// ─────────────── lot roll-up ───────────────

export interface LotFinancials {
  cost: number;
  gross: number;
  fees: number;
  expense: number;
  net: number;
  roi: number | null;
  itemCount: number;
  soldCount: number;
}

/** Roll item financials up to a single lot. */
export function rollupLot(
  lot: FinLot,
  itemFin: Map<string, ItemFinancials>
): LotFinancials {
  const cost = (lot.costUsd || 0) + (lot.taxUsd || 0);
  let gross = 0;
  let fees = 0;
  let expense = 0;
  let soldCount = 0;
  for (const item of lot.items) {
    const f = itemFin.get(item.id);
    if (!f) continue;
    gross += f.gross;
    fees += f.feeShare;
    expense += f.expense;
    if (f.sold) soldCount++;
  }
  const net = gross - fees - expense - cost;
  return {
    cost,
    gross,
    fees,
    expense,
    net,
    roi: cost > EPS ? net / (cost + fees + expense) : null,
    itemCount: lot.items.length,
    soldCount
  };
}

// ─────────────── portfolio totals ───────────────

export interface Bucket {
  sourcing: number;
  fees: number;
  expense: number;
  gross: number;
  net: number;
  roi: number | null;
  count: number;
  // Sold-basis (realized) figures: only count the cost of items that actually
  // sold — plus written-off items (their cost is a realized loss) — so unsold
  // inventory you're still holding doesn't drag the numbers.
  soldCost: number;
  writeOffCost: number; // allocated cost of LOST/DAMAGED items
  writeOffCount: number;
  settledExpense: number; // attributed expenses of settled (sold/written-off) items + general overhead
  realizedNet: number;
  realizedRoi: number | null;
}

export interface Totals {
  sourcing: number; // total cost of everything bought
  fees: number; // total selling fees + shipping
  expenses: number; // total ledger expenses (attached + general)
  gross: number; // total sale proceeds
  net: number; // combined gross - fees - expenses - all sourcing
  realizedNet: number; // net counting only settled items' cost (sold + written off)
  writeOffCost: number; // combined allocated cost of LOST/DAMAGED items
  writeOffCount: number;
  roi: number | null; // combined ROI, net / (sourcing + fees + expenses)
  flip: Bucket; // items you actually paid for — the "flip business"
  personal: Bucket; // items you already owned, tracked separately
}

/**
 * Portfolio totals, split into a "flip" bucket (items you sourced/paid for) and a
 * "personal" bucket (belongings you already owned). The combined `net`/`gross`
 * still match the spreadsheet's bottom line; the flip bucket gives a clean ROI
 * that isn't inflated by $0-cost personal items.
 */
export function computeTotals(
  lots: FinLot[],
  itemFin: Map<string, ItemFinancials>,
  generalExpense = 0
): Totals {
  const blank = (): Bucket => ({ sourcing: 0, fees: 0, expense: 0, gross: 0, net: 0, roi: null, count: 0, soldCost: 0, writeOffCost: 0, writeOffCount: 0, settledExpense: 0, realizedNet: 0, realizedRoi: null });
  const flip = blank();
  const personal = blank();

  for (const lot of lots) {
    const lotCost = (lot.costUsd || 0) + (lot.taxUsd || 0);
    (lot.isPersonal ? personal : flip).sourcing += lotCost;
  }

  for (const f of itemFin.values()) {
    const b = f.isPersonal ? personal : flip;
    b.gross += f.gross;
    b.fees += f.feeShare;
    b.expense += f.expense;
    b.count += 1;
    if (f.sold) {
      b.soldCost += f.allocatedCost;
      b.settledExpense += f.expense;
    } else if (f.writtenOff) {
      // Lost/damaged: the money spent on this item is gone — a realized loss.
      b.writeOffCost += f.allocatedCost;
      b.writeOffCount++;
      b.settledExpense += f.expense;
    }
  }
  // General (unattached) expenses are business overhead — count them in the flip bucket.
  flip.expense += generalExpense;
  flip.settledExpense += generalExpense;

  for (const b of [flip, personal]) {
    b.net = b.gross - b.fees - b.expense - b.sourcing;
    b.roi = b.sourcing + b.fees + b.expense > EPS ? b.net / (b.sourcing + b.fees + b.expense) : null;
    // Realized: cost + expenses only for items whose outcome is settled (sold or
    // written off) plus general overhead — matches the Reports convention, so an
    // expense attached to a still-unsold item waits until that item settles.
    b.realizedNet = b.gross - b.fees - b.settledExpense - b.soldCost - b.writeOffCost;
    const spent = b.soldCost + b.writeOffCost + b.fees + b.settledExpense;
    b.realizedRoi = spent > EPS ? b.realizedNet / spent : null;
  }

  const sourcing = flip.sourcing + personal.sourcing;
  const fees = flip.fees + personal.fees;
  const expenses = flip.expense + personal.expense;
  const gross = flip.gross + personal.gross;
  const net = gross - fees - expenses - sourcing;
  const writeOffCost = flip.writeOffCost + personal.writeOffCost;
  const realizedNet = flip.realizedNet + personal.realizedNet;
  return {
    sourcing,
    fees,
    expenses,
    gross,
    net,
    realizedNet,
    writeOffCost,
    writeOffCount: flip.writeOffCount + personal.writeOffCount,
    roi: sourcing + fees + expenses > EPS ? net / (sourcing + fees + expenses) : null,
    flip,
    personal
  };
}

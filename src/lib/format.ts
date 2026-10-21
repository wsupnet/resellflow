export const usd = (n: number | null | undefined): string =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export const jpy = (n: number | null | undefined): string =>
  n == null
    ? "—"
    : new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(n);

export const pct = (n: number | null | undefined): string =>
  n == null ? "—" : `${(n * 100).toFixed(1)}%`;

/**
 * How to display money for the current request. Pure/serializable so it can be
 * passed from server components into client ones (ItemRow etc.). Resolved by
 * getMoney() in money.ts.
 */
export interface MoneyCtx {
  currency: "USD" | "JPY";
  mode: "live" | "historical";
  rate: number; // live JPY per USD (1 for USD); Live mode + historical fallback
}

/**
 * Charts take pre-converted numeric values, so they only need the currency's
 * symbol + decimal places. Multiply USD figures by `m.rate` (1 for USD) before
 * plotting, then hand these to the chart. Yen shows whole numbers.
 */
export function moneyUnit(m: MoneyCtx): { symbol: string; decimals: number } {
  return m.currency === "JPY" ? { symbol: "¥", decimals: 0 } : { symbol: "$", decimals: 2 };
}

/**
 * Format a canonical USD amount in the chosen display currency. In Historical
 * mode pass the pre-computed yen value (converted at locked per-transaction
 * rates); otherwise it converts at the live rate.
 */
export function fmtMoney(usdAmount: number | null | undefined, m: MoneyCtx, yen?: number): string {
  if (usdAmount == null) return "—";
  if (m.currency !== "JPY") return usd(usdAmount);
  const y = Math.round(m.mode === "historical" && yen != null ? yen : usdAmount * m.rate);
  return `${y < 0 ? "-¥" : "¥"}${Math.abs(y).toLocaleString()}`;
}

/**
 * A "deducted" figure (ledger expenses, fees) is normally shown with a leading
 * "−". But ledger entries can now be CREDITS (negative amountUsd — a refund or
 * rebate), and prefixing usd()'s own "-$50.00" with another "−" would render as
 * "−-$50.00". This picks the right sign once: "−" for an expense, "+" for a
 * net credit, always against the absolute value.
 */
export function fmtDeduction(amount: number, m: MoneyCtx, yen?: number): { text: string; isCredit: boolean } {
  const isCredit = amount < 0;
  const abs = Math.abs(amount);
  const absYen = yen != null ? Math.abs(yen) : undefined;
  return { text: `${isCredit ? "+" : "−"}${fmtMoney(abs, m, absYen)}`, isCredit };
}

export const shortDate = (d: Date | string | null | undefined): string =>
  d == null ? "—" : new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

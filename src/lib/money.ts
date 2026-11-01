import "server-only";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { getFxRate } from "./fx";
import type { MoneyCtx } from "./format";

// fmtMoney/MoneyCtx are pure and live in format.ts (client-safe). Re-exported
// here so existing `from "@/lib/money"` imports keep working.
export type { MoneyCtx } from "./format";
export { fmtMoney } from "./format";

/**
 * Resolve how to display money this request: the view-currency cookie (set by the
 * nav toggle) wins, else the user's default (Settings.homeCurrency). When JPY,
 * we attach the current live rate. USD amounts are the canonical stored value;
 * this is a display-time conversion at today's rate.
 */
export interface CurrencyPrefs {
  primary: "USD" | "JPY";
  single: boolean; // one-currency mode: no toggle, no pickers
}

export async function getCurrencyPrefs(userId: string): Promise<CurrencyPrefs> {
  const s = await prisma.settings.findUnique({ where: { userId }, select: { homeCurrency: true, singleCurrency: true } });
  return { primary: s?.homeCurrency === "JPY" ? "JPY" : "USD", single: !!s?.singleCurrency };
}

/** The view-currency cookie wins, unless the user turned the second currency off. */
async function resolveView(prefs: CurrencyPrefs): Promise<"USD" | "JPY"> {
  if (prefs.single) return prefs.primary;
  const cookie = (await cookies()).get("viewCurrency")?.value;
  return cookie === "JPY" || cookie === "USD" ? cookie : prefs.primary;
}

/** Just the chosen display currency (cookie → default), no rate fetch. */
export async function getViewCurrency(userId: string): Promise<"USD" | "JPY"> {
  return resolveView(await getCurrencyPrefs(userId));
}

export async function getMoney(userId: string): Promise<MoneyCtx> {
  const s = await prisma.settings.findUnique({ where: { userId }, select: { homeCurrency: true, singleCurrency: true, fxMode: true } });
  const currency = await resolveView({ primary: s?.homeCurrency === "JPY" ? "JPY" : "USD", single: !!s?.singleCurrency });
  const mode = s?.fxMode === "historical" ? "historical" : "live";
  const rate = currency === "JPY" ? (await getFxRate(userId)).rate : 1;
  return { currency, mode, rate, single: !!s?.singleCurrency };
}

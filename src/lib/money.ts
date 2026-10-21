import "server-only";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { getUsdToJpy } from "./fx";
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
/** Just the chosen display currency (cookie → default), no rate fetch. */
export async function getViewCurrency(userId: string): Promise<"USD" | "JPY"> {
  const cookie = cookies().get("viewCurrency")?.value;
  if (cookie === "JPY" || cookie === "USD") return cookie;
  const s = await prisma.settings.findUnique({ where: { userId }, select: { homeCurrency: true } });
  return s?.homeCurrency === "JPY" ? "JPY" : "USD";
}

export async function getMoney(userId: string): Promise<MoneyCtx> {
  const cookie = cookies().get("viewCurrency")?.value;
  const s = await prisma.settings.findUnique({ where: { userId }, select: { homeCurrency: true, fxMode: true } });
  const currency = cookie === "JPY" || cookie === "USD" ? cookie : s?.homeCurrency === "JPY" ? "JPY" : "USD";
  const mode = s?.fxMode === "historical" ? "historical" : "live";
  const rate = currency === "JPY" ? (await getUsdToJpy()).rate : 1;
  return { currency, mode, rate };
}

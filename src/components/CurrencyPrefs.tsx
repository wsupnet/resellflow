"use client";

import { createContext, useContext } from "react";

export interface CurrencyPrefsValue {
  primary: "USD" | "JPY";
  single: boolean; // one-currency mode: forms hide their ¥/$ pickers
}

const Ctx = createContext<CurrencyPrefsValue>({ primary: "USD", single: false });

/** Provided once in the app layout so every entry form knows whether to offer a currency choice. */
export function CurrencyPrefsProvider({ value, children }: { value: CurrencyPrefsValue; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useCurrencyPrefs = () => useContext(Ctx);

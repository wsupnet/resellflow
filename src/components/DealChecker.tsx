"use client";

import { useMemo, useState } from "react";
import { setProductComp } from "@/lib/actions";
import ScanButton from "./ScanButton";

export interface DealProduct {
  key: string; // variant key (product, or product+condition)
  productId: string;
  name: string; // includes condition when tracked
  condition: string | null;
  timesSold: number;
  avgBuyPrice: number | null;
  avgSalePrice: number | null;
  avgNet: number | null;
  avgDaysToSell: number | null;
  compPrice: number | null;
  sku: string | null;
  recentAvg: number | null;
  lastSalePrice: number | null;
  lastSaleDate: string | null;
}

export default function DealChecker({ products, rate, defaultCurrency = "USD" }: { products: DealProduct[]; rate: number; defaultCurrency?: "USD" | "JPY" }) {
  // ---- converter ----
  const [conv, setConv] = useState("");
  const [dir, setDir] = useState<"jpy2usd" | "usd2jpy">("jpy2usd");
  const converted =
    conv === ""
      ? ""
      : dir === "jpy2usd"
        ? `$${(Number(conv) / rate).toFixed(2)}`
        : `¥${Math.round(Number(conv) * rate).toLocaleString()}`;

  // ---- deal lookup ----
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<DealProduct | null>(null);
  const [price, setPrice] = useState("");
  const [priceCur, setPriceCur] = useState<"USD" | "JPY">(defaultCurrency);

  const [scanMsg, setScanMsg] = useState("");

  const matches = useMemo(() => {
    if (!query) return [];
    const q = query.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q)).slice(0, 8);
  }, [query, products]);

  function onScan(code: string) {
    const hits = products.filter((p) => p.sku && p.sku.toLowerCase() === code.toLowerCase());
    if (hits.length === 1) {
      setSelected(hits[0]);
      setQuery(hits[0].name);
      setScanMsg(`Matched by SKU — you've handled this ${hits[0].timesSold}× before.`);
    } else if (hits.length > 1) {
      // Same barcode, multiple conditions — let them pick which one.
      setSelected(null);
      setQuery(hits[0].sku ?? code);
      setScanMsg(`Matched ${hits.length} conditions for this barcode — pick the one you're holding.`);
    } else {
      setSelected(null);
      setQuery(code);
      setScanMsg(`No item tagged with ${code} yet. Tag one in Inventory to track it.`);
    }
  }

  const buyUsd = price === "" ? null : priceCur === "USD" ? Number(price) : Number(price) / rate;

  // Benchmark = manual comp if set, else your average sale price.
  const benchmark = selected ? (selected.compPrice ?? selected.avgSalePrice) : null;
  const benchmarkSource = selected?.compPrice != null ? "your comp" : "your avg sale price";

  let verdict: { tone: "good" | "ok" | "bad"; head: string; text: string } | null = null;
  if (selected && buyUsd != null && benchmark != null && benchmark > 0) {
    const ratio = buyUsd / benchmark;
    if (ratio <= 0.4) verdict = { tone: "good", head: "Buy it 🔥", text: `You'd pay just ${(ratio * 100).toFixed(0)}% of what it sells for — strong margin.` };
    else if (ratio <= 0.7) verdict = { tone: "good", head: "Buy it", text: `${(ratio * 100).toFixed(0)}% of resale — healthy margin after fees.` };
    else if (ratio <= 1) verdict = { tone: "ok", head: "Maybe", text: `${(ratio * 100).toFixed(0)}% of resale — thin once fees come out.` };
    else verdict = { tone: "bad", head: "Rethink it", text: `${(ratio * 100).toFixed(0)}% of resale — you'd likely lose money after fees.` };
  }

  // Trend: is it selling above/below its usual lately?
  let trend: { tone: "up" | "down" | "flat"; text: string } | null = null;
  if (selected && selected.recentAvg != null && selected.avgSalePrice != null && selected.timesSold >= 3) {
    const diff = (selected.recentAvg - selected.avgSalePrice) / selected.avgSalePrice;
    if (diff >= 0.1) trend = { tone: "up", text: `Selling ABOVE usual lately (recent avg $${selected.recentAvg.toFixed(2)} vs all-time $${selected.avgSalePrice.toFixed(2)}). Hotter than normal.` };
    else if (diff <= -0.1) trend = { tone: "down", text: `Selling BELOW usual lately (recent avg $${selected.recentAvg.toFixed(2)} vs all-time $${selected.avgSalePrice.toFixed(2)}). Cooling off — be choosier.` };
    else trend = { tone: "flat", text: `Selling about usual (recent avg $${selected.recentAvg.toFixed(2)}).` };
  }

  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

  return (
    <div className="space-y-6">
      {/* Converter */}
      <div className="card">
        <h2 className="mb-3 text-lg font-semibold">Currency converter</h2>
        <p className="mb-3 text-xs text-slate-400">Live rate ≈ ¥{rate.toFixed(1)} / $1</p>
        <div className="flex items-end gap-2">
          <div className="grow">
            <label className="label">{dir === "jpy2usd" ? "Amount in yen" : "Amount in USD"}</label>
            <input value={conv} onChange={(e) => setConv(e.target.value)} inputMode="decimal" className="input" />
          </div>
          <button
            type="button"
            onClick={() => setDir((d) => (d === "jpy2usd" ? "usd2jpy" : "jpy2usd"))}
            className="btn-ghost mb-0.5"
            title="Swap direction"
          >
            ⇄
          </button>
          <div className="grow">
            <label className="label">Equals</label>
            <div className="input bg-slate-50 font-semibold">{converted || "—"}</div>
          </div>
        </div>
      </div>

      {/* Deal lookup */}
      <div className="card">
        <h2 className="mb-1 text-lg font-semibold">Is this a good deal?</h2>
        <p className="mb-3 text-xs text-slate-400">
          Compares a candidate buy price against what you usually sell this item for (or your manual comp).
        </p>

        <label className="label">Search your items or scan</label>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
              setScanMsg("");
            }}
            className="input"
            placeholder="e.g. 3ds, final fantasy, or a SKU…"
          />
          <ScanButton onCode={onScan} />
        </div>
        {scanMsg && <p className="mt-1 text-xs text-slate-500">{scanMsg}</p>}
        {!selected && matches.length > 0 && (
          <div className="mt-1 rounded-lg border border-slate-200">
            {matches.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => {
                  setSelected(m);
                  setQuery(m.name);
                  setScanMsg("");
                }}
                className="block w-full border-b border-slate-50 px-3 py-2 text-left text-sm last:border-0 hover:bg-slate-50"
              >
                {m.name}
                <span className="ml-2 text-xs text-slate-400">sold {m.timesSold}×</span>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div className="mt-4 space-y-4">
            {selected.condition && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500">Condition:</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{selected.condition}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-3">
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-xs text-slate-500">Times sold</div>
                <div className="font-bold">{selected.timesSold}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-xs text-slate-500">Avg buy</div>
                <div className="font-bold">{selected.avgBuyPrice != null ? `$${selected.avgBuyPrice.toFixed(2)}` : "—"}</div>
                {selected.avgBuyPrice != null && (
                  <div className="text-[10px] text-slate-400">≈ ¥{Math.round(selected.avgBuyPrice * rate).toLocaleString()}</div>
                )}
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-xs text-slate-500">Avg sale</div>
                <div className="font-bold">{selected.avgSalePrice != null ? `$${selected.avgSalePrice.toFixed(2)}` : "—"}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-xs text-slate-500">Last sold</div>
                <div className="font-bold">{selected.lastSalePrice != null ? `$${selected.lastSalePrice.toFixed(2)}` : "—"}</div>
                {selected.lastSaleDate && <div className="text-[10px] text-slate-400">{fmtDate(selected.lastSaleDate)}</div>}
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-xs text-slate-500">Avg net</div>
                <div className="font-bold">{selected.avgNet != null ? `$${selected.avgNet.toFixed(2)}` : "—"}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-xs text-slate-500">Days to sell</div>
                <div className="font-bold">{selected.avgDaysToSell != null ? `${Math.round(selected.avgDaysToSell)}d` : "—"}</div>
              </div>
            </div>

            {trend && (
              <div
                className={`rounded-lg px-3 py-2 text-sm ${
                  trend.tone === "up" ? "bg-emerald-50 text-emerald-700" : trend.tone === "down" ? "bg-amber-50 text-amber-700" : "bg-slate-50 text-slate-600"
                }`}
              >
                {trend.tone === "up" ? "📈 " : trend.tone === "down" ? "📉 " : "➡️ "}
                {trend.text}
              </div>
            )}

            <div className="flex items-end gap-2">
              <div className="grow">
                <label className="label">Asking price</label>
                <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="input" />
              </div>
              <select value={priceCur} onChange={(e) => setPriceCur(e.target.value as "USD" | "JPY")} className="input mb-0 w-24">
                <option>USD</option>
                <option>JPY</option>
              </select>
            </div>

            {buyUsd != null && (
              <p className="text-sm text-slate-500">
                That&apos;s <b>${buyUsd.toFixed(2)}</b>
                {benchmark != null && benchmark > 0 && <> vs. {benchmarkSource} of <b>${benchmark.toFixed(2)}</b></>}
              </p>
            )}

            {verdict ? (
              <div
                className={`rounded-lg p-3 ${
                  verdict.tone === "good"
                    ? "bg-emerald-50 text-emerald-700"
                    : verdict.tone === "ok"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-red-50 text-red-700"
                }`}
              >
                <div className="text-base font-bold">{verdict.head}</div>
                <div className="text-sm">{verdict.text}</div>
              </div>
            ) : (
              benchmark == null && (
                <p className="text-xs text-slate-400">No sale history or comp for this item yet — set a comp below to enable a verdict.</p>
              )
            )}

            {/* set/update comp */}
            <form action={setProductComp} className="flex items-end gap-2 border-t border-slate-100 pt-3">
              <input type="hidden" name="id" value={selected.productId} />
              <div className="grow">
                <label className="label">Set manual comp (sold price, $)</label>
                <input name="compPrice" inputMode="decimal" defaultValue={selected.compPrice ?? ""} className="input" placeholder="from eBay sold / 130point" />
              </div>
              <button className="btn-ghost">Save comp</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useRef, useState } from "react";
import { recordSale } from "@/lib/actions";

/** Parse a money field forgivingly: "$53.99", "¥1,234", " 12.5 " all work.
 *  Strips currency symbols/commas/spaces and keeps digits, dot, minus. */
function parseAmt(v: string | undefined | null): number {
  if (!v) return 0;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export interface SellableItem {
  id: string;
  title: string;
  lotTitle: string;
  isLot: boolean;
  estimatedValue: number | null;
  condition: string | null; // only set for condition-tracked categories
  suggestedValue: number | null; // best-known value (comp → estimate → history) for splitting a lot total
}

export interface FeeSettings {
  ebayFeePct: number;
  ebayFlatFee: number;
  mercariFeePct: number;
  adFeePct: number;
  defaultShipping: number;
}

export default function SaleForm({ items, fees, rate, defaultCurrency = "USD" }: { items: SellableItem[]; fees: FeeSettings; rate: number; defaultCurrency?: "USD" | "JPY" }) {
  const [platform, setPlatform] = useState("EBAY");
  const [currency, setCurrency] = useState<"USD" | "JPY">(defaultCurrency);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [autoFees, setAutoFees] = useState(true);
  const [priceMode, setPriceMode] = useState<"each" | "total">("each");
  const [totalInput, setTotalInput] = useState("");

  // Split a single total across the selected items, weighted by each item's
  // best-known value (comp → estimate → sale history), even where unknown. Cents
  // are reconciled so the per-item prices sum exactly to the total.
  function distribute(totalStr: string, sel: SellableItem[]) {
    const total = parseAmt(totalStr);
    if (!totalStr || total <= 0 || sel.length === 0) return;
    const present = sel.map((i) => i.suggestedValue).filter((v): v is number => v != null && v > 0);
    const avg = present.length ? present.reduce((a, b) => a + b, 0) / present.length : 0;
    const weights = sel.map((i) => (i.suggestedValue != null && i.suggestedValue > 0 ? i.suggestedValue : avg || 1));
    const wsum = weights.reduce((a, b) => a + b, 0);
    const next: Record<string, string> = { ...prices };
    let acc = 0;
    sel.forEach((i, idx) => {
      const share = idx === sel.length - 1 ? Math.round((total - acc) * 100) / 100 : Math.round(((total * weights[idx]) / wsum) * 100) / 100;
      if (idx < sel.length - 1) acc = Math.round((acc + share) * 100) / 100;
      next[i.id] = share.toFixed(2);
    });
    setPrices(next);
  }

  const isYen = currency === "JPY";
  const sym = isYen ? "¥" : "$";
  // Convert a value entered in the selected currency to USD for storage.
  const toUsd = (n: number) => (isYen ? n / rate : n);
  const fmt = (n: number) => (isYen ? `¥${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`);

  const chosen = items.filter((i) => selected[i.id]);
  const total = chosen.reduce((s, i) => s + parseAmt(prices[i.id]), 0);

  // Auto-calculated fees in the SELECTED currency. The flat fee + default shipping
  // are stored in USD, so convert them to yen when entering a yen sale.
  const calc = useMemo(() => {
    const flat = isYen ? fees.ebayFlatFee * rate : fees.ebayFlatFee;
    const ship = isYen ? fees.defaultShipping * rate : fees.defaultShipping;
    if (platform === "EBAY") {
      return { ebayFee: total * fees.ebayFeePct + (total > 0 ? flat : 0), mercariFee: 0, adFee: total * fees.adFeePct, shippingFee: ship };
    }
    if (platform === "MERCARI") {
      return { ebayFee: 0, mercariFee: total * fees.mercariFeePct, adFee: 0, shippingFee: ship };
    }
    return { ebayFee: 0, mercariFee: 0, adFee: 0, shippingFee: ship };
  }, [platform, total, fees, isYen, rate]);

  const [manual, setManual] = useState({ ebayFee: "", mercariFee: "", adFee: "", shippingFee: "" });
  const eff = autoFees
    ? calc
    : {
        ebayFee: parseAmt(manual.ebayFee),
        mercariFee: parseAmt(manual.mercariFee),
        adFee: parseAmt(manual.adFee),
        shippingFee: parseAmt(manual.shippingFee)
      };
  const totalFees = eff.ebayFee + eff.mercariFee + eff.adFee + eff.shippingFee;
  const estNet = total - totalFees;

  const filtered = items
    .filter(
      (i) =>
        // Always keep already-selected items visible, even if the search would
        // otherwise hide them — filtering must never drop items from the sale.
        selected[i.id] ||
        !search ||
        i.title.toLowerCase().includes(search.toLowerCase()) ||
        i.lotTitle.toLowerCase().includes(search.toLowerCase()) ||
        (i.condition?.toLowerCase().includes(search.toLowerCase()) ?? false)
    )
    // Selected items float to the top so they're easy to see while building a sale.
    .sort((a, b) => (selected[b.id] ? 1 : 0) - (selected[a.id] ? 1 : 0));

  const formRef = useRef<HTMLFormElement>(null);

  /** Record the sale, then reset the form to a fresh state (selection, prices,
   *  fees, total, search, date, notes). Platform + currency toggles are kept —
   *  handy when recording several sales from the same marketplace in a row. */
  async function submit(fd: FormData) {
    await recordSale(fd);
    setSelected({});
    setPrices({});
    setSearch("");
    setTotalInput("");
    setPriceMode("each");
    setManual({ ebayFee: "", mercariFee: "", adFee: "", shippingFee: "" });
    setAutoFees(true);
    formRef.current?.reset(); // clears the uncontrolled fields (sold date, notes)
  }

  return (
    <form ref={formRef} action={submit} className="space-y-4">
      <input type="hidden" name="platform" value={platform} />
      {/* Lock today's rate so this sale's yen value is fixed going forward (USD per JPY). */}
      <input type="hidden" name="fxRate" value={(1 / rate).toFixed(8)} />
      {/* Fees are always submitted in USD. */}
      <input type="hidden" name="ebayFee" value={toUsd(eff.ebayFee).toFixed(2)} />
      <input type="hidden" name="mercariFee" value={toUsd(eff.mercariFee).toFixed(2)} />
      <input type="hidden" name="adFee" value={toUsd(eff.adFee).toFixed(2)} />
      <input type="hidden" name="shippingFee" value={toUsd(eff.shippingFee).toFixed(2)} />
      {/* When entering in yen, the EXACT yen figures are stored too — not just
          the rounded USD conversion. */}
      {isYen && (
        <>
          <input type="hidden" name="ebayFeeJpy" value={eff.ebayFee ? eff.ebayFee.toFixed(0) : ""} />
          <input type="hidden" name="mercariFeeJpy" value={eff.mercariFee ? eff.mercariFee.toFixed(0) : ""} />
          <input type="hidden" name="adFeeJpy" value={eff.adFee ? eff.adFee.toFixed(0) : ""} />
          <input type="hidden" name="shippingFeeJpy" value={eff.shippingFee ? eff.shippingFee.toFixed(0) : ""} />
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Platform</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="input">
            <option value="EBAY">eBay</option>
            <option value="MERCARI">Mercari</option>
            <option value="FACEBOOK">Facebook</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        <div>
          <label className="label">Sold date</label>
          <input name="soldAt" type="date" className="input" />
        </div>
      </div>

      {/* Currency toggle */}
      <div>
        <label className="label">Enter amounts in</label>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {(["USD", "JPY"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCurrency(c)}
              className={`flex-1 rounded-md px-3 py-1.5 font-medium ${currency === c ? "bg-white shadow-sm" : "text-slate-500"}`}
            >
              {c === "USD" ? "USD ($)" : "Yen (¥)"}
            </button>
          ))}
        </div>
        {isYen && (
          <p className="mt-1 text-xs text-slate-400">Converted to USD at the live rate (≈ ¥{rate.toFixed(1)} / $1) when saved.</p>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="label mb-0">Items in this sale ({chosen.length})</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items…" className="input w-44 py-1" />
        </div>
        <p className="mb-2 text-xs text-slate-400">
          Pick one or more — including items from different lots. Cost &amp; profit roll back to each item&apos;s origin lot automatically.
        </p>

        <div className="mb-2 flex items-center gap-2 text-xs">
          <span className="text-slate-400">Pricing:</span>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
            <button type="button" onClick={() => setPriceMode("each")} className={`rounded px-2 py-1 font-medium ${priceMode === "each" ? "bg-white shadow-sm" : "text-slate-500"}`}>
              Price each
            </button>
            <button
              type="button"
              onClick={() => { setPriceMode("total"); if (totalInput) distribute(totalInput, chosen); }}
              className={`rounded px-2 py-1 font-medium ${priceMode === "total" ? "bg-white shadow-sm" : "text-slate-500"}`}
            >
              One total (lot)
            </button>
          </div>
        </div>

        {priceMode === "total" && (
          <div className="mb-2 rounded-lg bg-slate-50 p-3">
            <label className="label mb-1">Total sale price ({sym})</label>
            <input
              inputMode="decimal"
              value={totalInput}
              onChange={(e) => { setTotalInput(e.target.value); distribute(e.target.value, chosen); }}
              className="input"
              placeholder="one price for all selected items"
            />
            <p className="mt-1 text-xs text-slate-400">
              Split across selected items by each one&apos;s value (comp → estimate → past sales), evenly where unknown. Edit any line below to fine-tune.
            </p>
            {chosen.length > 0 && parseAmt(totalInput) > 0 && (
              <p className={`mt-1 text-xs ${Math.abs(total - parseAmt(totalInput)) < 0.005 ? "text-slate-400" : "text-amber-600"}`}>
                Allocated {fmt(total)} of {fmt(parseAmt(totalInput))}
                {Math.abs(total - parseAmt(totalInput)) >= 0.005 && ` — off by ${fmt(total - parseAmt(totalInput))}`}
              </p>
            )}
          </div>
        )}

        <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
          {filtered.length === 0 ? (
            <p className="p-4 text-center text-sm text-slate-400">No unsold items.</p>
          ) : (
            filtered.map((i) => (
              <label key={i.id} className="flex items-center gap-3 border-b border-slate-50 px-3 py-2 last:border-0 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={!!selected[i.id]}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    const ns = { ...selected, [i.id]: checked };
                    setSelected(ns);
                    if (priceMode === "total" && totalInput) {
                      distribute(totalInput, items.filter((x) => ns[x.id]));
                    } else if (checked && !prices[i.id] && i.estimatedValue) {
                      setPrices((p) => ({ ...p, [i.id]: String(i.estimatedValue) }));
                    }
                  }}
                />
                <span className="flex-1">
                  <span className="text-sm font-medium">{i.title}</span>
                  {i.condition && (
                    <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{i.condition}</span>
                  )}
                  <span className="block text-xs text-slate-400">{i.isLot ? `lot: ${i.lotTitle}` : "single"}</span>
                </span>
                {selected[i.id] && (
                  <span className="flex items-center gap-1">
                    <span className="text-xs text-slate-400">{sym}</span>
                    <input
                      inputMode="decimal"
                      value={prices[i.id] ?? ""}
                      onChange={(e) => setPrices((p) => ({ ...p, [i.id]: e.target.value }))}
                      className="input w-24 py-1"
                      placeholder="price"
                    />
                  </span>
                )}
              </label>
            ))
          )}
        </div>

        {/* Submit EVERY selected item (and its USD price), independent of the
            current search filter — so filtering the list never drops items
            from the sale. */}
        {chosen.map((i) => (
          <span key={i.id}>
            <input type="hidden" name="itemId" value={i.id} />
            <input type="hidden" name={`price_${i.id}`} value={toUsd(parseAmt(prices[i.id])).toFixed(2)} />
            {/* Exact entered yen rides along when the ¥ toggle is on. */}
            {isYen && <input type="hidden" name={`priceJpy_${i.id}`} value={parseAmt(prices[i.id]) || ""} />}
          </span>
        ))}
      </div>

      <div className="rounded-lg bg-slate-50 p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={autoFees} onChange={(e) => setAutoFees(e.target.checked)} />
          Auto-calculate fees from my settings
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([["ebayFee", "eBay fee"], ["mercariFee", "Mercari fee"], ["adFee", "Ad fee"], ["shippingFee", "Shipping"]] as const).map(([k, label]) => (
            <div key={k}>
              <label className="label">
                {label} ({sym})
              </label>
              <input
                inputMode="decimal"
                disabled={autoFees}
                value={autoFees ? eff[k].toFixed(2) : manual[k]}
                onChange={(e) => setManual((m) => ({ ...m, [k]: e.target.value }))}
                className="input disabled:bg-slate-100"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-slate-50 p-2">
          <div className="text-xs text-slate-500">Gross</div>
          <div className="font-bold">{fmt(total)}</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <div className="text-xs text-slate-500">Fees</div>
          <div className="font-bold text-red-500">{fmt(totalFees)}</div>
        </div>
        <div className="rounded-lg bg-emerald-50 p-2">
          <div className="text-xs text-slate-500">Est. net (pre-cost)</div>
          <div className="font-bold text-emerald-600">{fmt(estNet)}</div>
        </div>
      </div>
      {isYen && (
        <p className="-mt-2 text-center text-xs text-slate-400">
          Saved as USD → gross ${toUsd(total).toFixed(2)} · net ${toUsd(estNet).toFixed(2)}
        </p>
      )}

      <div>
        <label className="label">Notes</label>
        <input name="notes" className="input" />
      </div>

      <button className="btn-primary w-full" disabled={chosen.length === 0}>
        Record sale
      </button>
    </form>
  );
}

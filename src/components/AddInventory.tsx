"use client";

import { useState } from "react";
import Link from "next/link";
import { createSinglePurchase, createLotPurchase } from "@/lib/actions";
import { CATEGORIES, conditionsFor, tracksCondition } from "@/lib/catalog";
import ScanButton from "./ScanButton";
import LocationField from "./LocationField";

const SOURCES = ["Book Off", "Garage Sale", "Estate Sale", "Thrift Store", "Facebook Marketplace", "Mercari", "Other"];

/** Tax input with a ¥/$ selector. Submits taxUsd always; when typed in yen the
 *  exact yen amount is stored too (taxJpy). */
function TaxField({ rate, label = "Tax", defaultCurrency = "JPY" }: { rate: number; label?: string; defaultCurrency?: "USD" | "JPY" }) {
  const [tax, setTax] = useState("");
  const [cur, setCur] = useState<"USD" | "JPY">(defaultCurrency);
  const n = Number(tax);
  const valid = tax.trim() !== "" && Number.isFinite(n);
  const usd = valid ? (cur === "JPY" ? n / rate : n).toFixed(2) : "";
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex gap-2">
        <input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} className="input" placeholder="0" />
        <select value={cur} onChange={(e) => setCur(e.target.value as "USD" | "JPY")} className="input w-20">
          <option>JPY</option>
          <option>USD</option>
        </select>
      </div>
      <input type="hidden" name="taxUsd" value={usd} />
      <input type="hidden" name="taxJpy" value={valid && cur === "JPY" ? tax : ""} />
      {cur === "JPY" && valid && <p className="mt-1 text-[10px] text-slate-400">≈ ${usd}</p>}
    </div>
  );
}

/** Shared yen→USD live helper. Fills the USD field when you type a yen amount. */
function YenUsd({ rate }: { rate: number }) {
  const [jpy, setJpy] = useState("");
  const [usd, setUsd] = useState("");
  const [usdEdited, setUsdEdited] = useState(false);

  function onJpy(v: string) {
    setJpy(v);
    if (!usdEdited) setUsd(v ? (Number(v) / rate).toFixed(2) : "");
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="label">Yen cost (¥)</label>
        <input
          name="costJpy"
          inputMode="decimal"
          className="input"
          value={jpy}
          onChange={(e) => onJpy(e.target.value)}
          placeholder="e.g. 2970"
        />
      </div>
      <div>
        <label className="label">USD cost ($)</label>
        <input
          name="costUsd"
          inputMode="decimal"
          className="input"
          value={usd}
          onChange={(e) => {
            setUsd(e.target.value);
            setUsdEdited(true);
          }}
          placeholder="auto from ¥"
        />
      </div>
      <input type="hidden" name="fxRate" value={(1 / rate).toFixed(8)} />
      <p className="col-span-2 -mt-1 text-xs text-slate-400">
        Live rate ≈ ¥{rate.toFixed(1)} / $1. Edit the USD field if you paid a different effective rate.
      </p>
    </div>
  );
}

function PersonalToggle({ personal, setPersonal }: { personal: boolean; setPersonal: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm">
      <input type="checkbox" name="isPersonal" checked={personal} onChange={(e) => setPersonal(e.target.checked)} className="mt-0.5" />
      <span>
        <span className="font-medium">Personal belonging</span>
        <span className="block text-xs text-slate-500">I already owned this — no purchase cost. Tracked as a separate bucket and excluded from flip ROI.</span>
      </span>
    </label>
  );
}

export default function AddInventory({ rate, locations = [], defaultCurrency = "JPY" }: { rate: number; locations?: string[]; defaultCurrency?: "USD" | "JPY" }) {
  const [tab, setTab] = useState<"single" | "lot">("single");
  const [personal, setPersonal] = useState(false);
  const [title, setTitle] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [lotCategory, setLotCategory] = useState("");
  const [lookupMsg, setLookupMsg] = useState("");
  const [nearMatch, setNearMatch] = useState<null | { productId: string; name: string; sku: string; category: string | null; count: number }>(null);

  function useNearMatch() {
    if (!nearMatch) return;
    setSku(nearMatch.sku); // swap in the correct barcode
    setTitle(nearMatch.name);
    if (nearMatch.category) setCategory(nearMatch.category);
    setLookupMsg(`Corrected to “${nearMatch.name}”.`);
    setNearMatch(null);
  }

  async function onScan(code: string) {
    setSku(code);
    setNearMatch(null);
    setLookupMsg("Looking up name…");
    try {
      const res = await fetch(`/api/upc?code=${encodeURIComponent(code)}`);
      const d = await res.json();
      setNearMatch(d.near ?? null);
      if (d.owned) {
        // Already in your catalog → inherit the master name + category; you only
        // set what varies (condition, cost). Saving re-attaches to that product.
        setTitle(d.title);
        if (d.category) setCategory(d.category);
        setLookupMsg(
          `You already have ${d.count} of “${d.title}”${d.category ? ` (${d.category})` : ""}. Inheriting its name${d.category ? " + category" : ""} — just set condition & cost below.`
        );
      } else if (d.title) {
        if (!title) setTitle(d.title);
        setLookupMsg(`Found via ${d.source ?? "lookup"}: ${d.title}`);
      } else if (d.enabled === false) {
        setLookupMsg("Code saved. (Enable UPC lookup in Settings to auto-name new retail items.)");
      } else {
        setLookupMsg("No name found for this code — type it in.");
      }
    } catch {
      setLookupMsg("Lookup failed — type the name in.");
    }
  }

  return (
    <div className="card">
      <div className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
        <button
          onClick={() => setTab("single")}
          className={`flex-1 rounded-md px-3 py-1.5 font-medium ${tab === "single" ? "bg-white shadow-sm" : "text-slate-500"}`}
        >
          Single item
        </button>
        <button
          onClick={() => setTab("lot")}
          className={`flex-1 rounded-md px-3 py-1.5 font-medium ${tab === "lot" ? "bg-white shadow-sm" : "text-slate-500"}`}
        >
          Lot (many items)
        </button>
      </div>

      {tab === "single" ? (
        <form action={createSinglePurchase} className="space-y-3" key={tab}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Item name</label>
              <input name="title" required className="input" placeholder="e.g. New 3DS LL" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Barcode / SKU</label>
              <div className="flex gap-2">
                <input name="sku" className="input font-mono" placeholder="scan or type" value={sku} onChange={(e) => setSku(e.target.value)} />
                <ScanButton onCode={onScan} />
              </div>
              {lookupMsg && <p className="mt-1 text-xs text-slate-500">{lookupMsg}</p>}
              {nearMatch && (
                <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                  Did you mean <b>{nearMatch.name}</b>? Its barcode <span className="font-mono">{nearMatch.sku}</span> is one digit off — likely a mis-scan.
                  <div className="mt-1.5 flex gap-2">
                    <button type="button" onClick={useNearMatch} className="btn-primary px-2 py-1 text-xs">Use that item</button>
                    <button type="button" onClick={() => setNearMatch(null)} className="btn-ghost px-2 py-1 text-xs">No, it&apos;s different</button>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="label">Category</label>
              <select name="category" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">— none —</option>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            {tracksCondition(category) ? (
              <div>
                <label className="label">Condition</label>
                <select name="condition" className="input" defaultValue="">
                  <option value="">— set later —</option>
                  {conditionsFor(category).map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label className="label">Source</label>
                <select name="source" className="input" disabled={personal}>
                  {SOURCES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
            )}
            {tracksCondition(category) && (
              <div>
                <label className="label">Source</label>
                <select name="source" className="input" disabled={personal}>
                  {SOURCES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label">Purchased</label>
              <input name="purchasedAt" type="date" className="input" />
            </div>
          </div>
          {!personal && <LocationField locations={locations} />}
          <PersonalToggle personal={personal} setPersonal={setPersonal} />
          {!personal && <YenUsd rate={rate} />}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Est. resale value ($)</label>
              <input name="estimatedValue" inputMode="decimal" className="input" placeholder="optional" />
            </div>
            {!personal && <TaxField rate={rate} defaultCurrency={defaultCurrency} />}
          </div>
          <div>
            <label className="label">Notes</label>
            <input name="notes" className="input" />
          </div>
          <button className="btn-primary w-full">Add item</button>
        </form>
      ) : (
        <div className="space-y-3">
          <Link href="/lots/new" className="block rounded-lg border border-brand-200 bg-brand-50 p-3 text-center">
            <span className="block font-semibold text-brand-700">📷 Scan items into a lot →</span>
            <span className="mt-0.5 block text-xs text-brand-600/80">
              Scan each item — barcodes auto-fill the name &amp; category, you just set condition &amp; a photo. Best on your phone.
            </span>
          </Link>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" /> or type a list <span className="h-px flex-1 bg-slate-200" />
          </div>
        <form action={createLotPurchase} className="space-y-3">
          <div>
            <label className="label">Lot name <span className="font-normal text-slate-400">(optional)</span></label>
            <input name="title" className="input" placeholder="auto: “<source> lot · <date>” — type to override" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Source</label>
              <select name="source" className="input" disabled={personal}>
                {SOURCES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Category (applies to all)</label>
              <select name="category" className="input" value={lotCategory} onChange={(e) => setLotCategory(e.target.value)}>
                <option value="">— none —</option>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Purchased</label>
              <input name="purchasedAt" type="date" className="input" />
            </div>
          </div>
          {tracksCondition(lotCategory) && (
            <p className="-mt-1 text-xs text-slate-400">Tip: set each item&apos;s condition after, or use bulk edit on the Inventory page.</p>
          )}
          {!personal && <LocationField locations={locations} id="lot-locations-dl" />}
          <PersonalToggle personal={personal} setPersonal={setPersonal} />
          {!personal && (
            <>
              <YenUsd rate={rate} />
              <TaxField rate={rate} label="Tax on lot" defaultCurrency={defaultCurrency} />
            </>
          )}
          <div>
            <label className="label">Items in this lot (one per line)</label>
            <textarea
              name="items"
              rows={5}
              className="input"
              placeholder={"DQ 3 super famicom\ntorneko super famicom\nFF6 guide"}
            />
            <p className="mt-1 text-xs text-slate-400">
              Lot cost is split across these automatically — by each item's sale price as they sell. You can override any item's cost later.
            </p>
          </div>
          <div>
            <label className="label">Notes</label>
            <input name="notes" className="input" />
          </div>
          <button className="btn-primary w-full">Create lot</button>
        </form>
        </div>
      )}
    </div>
  );
}

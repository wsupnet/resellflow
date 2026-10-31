"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createLotDraft, addLotItem, addLooseLotItems } from "@/lib/actions";
import { CATEGORIES, conditionsFor, tracksCondition } from "@/lib/catalog";
import ScanButton from "./ScanButton";

const SOURCES = ["Book Off", "Garage Sale", "Estate Sale", "Thrift Store", "Facebook Marketplace", "Mercari", "Other"];

type Step = "setup" | "scan" | "loose" | "done";

const EMPTY_CARD = {
  sku: "",
  title: "",
  category: "",
  condition: "",
  estimatedValue: "",
  cost: "",
  costCur: "USD" as "USD" | "JPY",
  notes: "",
  qty: "1"
};

// Mobile browsers often KILL and reload this page while the native camera app is
// open (photo input or barcode scan), wiping React state and dumping the user
// back at step 1. The in-progress draft is persisted here so a reload resumes
// exactly where they left off. Ignored after 12h so stale drafts don't resurrect.
const DRAFT_KEY = "lotBuilderDraft";
const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * Guided, scan-driven lot entry. Steps: setup (source/date/cost) → scan loop
 * (one card per item, barcode pre-fills name+category, you set condition/photo) →
 * loose/no-barcode items → done. Items are written as you go so photos attach.
 */
export default function LotBuilder({ rate, locations = [], defaultCurrency = "JPY" }: { rate: number; locations?: string[]; defaultCurrency?: "USD" | "JPY" }) {
  // A blank scan card whose per-item cost currency defaults to the view currency.
  const freshCard = { ...EMPTY_CARD, costCur: defaultCurrency };
  const router = useRouter();
  const [step, setStep] = useState<Step>("setup");
  const [lotId, setLotId] = useState("");
  const [lotTitle, setLotTitle] = useState("");
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  // setup
  const [source, setSource] = useState(SOURCES[0]);
  const [purchasedAt, setPurchasedAt] = useState("");
  const [dateApprox, setDateApprox] = useState(false);
  const [costJpy, setCostJpy] = useState("");
  const [costUsd, setCostUsd] = useState("");
  const [usdEdited, setUsdEdited] = useState(false);
  const [tax, setTax] = useState("");
  const [taxCur, setTaxCur] = useState<"USD" | "JPY">(defaultCurrency);
  const [lotName, setLotName] = useState("");
  const [location, setLocation] = useState("");
  const [personal, setPersonal] = useState(false);

  // current scan card
  const [card, setCard] = useState(freshCard);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [lookupMsg, setLookupMsg] = useState("");
  const [nearMatch, setNearMatch] = useState<null | { productId: string; name: string; sku: string; category: string | null; count: number }>(null);

  function useNearMatch() {
    if (!nearMatch) return;
    setCard((c) => ({ ...c, sku: nearMatch.sku, title: nearMatch.name, category: nearMatch.category ?? c.category }));
    setLookupMsg(`Corrected to “${nearMatch.name}”.`);
    setNearMatch(null);
  }

  // loose items
  const [looseText, setLooseText] = useState("");
  const [looseCat, setLooseCat] = useState("");

  // ── Draft persistence: survive the camera-app page reload ──
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        // Only resume a real in-progress lot (it has a lot id) that's fresh.
        if (d?.lotId && Date.now() - (d.savedAt ?? 0) < DRAFT_MAX_AGE_MS) {
          setStep(d.step === "loose" ? "loose" : "scan");
          setLotId(d.lotId);
          setLotTitle(d.lotTitle ?? "");
          setCount(d.count ?? 0);
          setCard({ ...freshCard, ...(d.card ?? {}) });
          setLooseText(d.looseText ?? "");
          setLooseCat(d.looseCat ?? "");
          setLookupMsg("Resumed where you left off. If you'd just taken a photo, re-attach it below.");
        } else {
          localStorage.removeItem(DRAFT_KEY);
        }
      }
    } catch {
      /* ignore corrupt/unavailable storage */
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if ((step === "scan" || step === "loose") && lotId) {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ savedAt: Date.now(), step, lotId, lotTitle, count, card, looseText, looseCat })
        );
      } else if (step === "done") {
        localStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      /* storage full/unavailable — the flow still works, just without resume */
    }
  }, [hydrated, step, lotId, lotTitle, count, card, looseText, looseCat]);

  // Guard against accidentally leaving mid-lot — mobile back button, refresh, or
  // tab close. Only active while actually building (scan/loose steps).
  useEffect(() => {
    const active = step === "scan" || step === "loose";
    if (!active) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onPopState = () => {
      if (window.confirm("Leave the lot builder? Items you've already added are saved to the lot, but you'll exit this scan flow.")) {
        window.removeEventListener("popstate", onPopState);
        window.history.back();
      } else {
        // Re-arm: cancel the back by pushing our state again.
        window.history.pushState(null, "", window.location.href);
      }
    };

    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [step]);

  function setCardField<K extends keyof typeof EMPTY_CARD>(k: K, v: (typeof EMPTY_CARD)[K]) {
    setCard((c) => ({ ...c, [k]: v }));
  }

  function onJpy(v: string) {
    setCostJpy(v);
    if (!usdEdited) setCostUsd(v ? (Number(v) / rate).toFixed(2) : "");
  }

  function pickPhoto(f: File | null) {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhoto(f);
    setPhotoUrl(f ? URL.createObjectURL(f) : "");
  }

  async function startScanning() {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("source", source);
      if (purchasedAt) fd.set("purchasedAt", purchasedAt);
      if (dateApprox) fd.set("purchasedAtApprox", "on");
      if (lotName) fd.set("title", lotName);
      if (!personal && location) fd.set("location", location);
      if (personal) fd.set("isPersonal", "on");
      if (!personal) {
        if (costJpy) fd.set("costJpy", costJpy);
        if (costUsd) fd.set("costUsd", costUsd);
        if (tax && Number.isFinite(Number(tax))) {
          if (taxCur === "JPY") {
            // Store the exact yen + its USD conversion at the live rate.
            fd.set("taxJpy", tax);
            fd.set("taxUsd", (Number(tax) / rate).toFixed(2));
          } else {
            fd.set("taxUsd", tax);
          }
        }
        fd.set("fxRate", (1 / rate).toFixed(8));
      }
      const res = await createLotDraft(fd);
      setLotId(res.id);
      setLotTitle(res.title);
      setStep("scan");
    } finally {
      setBusy(false);
    }
  }

  async function onScan(code: string) {
    setCardField("sku", code);
    setNearMatch(null);
    setLookupMsg("Looking up…");
    try {
      const res = await fetch(`/api/upc?code=${encodeURIComponent(code)}`);
      const d = await res.json();
      setNearMatch(d.near ?? null);
      if (d.owned) {
        setCard((c) => ({ ...c, sku: code, title: d.title, category: d.category ?? c.category }));
        setLookupMsg(`In your catalog (${d.count}×)${d.category ? ` · ${d.category}` : ""} — just set the condition & anything unique.`);
      } else if (d.title) {
        setCard((c) => ({ ...c, sku: code, title: c.title || d.title }));
        setLookupMsg(`Found via ${d.source ?? "lookup"}: ${d.title}. Pick a category to finish.`);
      } else if (d.enabled === false) {
        setLookupMsg("New code — enter name + category. (Enable UPC lookup in Settings to auto-name retail items.)");
      } else {
        setLookupMsg("New code — enter the name + category to add it to your catalog.");
      }
    } catch {
      setLookupMsg("Lookup failed — enter details manually.");
    }
  }

  function costUsdForItem() {
    if (card.cost.trim() === "" || !Number.isFinite(Number(card.cost))) return "";
    return (card.costCur === "JPY" ? Number(card.cost) / rate : Number(card.cost)).toFixed(2);
  }

  async function addItem(next: boolean) {
    if (!card.title.trim()) {
      setLookupMsg("Name is required before you can add this item.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("lotId", lotId);
      fd.set("title", card.title.trim());
      if (card.sku) fd.set("sku", card.sku);
      if (card.category) fd.set("category", card.category);
      if (card.condition) fd.set("condition", card.condition);
      if (card.estimatedValue) fd.set("estimatedValue", card.estimatedValue);
      const cu = costUsdForItem();
      if (cu) fd.set("costOverrideUsd", cu);
      // Keep the exact typed yen when the cost was entered in ¥.
      if (cu && card.costCur === "JPY") fd.set("costOverrideJpy", card.cost);
      if (card.notes) fd.set("notes", card.notes);
      fd.set("qty", card.qty || "1");
      if (photo) fd.set("photo", photo);
      const res = await addLotItem(fd);
      setCount(res.count);
      setCard(freshCard);
      pickPhoto(null);
      setLookupMsg("");
      setNearMatch(null);
      if (!next) setStep("loose");
    } finally {
      setBusy(false);
    }
  }

  async function finishLoose() {
    setBusy(true);
    try {
      if (looseText.trim()) {
        const fd = new FormData();
        fd.set("lotId", lotId);
        fd.set("items", looseText);
        if (looseCat) fd.set("category", looseCat);
        const res = await addLooseLotItems(fd);
        setCount((c) => c + res.added);
        setLooseText("");
      }
      setStep("done");
    } finally {
      setBusy(false);
    }
  }

  const tracks = tracksCondition(card.category);
  const hasCardContent = card.title.trim() !== "" || card.sku !== "";

  // ─────────────────────────── render ───────────────────────────
  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">
          {step === "setup" ? "New lot" : lotTitle || "New lot"}
        </h1>
        <Link
          href="/inventory"
          onClick={() => {
            // A deliberate exit shouldn't leave a draft that resurrects next time.
            try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
          }}
          className="text-sm text-slate-400 hover:text-slate-600"
        >
          {step === "done" ? "Close" : "Cancel"}
        </Link>
      </div>
      {step !== "setup" && step !== "done" && (
        <p className="text-xs text-slate-400">{count} item{count === 1 ? "" : "s"} added so far</p>
      )}

      {/* ── SETUP ── */}
      {step === "setup" && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">Set the basics, then scan each item one at a time.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Source</label>
              <select value={source} onChange={(e) => setSource(e.target.value)} className="input" disabled={personal}>
                {SOURCES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Purchased</label>
              <input type="date" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} className="input" />
              <label className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                <input type="checkbox" checked={dateApprox} onChange={(e) => setDateApprox(e.target.checked)} /> Approximate (best guess)
              </label>
            </div>
          </div>
          {!personal && (
            <div>
              <label className="label">Location <span className="font-normal text-slate-400">(optional)</span></label>
              <input value={location} onChange={(e) => setLocation(e.target.value)} list="lotbuilder-locations" autoComplete="off" className="input" placeholder="e.g. Book Off, Thrift store — pick or type" />
              <datalist id="lotbuilder-locations">
                {locations.map((l) => <option key={l} value={l} />)}
              </datalist>
            </div>
          )}
          {!personal && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Total yen cost (¥)</label>
                  <input inputMode="decimal" value={costJpy} onChange={(e) => onJpy(e.target.value)} className="input" placeholder="e.g. 2970" />
                </div>
                <div>
                  <label className="label">Total USD cost ($)</label>
                  <input inputMode="decimal" value={costUsd} onChange={(e) => { setCostUsd(e.target.value); setUsdEdited(true); }} className="input" placeholder="auto from ¥" />
                </div>
              </div>
              <div>
                <label className="label">Tax on lot</label>
                <div className="flex gap-2">
                  <input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} className="input" placeholder="optional" />
                  <select value={taxCur} onChange={(e) => setTaxCur(e.target.value as "USD" | "JPY")} className="input w-20">
                    <option>JPY</option>
                    <option>USD</option>
                  </select>
                </div>
                {taxCur === "JPY" && tax && Number.isFinite(Number(tax)) && (
                  <p className="mt-1 text-[10px] text-slate-400">≈ ${(Number(tax) / rate).toFixed(2)}</p>
                )}
              </div>
              <p className="-mt-1 text-xs text-slate-400">
                Lot cost is split across items by sale price. You can set an individual item&apos;s cost on its card as you scan.
              </p>
            </>
          )}
          <div>
            <label className="label">Lot name <span className="font-normal text-slate-400">(optional)</span></label>
            <input value={lotName} onChange={(e) => setLotName(e.target.value)} className="input" placeholder="auto: “<source> lot · <date>”" />
          </div>
          <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm">
            <input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="font-medium">Personal belongings</span>
              <span className="block text-xs text-slate-500">Items I already owned — no cost, excluded from flip ROI.</span>
            </span>
          </label>
          <button onClick={startScanning} disabled={busy} className="btn-primary w-full">
            {busy ? "Starting…" : "Start scanning →"}
          </button>
        </div>
      )}

      {/* ── SCAN LOOP ── */}
      {step === "scan" && (
        <div className="space-y-3">
          <div>
            <label className="label">Barcode</label>
            <div className="flex gap-2">
              <input
                value={card.sku}
                onChange={(e) => setCardField("sku", e.target.value)}
                className="input font-mono"
                placeholder="scan or type a code"
              />
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
            <label className="label">Name</label>
            <input value={card.title} onChange={(e) => setCardField("title", e.target.value)} className="input" placeholder="item name" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Category</label>
              <select value={card.category} onChange={(e) => setCardField("category", e.target.value)} className="input">
                <option value="">— none —</option>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            {tracks ? (
              <div>
                <label className="label">Condition</label>
                <select value={card.condition} onChange={(e) => setCardField("condition", e.target.value)} className="input">
                  <option value="">— set later —</option>
                  {conditionsFor(card.category).map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label className="label">Quantity</label>
                <input inputMode="numeric" value={card.qty} onChange={(e) => setCardField("qty", e.target.value)} className="input" />
              </div>
            )}
          </div>

          {tracks && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Quantity</label>
                <input inputMode="numeric" value={card.qty} onChange={(e) => setCardField("qty", e.target.value)} className="input" />
                <p className="mt-1 text-[10px] text-slate-400">Same condition? Set a count instead of re-scanning.</p>
              </div>
              <div>
                <label className="label">Est. value ($)</label>
                <input inputMode="decimal" value={card.estimatedValue} onChange={(e) => setCardField("estimatedValue", e.target.value)} className="input" placeholder="optional" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {!tracks && (
              <div>
                <label className="label">Est. value ($)</label>
                <input inputMode="decimal" value={card.estimatedValue} onChange={(e) => setCardField("estimatedValue", e.target.value)} className="input" placeholder="optional" />
              </div>
            )}
            <div>
              <label className="label">This item&apos;s cost <span className="font-normal text-slate-400">(optional)</span></label>
              <div className="flex gap-2">
                <input inputMode="decimal" value={card.cost} onChange={(e) => setCardField("cost", e.target.value)} className="input" placeholder="blank = split" />
                <select value={card.costCur} onChange={(e) => setCardField("costCur", e.target.value as "USD" | "JPY")} className="input w-20">
                  <option>USD</option>
                  <option>JPY</option>
                </select>
              </div>
              {card.costCur === "JPY" && costUsdForItem() !== "" && (
                <p className="mt-1 text-[10px] text-slate-400">≈ ${costUsdForItem()}</p>
              )}
            </div>
          </div>

          <div>
            <label className="label">Photo <span className="font-normal text-slate-400">(optional)</span></label>
            <div className="flex items-center gap-3">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt="" className="h-14 w-14 rounded object-cover" />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded bg-slate-100 text-slate-300">📷</span>
              )}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
                className="text-sm"
              />
              {photo && (
                <button type="button" onClick={() => pickPhoto(null)} className="text-xs text-slate-400 hover:text-red-500">remove</button>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={() => addItem(true)} disabled={busy || !card.title.trim()} className="btn-primary flex-1">
              {busy ? "Adding…" : "Add & scan next"}
            </button>
            <button onClick={() => addItem(false)} disabled={busy || !card.title.trim()} className="btn-ghost">
              Add &amp; finish
            </button>
          </div>
          <button onClick={() => setStep("loose")} disabled={busy} className="w-full text-center text-xs text-slate-400 hover:text-slate-600">
            {hasCardContent ? "Discard this one and finish →" : "Done scanning — finish up →"}
          </button>
        </div>
      )}

      {/* ── LOOSE / NO-BARCODE ── */}
      {step === "loose" && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Any loose items or things without a barcode to add to this lot? List them one per line — otherwise just finish.
          </p>
          <div>
            <label className="label">Items (one per line)</label>
            <textarea rows={5} value={looseText} onChange={(e) => setLooseText(e.target.value)} className="input" placeholder={"loose famicom cart\nold strategy guide"} />
          </div>
          <div>
            <label className="label">Category for these <span className="font-normal text-slate-400">(optional, applies to all)</span></label>
            <select value={looseCat} onChange={(e) => setLooseCat(e.target.value)} className="input">
              <option value="">— none —</option>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={finishLoose} disabled={busy} className="btn-primary flex-1">
              {busy ? "Saving…" : looseText.trim() ? "Add these & finish lot" : "Finish lot"}
            </button>
            <button onClick={() => setStep("scan")} disabled={busy} className="btn-ghost">← Scan more</button>
          </div>
        </div>
      )}

      {/* ── DONE ── */}
      {step === "done" && (
        <div className="space-y-4 text-center">
          <div className="text-3xl">✅</div>
          <p className="text-sm text-slate-600">
            <b>{lotTitle}</b> created with <b>{count}</b> item{count === 1 ? "" : "s"}.
          </p>
          <div className="flex flex-col gap-2">
            <button onClick={() => router.push(`/lots/${lotId}`)} className="btn-primary w-full">View the lot</button>
            <Link href="/inventory" className="text-sm text-brand-600 hover:underline">Back to inventory</Link>
          </div>
        </div>
      )}
    </div>
  );
}

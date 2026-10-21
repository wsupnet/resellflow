"use client";

import { useState } from "react";
import { createExpense } from "@/lib/actions";

export interface AttachOption {
  value: string; // "" | "purchase:id" | "item:id" | "sale:id"
  label: string;
  group: "General" | "Lots" | "Items" | "Sales";
}

const CATEGORIES = ["Commission", "Import Fee", "Customs/Duty", "Supplies", "Shipping", "Subscription", "Mileage", "Other"];

/** Strip a leading +/- the user might type; the sign comes from the toggle, not the field. */
const magnitude = (v: string) => v.replace(/^[+\-]/, "");

export default function ExpenseForm({ attachOptions, rate, defaultCurrency = "JPY" }: { attachOptions: AttachOption[]; rate: number; defaultCurrency?: "USD" | "JPY" }) {
  const [attach, setAttach] = useState("");
  const [sign, setSign] = useState<1 | -1>(1);
  const [amount, setAmount] = useState("");
  const [cur, setCur] = useState<"USD" | "JPY">(defaultCurrency);
  const groups: AttachOption["group"][] = ["General", "Lots", "Items", "Sales"];

  // The finance math is all USD, so we always derive & store a USD value —
  // converting from yen at the live rate when JPY is selected. The exact yen is
  // stored too (amountJpy) only when entered in yen. Sign comes from the toggle.
  const mag = Math.abs(Number(amount) || 0);
  const valid = amount.trim() !== "" && Number.isFinite(Number(amount));
  const usdVal = cur === "JPY" ? mag / rate : mag;
  const signedUsd = valid ? (sign * usdVal).toFixed(2) : "";
  const signedJpy = valid && cur === "JPY" ? String(sign * mag) : "";

  return (
    <form action={createExpense} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Category</label>
          <select name="category" className="input">
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Date</label>
          <input name="date" type="date" className="input" />
        </div>
      </div>

      <div>
        <label className="label">Type</label>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          <button
            type="button"
            onClick={() => setSign(1)}
            className={`flex-1 rounded-md px-3 py-1.5 font-medium ${sign === 1 ? "bg-white text-red-600 shadow-sm" : "text-slate-500"}`}
          >
            − Expense
          </button>
          <button
            type="button"
            onClick={() => setSign(-1)}
            className={`flex-1 rounded-md px-3 py-1.5 font-medium ${sign === -1 ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500"}`}
          >
            + Credit / income
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {sign === -1 ? "Credit adds to net — e.g. a refund, rebate, or reimbursement." : "Expense reduces net, like a fee."}
        </p>
      </div>

      <div>
        <label className="label">Amount</label>
        <div className="flex gap-2">
          <input value={amount} onChange={(e) => setAmount(magnitude(e.target.value))} inputMode="decimal" required className="input" placeholder={cur === "JPY" ? "e.g. 3000" : "e.g. 90"} />
          <select value={cur} onChange={(e) => setCur(e.target.value as "USD" | "JPY")} className="input w-20">
            <option>JPY</option>
            <option>USD</option>
          </select>
        </div>
        <input type="hidden" name="amountUsd" value={signedUsd} />
        <input type="hidden" name="amountJpy" value={signedJpy} />
        {cur === "JPY" && valid && (
          <p className="mt-1 text-xs text-slate-400">≈ ${usdVal.toFixed(2)} at ¥{rate.toFixed(1)}/$1</p>
        )}
      </div>

      <div>
        <label className="label">Attach to</label>
        <select name="attach" value={attach} onChange={(e) => setAttach(e.target.value)} className="input">
          {groups.map((g) => {
            const opts = attachOptions.filter((o) => o.group === g);
            if (opts.length === 0) return null;
            if (g === "General") return opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>);
            return (
              <optgroup key={g} label={g}>
                {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </optgroup>
            );
          })}
        </select>
        <p className="mt-1 text-xs text-slate-400">
          Attached entries roll into that lot&apos;s/item&apos;s/sale&apos;s net (expenses reduce it, credits add to it); general ones affect overall profit. All count toward ROI.
        </p>
      </div>

      <div>
        <label className="label">Description</label>
        <input name="description" className="input" placeholder="e.g. Partner's cut for a consignment sale" />
      </div>

      <button className="btn-primary w-full">Add expense</button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { updateExpense, deleteExpense } from "@/lib/actions";
import ConfirmButton from "@/components/ConfirmButton";
import { fmtMoney, shortDate, type MoneyCtx } from "@/lib/format";
import type { AttachOption } from "@/components/ExpenseForm";

const magnitude = (v: string) => v.replace(/^[+\-]/, "");

export interface LedgerExpense {
  id: string;
  category: string;
  description: string | null;
  amountUsd: number;
  amountJpy: number | null;
  date: string;
}

/** One ledger row: display + an inline edit form (category, sign, amount, re-attach). */
export default function ExpenseEditRow({
  expense: e,
  attachOptions,
  attachValue,
  attachLabel,
  m
}: {
  expense: LedgerExpense;
  attachOptions: AttachOption[];
  attachValue: string;
  attachLabel: string;
  m: MoneyCtx;
}) {
  const isCredit = e.amountUsd < 0;
  const [sign, setSign] = useState<1 | -1>(isCredit ? -1 : 1);
  const [usd, setUsd] = useState(String(Math.abs(e.amountUsd)));
  const [jpy, setJpy] = useState(e.amountJpy != null ? String(Math.abs(e.amountJpy)) : "");

  const signedUsd = usd.trim() === "" ? "0" : String(sign * Math.abs(Number(usd) || 0));
  const signedJpy = jpy.trim() === "" ? "" : String(sign * Math.abs(Number(jpy) || 0));

  const groups: AttachOption["group"][] = ["General", "Lots", "Items", "Sales"];

  return (
    <div className="rounded-lg border border-slate-100 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className={`font-medium ${isCredit ? "text-emerald-600" : ""}`}>
            {isCredit ? "+" : ""}
            {fmtMoney(Math.abs(e.amountUsd), m)}
          </span>
          {isCredit && <span className="ml-1.5 pill bg-emerald-100 text-emerald-700">credit</span>}
          <span className="ml-2 pill bg-slate-100 text-slate-600">{e.category}</span>
          <span className="ml-2 text-xs text-slate-400">{shortDate(e.date)}</span>
        </div>
        <form action={deleteExpense}>
          <input type="hidden" name="id" value={e.id} />
          <ConfirmButton
            message={`Delete this ${e.category} ${isCredit ? "credit" : "expense"} (${fmtMoney(Math.abs(e.amountUsd), m)})?`}
            className="text-xs text-red-500 hover:underline"
          >
            Delete
          </ConfirmButton>
        </form>
      </div>
      {e.description && <div className="mt-1 text-sm text-slate-600">{e.description}</div>}
      <div className="mt-1 text-xs text-slate-500">→ {attachLabel}</div>

      <form action={updateExpense} className="mt-2 space-y-2 border-t border-slate-100 pt-2">
        <input type="hidden" name="id" value={e.id} />
        <input type="hidden" name="category" value={e.category} />
        <input type="hidden" name="description" value={e.description ?? ""} />
        <input type="hidden" name="amountUsd" value={signedUsd} />
        <input type="hidden" name="amountJpy" value={signedJpy} />

        <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setSign(1)}
            className={`flex-1 rounded px-2 py-1 font-medium ${sign === 1 ? "bg-white text-red-600 shadow-sm" : "text-slate-500"}`}
          >
            − Expense
          </button>
          <button
            type="button"
            onClick={() => setSign(-1)}
            className={`flex-1 rounded px-2 py-1 font-medium ${sign === -1 ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500"}`}
          >
            + Credit
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="w-24">
            <label className="label text-[11px]">Amount ($)</label>
            <input value={usd} onChange={(e2) => setUsd(magnitude(e2.target.value))} inputMode="decimal" className="input py-1.5 text-sm" />
          </div>
          <div className="w-24">
            <label className="label text-[11px]">Amount (¥)</label>
            <input value={jpy} onChange={(e2) => setJpy(magnitude(e2.target.value))} inputMode="decimal" className="input py-1.5 text-sm" placeholder="optional" />
          </div>
          <div className="grow">
            <label className="label text-[11px]">Re-attach</label>
            <select name="attach" defaultValue={attachValue} className="input py-1.5 text-sm">
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
          </div>
          <button className="btn-ghost py-1.5 text-sm">Save</button>
        </div>
      </form>
    </div>
  );
}

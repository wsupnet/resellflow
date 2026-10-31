"use client";

import { useState } from "react";
import { importInventoryCsv, importSalesCsv, restoreBackup, type ImportResult } from "@/lib/actions";

function BackupRestore() {
  const [res, setRes] = useState<{ error?: string; counts?: Record<string, number> } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!window.confirm("Restore this backup? It adds any records that are missing — it never deletes or overwrites what you already have.")) return;
    setBusy(true);
    setRes(null);
    const fd = new FormData(e.currentTarget);
    try {
      setRes(await restoreBackup(fd));
    } catch {
      setRes({ error: "Restore failed — is this a ResellFlow backup file?" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-brand-100 bg-brand-50/40 p-3">
      <div className="text-sm font-medium">Full backup &amp; restore</div>
      <p className="mb-2 text-xs text-slate-500">
        A complete snapshot of all your records (lots, items, products, sales, expenses, locations, settings). The <b>.zip</b> also bundles your photo image files; the <b>.json</b> is data-only (smaller). Restore accepts either.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <a href="/api/export?type=backup-zip" className="btn-primary py-1.5 text-sm">Download .zip (with photos)</a>
        <a href="/api/export?type=backup" className="btn-ghost py-1.5 text-sm">Download .json (data only)</a>
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
          <input type="file" name="file" accept=".json,.zip,application/json,application/zip" required className="text-sm" />
          <button className="btn-ghost py-1.5 text-sm" disabled={busy}>{busy ? "Restoring…" : "Restore"}</button>
        </form>
      </div>
      {res?.error && <p className="mt-2 text-sm text-red-600">{res.error}</p>}
      {res?.counts && (
        <p className="mt-2 text-sm text-slate-600">
          ✓ Restored {Object.values(res.counts).reduce((a, b) => a + b, 0)} records
          <span className="text-slate-400"> ({Object.entries(res.counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(", ") || "nothing new"})</span>
        </p>
      )}
    </div>
  );
}

function Result({ res }: { res: ImportResult }) {
  if (res.error) return <p className="mt-2 text-sm text-red-600">{res.error}</p>;
  return (
    <p className="mt-2 text-sm text-slate-600">
      ✓ Created <b>{res.created}</b>.
      {res.skipped.length > 0 && (
        <> Skipped {res.skipped.length}: <span className="text-slate-400">{res.skipped.slice(0, 8).join(", ")}{res.skipped.length > 8 ? "…" : ""}</span></>
      )}
    </p>
  );
}

function ImportOne({
  label,
  hint,
  action,
  templateHref
}: {
  label: string;
  hint: string;
  action: (fd: FormData) => Promise<ImportResult>;
  templateHref?: string;
}) {
  const [res, setRes] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setRes(null);
    const fd = new FormData(e.currentTarget);
    try {
      setRes(await action(fd));
    } catch {
      setRes({ created: 0, skipped: [], error: "Import failed — check the CSV format." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-slate-100 p-3">
      <div className="text-sm font-medium">{label}</div>
      <p className="mb-2 text-xs text-slate-400">{hint}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
        <button className="btn-ghost py-1.5 text-sm" disabled={busy}>{busy ? "Importing…" : "Import"}</button>
        {templateHref && (
          <a href={templateHref} className="text-xs text-brand-600 hover:underline" title="A CSV with the right headers + two example rows to overwrite">
            ⬇ Download template
          </a>
        )}
      </div>
      {res && <Result res={res} />}
    </form>
  );
}

export default function ImportPanel() {
  return (
    <div className="space-y-3">
      <BackupRestore />
      <ImportOne
        label="Import inventory"
        hint="CSV columns: title (required), sku, category, condition, status, source, location, costUsd, costJpy, estimatedValue, purchasedAt, dateApprox (yes = best-guess date), type (personal), notes. Each row creates a new single item."
        action={importInventoryCsv}
        templateHref="/api/export?type=template-inventory"
      />
      <ImportOne
        label="Import sales"
        hint="CSV columns: sku or title (to match an existing unsold item), salePrice, platform, soldAt, shippingFee, ebayFee, mercariFee, adFee. Each row records a sale."
        action={importSalesCsv}
        templateHref="/api/export?type=template-sales"
      />
      <p className="text-xs text-slate-400">
        Imports are additive — they only create new records and never overwrite existing data. Start from the templates above — they include two example rows to overwrite.
      </p>
    </div>
  );
}

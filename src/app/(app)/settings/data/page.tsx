import { requireUser } from "@/lib/auth";
import { SectionTitle } from "@/components/ui";
import { BackupRestore, CsvImports } from "@/components/ImportPanel";

export const dynamic = "force-dynamic";

export default async function DataSettings() {
  await requireUser();
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="card">
        <SectionTitle>Export CSV</SectionTitle>
        <p className="mb-3 text-sm text-slate-500">Download your records as spreadsheets.</p>
        <div className="flex flex-wrap gap-2">
          <a href="/api/export?type=inventory" className="btn-ghost py-1.5 text-sm">Inventory</a>
          <a href="/api/export?type=sales" className="btn-ghost py-1.5 text-sm">Sales</a>
          <a href="/api/export?type=lots" className="btn-ghost py-1.5 text-sm">Lots</a>
          <a href="/api/export?type=expenses" className="btn-ghost py-1.5 text-sm">Expenses</a>
        </div>
      </div>
      <div className="card">
        <SectionTitle>Backup &amp; restore</SectionTitle>
        <BackupRestore />
      </div>
      <div className="card xl:col-span-2">
        <SectionTitle>Import CSV</SectionTitle>
        <p className="mb-3 text-sm text-slate-500">Bulk-add records from a spreadsheet.</p>
        <CsvImports />
      </div>
    </div>
  );
}

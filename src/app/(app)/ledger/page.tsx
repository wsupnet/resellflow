import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { getFinancials } from "@/lib/queries";
import { getUsdToJpy } from "@/lib/fx";
import ExpenseForm, { type AttachOption } from "@/components/ExpenseForm";
import ExpenseEditRow from "@/components/ExpenseEditRow";
import { FilterSelect, Pagination } from "@/components/TableControls";
import { resolvePer, paginate } from "@/lib/paginate";
import { SectionTitle, StatCard } from "@/components/ui";
import { sortRows, dirOf } from "@/lib/sort";
import { fmtMoney, shortDate } from "@/lib/format";
import { getMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const CATEGORIES = ["Commission", "Import Fee", "Customs/Duty", "Supplies", "Shipping", "Subscription", "Mileage", "Other"];

export default async function LedgerPage({
  searchParams
}: {
  searchParams: { category?: string; sort?: string; dir?: string; page?: string; per?: string };
}) {
  const user = await requireUser();
  const [bundle, m, fx] = await Promise.all([getFinancials(user.id), getMoney(user.id), getUsdToJpy()]);

  // Build attach options + a lookup for labels.
  const attachOptions: AttachOption[] = [{ value: "", label: "General business expense", group: "General" }];
  const labelFor = new Map<string, string>();
  for (const p of bundle.purchases) {
    if (p.kind === "LOT") {
      attachOptions.push({ value: `purchase:${p.id}`, label: `Lot: ${p.title}`, group: "Lots" });
      labelFor.set(`purchase:${p.id}`, `Lot: ${p.title}`);
    }
    for (const i of p.items) {
      const lbl = `${i.title}${p.kind === "LOT" ? ` (in ${p.title})` : ""}`;
      attachOptions.push({ value: `item:${i.id}`, label: lbl, group: "Items" });
      labelFor.set(`item:${i.id}`, lbl);
    }
  }
  for (const s of bundle.sales) {
    const lbl = `Sale: ${s.platform.toLowerCase()} · ${shortDate(s.soldAt)}${s.lines[0] ? " · " + s.lines[0].item.title : ""}`;
    attachOptions.push({ value: `sale:${s.id}`, label: lbl, group: "Sales" });
    labelFor.set(`sale:${s.id}`, lbl);
  }

  const valueOf = (e: (typeof bundle.expenses)[number]) =>
    e.purchaseId ? `purchase:${e.purchaseId}` : e.itemId ? `item:${e.itemId}` : e.saleId ? `sale:${e.saleId}` : "";
  const attachLabel = (e: (typeof bundle.expenses)[number]) =>
    labelFor.get(valueOf(e)) ?? "General";

  const categoryFilter = searchParams.category ?? "";
  let expenses = bundle.expenses.filter((e) => !categoryFilter || e.category === categoryFilter);

  const sort = searchParams.sort ?? "date";
  const dir = dirOf(searchParams.dir ?? "desc");
  const getters: Record<string, (e: (typeof expenses)[number]) => string | number | Date | null> = {
    date: (e) => e.date,
    amount: (e) => e.amountUsd,
    category: (e) => e.category
  };
  expenses = sortRows(expenses, getters[sort] ?? getters.date, dir);
  const per = resolvePer(searchParams.per, cookies().get("pageSize")?.value);
  const pg = paginate(expenses, searchParams.page, per);

  // amountUsd is signed: positive = expense (reduces net), negative = credit/income (adds to net).
  const expensesTotal = bundle.expenses.filter((e) => e.amountUsd > 0).reduce((a, e) => a + e.amountUsd, 0);
  const creditsTotal = bundle.expenses.filter((e) => e.amountUsd < 0).reduce((a, e) => a - e.amountUsd, 0);
  const total = expensesTotal - creditsTotal;
  const attached = bundle.expenses.filter((e) => e.purchaseId || e.itemId || e.saleId).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">General ledger</h1>
        <p className="mt-1 text-sm text-slate-500">
          Business expenses and credits that aren&apos;t item purchases — import fees, commissions, supplies, or a refund/rebate.
          Attach them to a lot, item, or sale and they roll into its profit; everything here counts toward ROI.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Expenses" value={fmtMoney(expensesTotal, m)} tone="bad" help="All business costs logged here that aren't item purchases — fees, supplies, commissions. These reduce your profit." />
        <StatCard label="Credits" value={fmtMoney(creditsTotal, m)} tone={creditsTotal > 0 ? "good" : "default"} sub="refunds, rebates, etc." help="Money that came back to you — refunds, rebates, reimbursements. These add to your profit." />
        <StatCard label="Net effect on profit" value={fmtMoney(-total, m)} tone={-total >= 0 ? "good" : "bad"} sub="expenses − credits" help="What this whole ledger does to your bottom line: credits minus expenses. Negative means the ledger costs you money overall (normal)." />
        <StatCard label="Entries" value={String(bundle.expenses.length)} sub={`${attached} attached`} help="Total ledger entries. 'Attached' ones are tied to a specific lot, item, or sale and roll into its profit; the rest count as general overhead." />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
        <div className="card">
          <SectionTitle>Add expense</SectionTitle>
          <ExpenseForm attachOptions={attachOptions} rate={fx.rate} defaultCurrency={m.currency} />
        </div>

        <div className="card">
          <SectionTitle
            action={
              <FilterSelect param="category" label="All categories" options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
            }
          >
            Expenses ({expenses.length})
          </SectionTitle>

          {expenses.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No expenses yet.</p>
          ) : (
            <div className="space-y-3">
              {pg.rows.map((e) => (
                <ExpenseEditRow
                  key={e.id}
                  expense={{ id: e.id, category: e.category, description: e.description, amountUsd: e.amountUsd, amountJpy: e.amountJpy, date: e.date.toISOString() }}
                  attachOptions={attachOptions}
                  attachValue={valueOf(e)}
                  attachLabel={attachLabel(e)}
                  m={m}
                />
              ))}
            </div>
          )}
          {expenses.length > 0 && <Pagination {...pg} per={per} />}
        </div>
      </div>
    </div>
  );
}

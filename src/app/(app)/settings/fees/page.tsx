import { requireUser } from "@/lib/auth";
import { updateSettings } from "@/lib/actions";
import { loadSettings } from "@/lib/settings-data";
import { SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function FeesSettings() {
  const user = await requireUser();
  const settings = await loadSettings(user.id);
  return (
    <div className="card">
      <SectionTitle tip="Used to work out fees when you record a sale. Set them to what each platform charges you. Past sales keep the fees they were recorded with.">
        Selling fees
      </SectionTitle>
      <form action={updateSettings} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <input type="hidden" name="section" value="fees" />
        <div>
          <label className="label">eBay final value fee (%)</label>
          <input name="ebayFeePct" inputMode="decimal" defaultValue={(settings.ebayFeePct * 100).toFixed(2)} className="input" />
        </div>
        <div>
          <label className="label">eBay flat fee per order ($)</label>
          <input name="ebayFlatFee" inputMode="decimal" defaultValue={settings.ebayFlatFee.toFixed(2)} className="input" />
        </div>
        <div>
          <label className="label">eBay ad fee (%)</label>
          <input name="adFeePct" inputMode="decimal" defaultValue={(settings.adFeePct * 100).toFixed(2)} className="input" />
        </div>
        <div>
          <label className="label">Mercari fee (%)</label>
          <input name="mercariFeePct" inputMode="decimal" defaultValue={(settings.mercariFeePct * 100).toFixed(2)} className="input" />
        </div>
        <div>
          <label className="label">Default shipping ($)</label>
          <input name="defaultShipping" inputMode="decimal" defaultValue={settings.defaultShipping.toFixed(2)} className="input" />
        </div>
        <div className="flex items-end sm:col-span-2 xl:col-span-3">
          <button className="btn-primary">Save fees</button>
        </div>
      </form>
    </div>
  );
}

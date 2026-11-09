import { requireUser } from "@/lib/auth";
import { updateSettings } from "@/lib/actions";
import { loadSettings } from "@/lib/settings-data";
import { SectionTitle, FieldLabel } from "@/components/ui";
import InfoTip from "@/components/InfoTip";

export const dynamic = "force-dynamic";

export default async function CurrencySettings() {
  const user = await requireUser();
  const settings = await loadSettings(user.id);
  return (
    <div className="card">
      <SectionTitle tip="Which currency you work in, and how dollars and yen convert.">Currency</SectionTitle>
      <form action={updateSettings} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <input type="hidden" name="section" value="currency" />
        <div>
          <FieldLabel tip="Amounts show in it, and entry forms start in it.">Primary currency</FieldLabel>
          <select name="homeCurrency" defaultValue={settings.homeCurrency} className="input">
            <option value="USD">USD ($)</option>
            <option value="JPY">Yen (¥)</option>
          </select>
        </div>
        <div>
          <FieldLabel tip="On adds the $/¥ toggle and a currency picker on entry forms. None uses only your primary currency; amounts already entered in the other one are kept and converted.">
            Second currency
          </FieldLabel>
          <select name="secondCurrency" defaultValue={settings.singleCurrency ? "none" : "on"} className="input">
            <option value="on">On — the other of $ / ¥</option>
            <option value="none">None — use only my primary currency</option>
          </select>
        </div>
        <div>
          <FieldLabel tip="Current uses today's rate for everything. Historical uses the rate locked in at each purchase and sale.">Yen conversion</FieldLabel>
          <select name="fxMode" defaultValue={settings.fxMode} className="input">
            <option value="live">Current — today&apos;s rate (below)</option>
            <option value="historical">Historical — rate locked at each transaction</option>
          </select>
        </div>
        <div>
          <FieldLabel tip="Used for yen conversions and the Deal Checker, unless you fetch it automatically below.">Today&apos;s rate (¥ per $1)</FieldLabel>
          <input name="fxManualRate" inputMode="decimal" defaultValue={String(settings.fxManualRate)} className="input" />
        </div>
        <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm lg:col-span-2">
          <input type="checkbox" name="fxLive" defaultChecked={settings.fxLive} className="mt-0.5" />
          <span>
            <span className="flex items-center gap-1.5 font-medium">
              Fetch today&apos;s rate automatically
              <InfoTip text="About once an hour this server asks open.er-api.com (a free exchange-rate service) for the USD/JPY rate. None of your data is sent, but that service sees your server's IP address. Off means nothing is sent and the rate above is used." />
            </span>
            <span className="block text-xs text-slate-500">Asks an outside service for the rate about once an hour.</span>
          </span>
        </label>
        <div className="lg:col-span-2">
          <button className="btn-primary">Save currency</button>
        </div>
      </form>
    </div>
  );
}

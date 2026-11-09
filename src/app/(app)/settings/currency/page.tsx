import { requireUser } from "@/lib/auth";
import { updateSettings } from "@/lib/actions";
import { loadSettings } from "@/lib/settings-data";
import { SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CurrencySettings() {
  const user = await requireUser();
  const settings = await loadSettings(user.id);
  return (
    <div className="card">
      <SectionTitle>Currency</SectionTitle>
      <p className="mb-4 text-sm text-slate-500">Which currency you work in, and how amounts convert between dollars and yen.</p>
      <form action={updateSettings} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <input type="hidden" name="section" value="currency" />
        <div>
          <label className="label">Primary currency</label>
          <select name="homeCurrency" defaultValue={settings.homeCurrency} className="input">
            <option value="USD">USD ($)</option>
            <option value="JPY">Yen (¥)</option>
          </select>
          <p className="mt-1 text-xs text-slate-400">What amounts show in and what entry forms start in.</p>
        </div>
        <div>
          <label className="label">Second currency</label>
          <select name="secondCurrency" defaultValue={settings.singleCurrency ? "none" : "on"} className="input">
            <option value="on">On — the other of $ / ¥</option>
            <option value="none">None — use only my primary currency</option>
          </select>
          <p className="mt-1 text-xs text-slate-400">
            On adds the $/¥ toggle in the top bar and a currency picker on entry forms. None hides both, and everything uses
            the primary currency. Amounts already entered in the other currency are kept and converted.
          </p>
        </div>
        <div>
          <label className="label">Yen conversion</label>
          <select name="fxMode" defaultValue={settings.fxMode} className="input">
            <option value="live">Current — today&apos;s rate (below)</option>
            <option value="historical">Historical — rate locked at each transaction</option>
          </select>
          <p className="mt-1 text-xs text-slate-400">
            Current converts everything at today&apos;s rate. Historical uses the ¥/$ rate recorded when each item was bought
            or sold (falls back to today&apos;s rate for older records without a locked rate).
          </p>
        </div>
        <div>
          <label className="label">Today&apos;s rate (¥ per $1)</label>
          <input name="fxManualRate" inputMode="decimal" defaultValue={String(settings.fxManualRate)} className="input" />
          <p className="mt-1 text-xs text-slate-400">Used for yen conversions and the Deal Checker unless you turn on fetching below.</p>
        </div>
        <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm lg:col-span-2">
          <input type="checkbox" name="fxLive" defaultChecked={settings.fxLive} className="mt-0.5" />
          <span>
            <span className="font-medium">Fetch today&apos;s rate automatically</span>
            <span className="block text-xs text-slate-500">
              When on, this server asks open.er-api.com (a free exchange-rate service) for the USD/JPY rate about once an
              hour. Only the request leaves — none of your data — but that service sees your server&apos;s IP address. Off
              means nothing is sent and the rate above is used.
            </span>
          </span>
        </label>
        <div className="lg:col-span-2">
          <button className="btn-primary">Save currency</button>
        </div>
      </form>
    </div>
  );
}

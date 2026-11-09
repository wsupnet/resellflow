import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { updateSettings } from "@/lib/actions";
import { loadSettings } from "@/lib/settings-data";
import { SectionTitle } from "@/components/ui";
import InfoTip from "@/components/InfoTip";

export const dynamic = "force-dynamic";

function OnOff({ on }: { on: boolean }) {
  return on ? <span className="pill bg-amber-100 text-amber-700">on</span> : <span className="pill bg-emerald-100 text-emerald-700">off</span>;
}

export default async function PrivacySettings() {
  const user = await requireUser();
  const settings = await loadSettings(user.id);
  return (
    <>
      <div className="card">
        <SectionTitle tip="Nothing, unless you turn it on. These are the only two settings that contact outside services, and both are off by default. Any service that's used sees your server's IP address.">
          What leaves your server
        </SectionTitle>
        <ul className="divide-y divide-slate-100 text-sm">
          <li className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="flex items-center gap-1.5 font-medium">
              Exchange rate fetching
              <InfoTip text="A request for the USD/JPY rate to open.er-api.com, about hourly. No data of yours is sent." />
            </span>
            <span className="flex items-center gap-3">
              <OnOff on={settings.fxLive} />
              <Link href="/settings/currency" className="text-xs text-brand-600">Change in Currency →</Link>
            </span>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="flex items-center gap-1.5 font-medium">
              Online barcode lookup
              <InfoTip text="A scanned barcode that isn't already in your catalog, sent to OpenLibrary, MusicBrainz and UPCitemdb." />
            </span>
            <OnOff on={settings.upcLookup} />
          </li>
        </ul>
      </div>

      <div className="card">
        <SectionTitle>Barcodes</SectionTitle>
        <form action={updateSettings} className="space-y-4">
          <input type="hidden" name="section" value="privacy" />
          <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm">
            <input type="checkbox" name="upcLookup" defaultChecked={settings.upcLookup} className="mt-0.5" />
            <span>
              <span className="flex items-center gap-1.5 font-medium">
                Look up unknown barcodes online
                <InfoTip text="Barcodes you've scanned before always match from your own catalog, privately. With this on, a barcode that isn't in your catalog also goes to OpenLibrary (books), MusicBrainz (music) and UPCitemdb (retail) to pre-fill the name. They see the barcode and your server's IP address, which can reveal what you're buying. Most Japanese Book Off items aren't listed anyway." />
              </span>
              <span className="block text-xs text-slate-500">Sends barcodes that aren&apos;t in your catalog to outside lookup services.</span>
            </span>
          </label>
          <button className="btn-primary">Save barcode setting</button>
        </form>
      </div>
    </>
  );
}

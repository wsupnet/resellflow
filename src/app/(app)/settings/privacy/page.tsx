import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { updateSettings } from "@/lib/actions";
import { loadSettings } from "@/lib/settings-data";
import { SectionTitle } from "@/components/ui";

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
        <SectionTitle>What leaves your server</SectionTitle>
        <p className="mb-3 text-sm text-slate-500">
          Nothing, unless you turn it on. These are the only two settings that contact outside services, and both are off by
          default. Any service that&apos;s used sees your server&apos;s IP address.
        </p>
        <ul className="divide-y divide-slate-100 text-sm">
          <li className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-medium">Exchange rate fetching</span>
              <span className="block text-xs text-slate-500">A request for the USD/JPY rate to open.er-api.com, about hourly. No data of yours.</span>
            </span>
            <span className="flex items-center gap-3">
              <OnOff on={settings.fxLive} />
              <Link href="/settings/currency" className="text-xs text-brand-600">Change in Currency →</Link>
            </span>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-medium">Online barcode lookup</span>
              <span className="block text-xs text-slate-500">A scanned barcode not already in your catalog, to OpenLibrary, MusicBrainz and UPCitemdb.</span>
            </span>
            <OnOff on={settings.upcLookup} />
          </li>
        </ul>
        <p className="mt-3 text-xs text-slate-400">Your records and photos stay on this server. App telemetry is turned off.</p>
      </div>

      <div className="card">
        <SectionTitle>Barcodes</SectionTitle>
        <form action={updateSettings} className="space-y-4">
          <input type="hidden" name="section" value="privacy" />
          <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm">
            <input type="checkbox" name="upcLookup" defaultChecked={settings.upcLookup} className="mt-0.5" />
            <span>
              <span className="font-medium">Look up unknown barcodes online</span>
              <span className="block text-xs text-slate-500">
                Barcodes you&apos;ve scanned before are always matched from your own catalog, privately. When this is on, a
                barcode that isn&apos;t in your catalog is also sent to outside services to pre-fill the name: OpenLibrary
                (books), MusicBrainz (music) and UPCitemdb (retail goods). They see the barcode and your server&apos;s IP
                address, which can reveal what you&apos;re buying. Most Japanese Book Off items aren&apos;t listed anyway.
              </span>
            </span>
          </label>
          <button className="btn-primary">Save barcode setting</button>
        </form>
      </div>
    </>
  );
}

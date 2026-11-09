import { requireUser } from "@/lib/auth";
import { updateSettings } from "@/lib/actions";
import { loadSettings } from "@/lib/settings-data";
import { SectionTitle } from "@/components/ui";
import TimezoneField from "@/components/TimezoneField";
import { allTimezones, isValidTz } from "@/lib/tz";

export const dynamic = "force-dynamic";

export default async function PreferencesSettings() {
  const user = await requireUser();
  const settings = await loadSettings(user.id);
  return (
    <div className="card">
      <SectionTitle>Preferences</SectionTitle>
      <p className="mb-4 text-sm text-slate-500">How the app looks, and which timezone it works in.</p>
      <form action={updateSettings} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <input type="hidden" name="section" value="preferences" />
        <div>
          <label className="label">Theme</label>
          <select name="theme" defaultValue={settings.theme} className="input">
            <option value="light">Light (default)</option>
            <option value="cream">Off-white — warm paper</option>
            <option value="dark">Dark</option>
            <option value="system">System — follow my device</option>
          </select>
          <p className="mt-1 text-xs text-slate-400">
            How the app looks on every page. System switches with your phone or computer&apos;s light/dark setting automatically.
          </p>
        </div>
        <TimezoneField value={isValidTz(settings.timezone) ? settings.timezone : null} zones={allTimezones()} />
        <div className="lg:col-span-2">
          <button className="btn-primary">Save preferences</button>
        </div>
      </form>
    </div>
  );
}

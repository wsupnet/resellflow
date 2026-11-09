"use client";

import { useEffect, useState } from "react";

/** Settings picker for the account timezone, with a one-tap "use this device's". */
export default function TimezoneField({ value, zones }: { value: string | null; zones: string[] }) {
  const [tz, setTz] = useState(value ?? "");
  // Read after mount: the server render doesn't know the viewer's device zone.
  const [device, setDevice] = useState("");
  useEffect(() => setDevice(Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""), []);
  return (
    <div>
      <label className="label">Timezone</label>
      <div className="flex gap-2">
        <select name="timezone" value={tz} onChange={(e) => setTz(e.target.value)} className="input">
          {!value && <option value="">Not set (UTC)</option>}
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        {device && device !== tz && zones.includes(device) && (
          <button type="button" onClick={() => setTz(device)} className="btn-ghost whitespace-nowrap text-xs">
            Use this device&apos;s
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Decides what &quot;today&quot; is when you leave a date blank, and where days, months and years start in reports.
        Dates you type in are kept exactly as entered.
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";
import { changePassword } from "@/lib/actions";

const MIN = 12; // mirrors MIN_PASSWORD_LENGTH in lib/password (enforced server-side)

export default function ChangePasswordForm() {
  const [res, setRes] = useState<{ error?: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (fd.get("newPassword") !== fd.get("confirmPassword")) {
      setRes({ error: "The new passwords don't match" });
      return;
    }
    setBusy(true);
    setRes(null);
    try {
      const r = await changePassword(fd);
      if (r.error) setRes({ error: r.error });
      else {
        form.reset();
        setRes({ ok: true });
      }
    } catch {
      setRes({ error: "Couldn't change the password — try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label">Current password</label>
        <input name="currentPassword" type="password" required autoComplete="current-password" className="input" />
      </div>
      <div>
        <label className="label">New password</label>
        <input name="newPassword" type="password" required minLength={MIN} autoComplete="new-password" className="input" />
      </div>
      <div>
        <label className="label">Confirm new password</label>
        <input name="confirmPassword" type="password" required minLength={MIN} autoComplete="new-password" className="input" />
      </div>
      <p className="sm:col-span-2 -mt-2 text-xs text-slate-400">At least {MIN} characters.</p>
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={busy}>{busy ? "Changing…" : "Change password"}</button>
        {res?.error && <span className="text-sm text-red-600">{res.error}</span>}
        {res?.ok && <span className="text-sm text-emerald-700">Password changed. Other devices have been signed out.</span>}
      </div>
    </form>
  );
}

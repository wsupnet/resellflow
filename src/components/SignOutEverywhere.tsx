"use client";

import { signOutEverywhere } from "@/lib/actions";

export default function SignOutEverywhere() {
  return (
    <form
      action={signOutEverywhere}
      onSubmit={(e) => {
        if (!confirm("Sign out on every device, including this one?")) e.preventDefault();
      }}
      className="flex flex-wrap items-center gap-3"
    >
      <button className="btn-danger">Sign out of all devices</button>
      <span className="text-xs text-slate-500">
        Ends every session for this account — use it if a phone is lost or you signed in on someone else&apos;s computer.
      </span>
    </form>
  );
}

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
    </form>
  );
}

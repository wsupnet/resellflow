"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { detectTimezone } from "@/lib/actions";

/**
 * First visit: the account has no timezone yet, so fill it from the browser.
 * Runs once; afterwards the saved zone (changeable in Settings) is used.
 */
export default function TzSync({ needed }: { needed: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!needed) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;
    detectTimezone(tz).then(() => router.refresh()).catch(() => {});
  }, [needed, router]);
  return null;
}

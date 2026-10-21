"use client";

import { useEffect } from "react";

/**
 * Reconciles the applied theme with the account's saved choice. The theme
 * cookie is what the server renders from; on a fresh device (or after changing
 * the setting elsewhere) it can be missing/stale — this syncs cookie + DOM to
 * the DB value without a reload.
 */
export default function ThemeSync({ theme }: { theme: string }) {
  useEffect(() => {
    const current = document.cookie.match(/(?:^|;\s*)theme=([^;]*)/)?.[1];
    if (current !== theme) {
      document.cookie = `theme=${theme}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);
  return null;
}

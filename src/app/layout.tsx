import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "ResellFlow",
  description: "Inventory, lots, and P&L for resellers",
  manifest: "/manifest.json"
};

export const viewport: Viewport = {
  themeColor: "#1f57d6",
  width: "device-width",
  initialScale: 1
};

const THEMES = ["light", "cream", "dark", "system"];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Theme is applied server-side from the cookie so there's no flash of the
  // wrong theme. The cookie is set when saving Settings (and synced by
  // ThemeSync for a fresh device). "system" follows the device via CSS.
  const raw = cookies().get("theme")?.value ?? "light";
  const theme = THEMES.includes(raw) ? raw : "light";
  return (
    <html lang="en" data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}

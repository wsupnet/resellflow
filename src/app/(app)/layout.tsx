import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readFlash } from "@/lib/flash";
import { getViewCurrency, getCurrencyPrefs } from "@/lib/money";
import Nav from "@/components/Nav";
import Toaster from "@/components/Toaster";
import ThemeSync from "@/components/ThemeSync";
import TzSync from "@/components/TzSync";
import { CurrencyPrefsProvider } from "@/components/CurrencyPrefs";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const flash = await readFlash();
  const [currency, prefs] = await Promise.all([getViewCurrency(user.id), getCurrencyPrefs(user.id)]);
  const settings = await prisma.settings.findUnique({ where: { userId: user.id }, select: { theme: true, timezone: true } });

  return (
    <div className="min-h-screen">
      <Nav email={user.email} isAdmin={user.isAdmin} currency={currency} showToggle={!prefs.single} />
      <CurrencyPrefsProvider value={prefs}>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </CurrencyPrefsProvider>
      <Toaster flash={flash} />
      <ThemeSync theme={settings?.theme ?? "light"} />
      <TzSync needed={!settings?.timezone} />
    </div>
  );
}

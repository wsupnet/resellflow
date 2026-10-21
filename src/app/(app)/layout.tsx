import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readFlash } from "@/lib/flash";
import { getViewCurrency } from "@/lib/money";
import Nav from "@/components/Nav";
import Toaster from "@/components/Toaster";
import ThemeSync from "@/components/ThemeSync";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const flash = readFlash();
  const currency = await getViewCurrency(user.id);
  const settings = await prisma.settings.findUnique({ where: { userId: user.id }, select: { theme: true } });

  return (
    <div className="min-h-screen">
      <Nav email={user.email} isAdmin={user.isAdmin} currency={currency} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      <Toaster flash={flash} />
      <ThemeSync theme={settings?.theme ?? "light"} />
    </div>
  );
}

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LocationsSettings() {
  const user = await requireUser();
  const count = await prisma.location.count({ where: { userId: user.id } });
  return (
    <div className="card">
      <SectionTitle>Sourcing locations</SectionTitle>
      <p className="mb-3 text-sm text-slate-500">
        The specific places you source from (a particular Book Off, a regular estate-sale company…), so you can see which
        spots make you the most profit. You have {count === 0 ? "none yet" : `${count} location${count === 1 ? "" : "s"}`}.
      </p>
      <Link href="/locations" className="btn-ghost">Manage locations →</Link>
    </div>
  );
}

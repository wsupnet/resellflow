import { requireUser } from "@/lib/auth";
import { getUsdToJpy } from "@/lib/fx";
import { listLocations } from "@/lib/queries";
import { getViewCurrency } from "@/lib/money";
import LotBuilder from "@/components/LotBuilder";

export const dynamic = "force-dynamic";

export default async function NewLotPage() {
  const user = await requireUser();
  const [fx, locations, currency] = await Promise.all([getUsdToJpy(), listLocations(user.id), getViewCurrency(user.id)]);
  return (
    <div className="mx-auto max-w-lg">
      <LotBuilder rate={fx.rate} locations={locations.map((l) => l.name)} defaultCurrency={currency} />
    </div>
  );
}

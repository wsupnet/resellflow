import { prisma } from "@/lib/db";
import { dataDirLabel, emptyDatabaseWarnings } from "@/lib/datadir";
import RegisterForm from "./RegisterForm";

// Checked on every visit: the form turns into first-run admin setup while the
// install has no accounts.
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const setup = (await prisma.user.count()) === 0;
  return <RegisterForm setup={setup} warnings={setup ? emptyDatabaseWarnings() : []} dataDir={dataDirLabel()} />;
}

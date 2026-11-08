import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // A new install has no accounts yet: send the first visitor to admin setup.
  if ((await prisma.user.count()) === 0) redirect("/register");
  return <LoginForm />;
}

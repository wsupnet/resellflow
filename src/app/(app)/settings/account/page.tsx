import { requireUser } from "@/lib/auth";
import { SectionTitle } from "@/components/ui";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import SignOutEverywhere from "@/components/SignOutEverywhere";
import { appVersion } from "@/lib/changelog";

export const dynamic = "force-dynamic";

export default async function AccountSettings() {
  const user = await requireUser();
  return (
    <>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="card">
          <SectionTitle tip="Changing your password signs out every other device.">Password</SectionTitle>
          <p className="mb-4 text-sm text-slate-500">
            Signed in as <b>{user.email}</b>
            {user.isAdmin ? " (admin)" : ""}.
          </p>
          <ChangePasswordForm />
        </div>
        <div className="card">
          <SectionTitle>Sessions</SectionTitle>
          <SignOutEverywhere />
        </div>
      </div>
      <p className="text-xs text-slate-400">ResellFlow version {appVersion()}</p>
    </>
  );
}

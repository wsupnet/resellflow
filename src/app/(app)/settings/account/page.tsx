import { requireUser, listSessions } from "@/lib/auth";
import { signOutSession } from "@/lib/actions";
import { SectionTitle } from "@/components/ui";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import SignOutEverywhere from "@/components/SignOutEverywhere";
import { appVersion } from "@/lib/changelog";
import { describeUserAgent } from "@/lib/useragent";
import { getUserTz } from "@/lib/usertz";

export const dynamic = "force-dynamic";

/** "just now", "12 minutes ago", "3 hours ago", "2 days ago". */
function ago(d: Date): string {
  const min = Math.round((Date.now() - +d) / 60000);
  if (min < 5) return "just now";
  if (min < 60) return `${min} minutes ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const days = Math.round(h / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default async function AccountSettings() {
  const user = await requireUser();
  const [sessions, tz] = await Promise.all([listSessions(user.id), getUserTz(user.id)]);
  // This browser first, then the rest by most recent activity.
  const ordered = [...sessions].sort((a, b) => (a.id === user.sessionId ? -1 : b.id === user.sessionId ? 1 : 0));
  const when = (d: Date) =>
    d.toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

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
          {!user.sessionId && (
            <p className="mb-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-500">
              This browser signed in before sessions were listed here, so it isn&apos;t shown. Sign out and back in to see it.
            </p>
          )}
          {ordered.length > 0 && (
            <ul className="mb-4 divide-y divide-slate-100">
              {ordered.map((s) => {
                const current = s.id === user.sessionId;
                return (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                        {describeUserAgent(s.userAgent)}
                        {current && <span className="pill bg-emerald-100 text-emerald-700">This session</span>}
                      </div>
                      <div className="text-xs text-slate-500">
                        Signed in {when(s.createdAt)} · {current ? "active now" : `last active ${ago(s.lastSeenAt)}`}
                      </div>
                    </div>
                    {!current && (
                      <form action={signOutSession}>
                        <input type="hidden" name="sessionId" value={s.id} />
                        <button className="btn-ghost py-1 text-xs">Sign out</button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mb-3 text-xs text-slate-400">Sign-ins from before this list existed aren&apos;t shown; Sign out of all devices ends those too.</p>
          <SignOutEverywhere />
        </div>
      </div>
      <p className="text-xs text-slate-400">ResellFlow version {appVersion()}</p>
    </>
  );
}

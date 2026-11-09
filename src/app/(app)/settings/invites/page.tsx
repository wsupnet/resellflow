import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createInvite, deleteInvite } from "@/lib/actions";
import { SectionTitle } from "@/components/ui";
import ConfirmButton from "@/components/ConfirmButton";
import { shortDate } from "@/lib/format";
import { momentToDay } from "@/lib/tz";
import { getUserTz } from "@/lib/usertz";

export const dynamic = "force-dynamic";

export default async function InvitesSettings() {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  const [invites, tz] = await Promise.all([prisma.invite.findMany({ orderBy: { createdAt: "desc" } }), getUserTz(user.id)]);
  return (
    <div className="card">
      <SectionTitle tip="Registration is invite-only. Create a code and share the link with family or friends who resell.">Invites</SectionTitle>
      <form action={createInvite} className="mb-4 flex flex-wrap items-end gap-2">
        <div className="grow">
          <label className="label">Lock to email (optional)</label>
          <input name="email" type="email" className="input" placeholder="leave blank for any email" />
        </div>
        <button className="btn-primary">Create invite</button>
      </form>

      {invites.length === 0 ? (
        <p className="text-sm text-slate-500">No invites yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th">Code</th>
                <th className="th">For</th>
                <th className="th">Status</th>
                <th className="th">Created</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => (
                <tr key={inv.id} className="border-b border-slate-50">
                  <td className="td font-mono text-xs">{inv.code}</td>
                  <td className="td text-slate-500">{inv.email ?? "anyone"}</td>
                  <td className="td">
                    {inv.usedAt ? (
                      <span className="pill bg-slate-100 text-slate-500">used · {inv.usedByEmail}</span>
                    ) : (
                      <span className="pill bg-emerald-100 text-emerald-700">open</span>
                    )}
                  </td>
                  <td className="td text-slate-500">{shortDate(momentToDay(inv.createdAt, tz))}</td>
                  <td className="td text-right">
                    <form action={deleteInvite}>
                      <input type="hidden" name="id" value={inv.id} />
                      <ConfirmButton message="Delete this invite code?" className="text-xs text-red-500 hover:underline">
                        Delete
                      </ConfirmButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-400">
            Share: <span className="font-mono">/register?code=CODE</span> — the recipient creates their own private account.
          </p>
        </div>
      )}
    </div>
  );
}

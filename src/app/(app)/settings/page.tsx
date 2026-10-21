import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { updateSettings, createInvite, deleteInvite } from "@/lib/actions";
import Link from "next/link";
import { SectionTitle } from "@/components/ui";
import ImportPanel from "@/components/ImportPanel";
import ConfirmButton from "@/components/ConfirmButton";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import { shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  let settings = await prisma.settings.findUnique({ where: { userId: user.id } });
  if (!settings) settings = await prisma.settings.create({ data: { userId: user.id } });

  const invites = user.isAdmin
    ? await prisma.invite.findMany({ orderBy: { createdAt: "desc" } })
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="card max-w-2xl">
        <SectionTitle>Sourcing locations</SectionTitle>
        <p className="mb-3 text-sm text-slate-500">
          Manage the specific places you source from and see which spots make you the most profit.
        </p>
        <Link href="/locations" className="btn-ghost">Manage locations →</Link>
      </div>

      <div className="card max-w-2xl">
        <SectionTitle>Selling fees</SectionTitle>
        <p className="mb-4 text-sm text-slate-500">
          Used to auto-calculate fees when you record a sale. These are starting defaults — adjust to match what each platform actually charges you. Past sales keep the fees they were recorded with.
        </p>
        <form action={updateSettings} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">eBay final value fee (%)</label>
            <input name="ebayFeePct" inputMode="decimal" defaultValue={(settings.ebayFeePct * 100).toFixed(2)} className="input" />
          </div>
          <div>
            <label className="label">eBay flat fee per order ($)</label>
            <input name="ebayFlatFee" inputMode="decimal" defaultValue={settings.ebayFlatFee.toFixed(2)} className="input" />
          </div>
          <div>
            <label className="label">eBay ad fee (%)</label>
            <input name="adFeePct" inputMode="decimal" defaultValue={(settings.adFeePct * 100).toFixed(2)} className="input" />
          </div>
          <div>
            <label className="label">Mercari fee (%)</label>
            <input name="mercariFeePct" inputMode="decimal" defaultValue={(settings.mercariFeePct * 100).toFixed(2)} className="input" />
          </div>
          <div>
            <label className="label">Default shipping ($)</label>
            <input name="defaultShipping" inputMode="decimal" defaultValue={settings.defaultShipping.toFixed(2)} className="input" />
          </div>
          <div>
            <label className="label">Default display currency</label>
            <select name="homeCurrency" defaultValue={settings.homeCurrency} className="input">
              <option value="USD">USD ($)</option>
              <option value="JPY">Yen (¥)</option>
            </select>
            <p className="mt-1 text-xs text-slate-400">Which currency amounts show in by default. Flip it anytime with the $/¥ toggle in the top bar.</p>
          </div>
          <div>
            <label className="label">Yen conversion</label>
            <select name="fxMode" defaultValue={settings.fxMode} className="input">
              <option value="live">Live — today&apos;s rate</option>
              <option value="historical">Historical — rate locked at each transaction</option>
            </select>
            <p className="mt-1 text-xs text-slate-400">
              Live converts everything at the current rate. Historical uses the ¥/$ rate recorded when each item was bought/sold (falls back to live for older records without a locked rate).
            </p>
          </div>
          <div>
            <label className="label">Theme</label>
            <select name="theme" defaultValue={settings.theme} className="input">
              <option value="light">Light (default)</option>
              <option value="cream">Off-white — warm paper</option>
              <option value="dark">Dark</option>
              <option value="system">System — follow my device</option>
            </select>
            <p className="mt-1 text-xs text-slate-400">
              How the app looks on every page. System switches with your phone/computer&apos;s light-dark setting automatically.
            </p>
          </div>
          <label className="sm:col-span-2 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm">
            <input type="checkbox" name="upcLookup" defaultChecked={settings.upcLookup} className="mt-0.5" />
            <span>
              <span className="font-medium">Auto-fill item name from scanned barcode</span>
              <span className="block text-xs text-slate-500">
                When on, scanning a barcode queries an external UPC database to pre-fill the name. Most Japanese Book Off items
                aren&apos;t listed, so leave off unless you scan retail UPC/EAN goods.
              </span>
            </span>
          </label>
          <div className="flex items-end">
            <button className="btn-primary">Save settings</button>
          </div>
        </form>
      </div>

      <div className="card max-w-2xl">
        <SectionTitle>Export &amp; import</SectionTitle>
        <p className="mb-3 text-sm text-slate-500">Download your data as CSV, or bulk-add records.</p>
        <div className="mb-5">
          <div className="mb-2 text-sm font-medium text-slate-600">Export CSV</div>
          <div className="flex flex-wrap gap-2">
            <a href="/api/export?type=inventory" className="btn-ghost py-1.5 text-sm">Inventory</a>
            <a href="/api/export?type=sales" className="btn-ghost py-1.5 text-sm">Sales</a>
            <a href="/api/export?type=lots" className="btn-ghost py-1.5 text-sm">Lots</a>
            <a href="/api/export?type=expenses" className="btn-ghost py-1.5 text-sm">Expenses</a>
          </div>
        </div>
        <div className="mb-2 text-sm font-medium text-slate-600">Import CSV</div>
        <ImportPanel />
      </div>

      {user.isAdmin && (
        <div className="card max-w-2xl">
          <SectionTitle>Invites</SectionTitle>
          <p className="mb-4 text-sm text-slate-500">
            Registration is invite-only. Create a code and share the link with family/friends who resell.
          </p>
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
                      <td className="td text-slate-500">{shortDate(inv.createdAt)}</td>
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
      )}

      <div className="card max-w-2xl">
        <SectionTitle>Account</SectionTitle>
        <p className="mb-4 text-sm text-slate-500">
          Signed in as <b>{user.email}</b>{user.isAdmin ? " (admin)" : ""}. Changing your password signs out every other device.
        </p>
        <ChangePasswordForm />
      </div>
    </div>
  );
}

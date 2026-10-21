# ResellFlow

**[Overview](docs/OVERVIEW.md)** · **[User guide](docs/USER-GUIDE.md)** · [Quick start](#quick-start) ·
[Hosting on a NAS](DEPLOY-NAS.md) · [How the money math works](#how-the-money-math-works) ·
[Common commands](#common-commands)

Inventory, lot tracking, and profit/loss for resellers who buy at garage sales,
thrift stores, estate sales, and Book Off — and flip on eBay, Mercari, and
Facebook. Built to solve the things a spreadsheet can't:

- **Lots that get broken up.** A lot's cost is split across its items
  automatically (proportional to each item's sale price). An item's profit always
  rolls back to the lot it came from — even when sold on its own or **bundled with
  items from a different lot**.
- **Real P&L.** Gross, fees (eBay / Mercari / ad / shipping), net, and ROI — at
  the item, lot, and portfolio level, with monthly charts.
- **Good-deal checker.** Live yen↔USD converter plus a verdict on whether you're
  over/underpaying, based on your own sale history or a comp you paste in.
- **Buy-more insights.** Ranks what you should source more of by a blended score,
  with toggles to view by total profit, ROI, or how often it sells.
- **Barcode / SKU grouping + camera scanning.** Scan a barcode with your phone
  camera (or type it) to tag any item; items sharing a code are treated as one
  product so the "times sold" count is accurate even when names differ. Scan on
  the add-item form, the item editor, or the Deal Checker (scan in-store to pull
  up your history). Optional UPC-database name auto-fill (Settings, off by
  default). **Camera needs HTTPS or localhost** (browser requirement).
- **General ledger.** Record business expenses that aren't item purchases —
  import fees, commissions, supplies — and attach them to a lot, item, or sale (or
  leave them general). They reduce net and count toward ROI like fees.
- **Sortable, filterable tables** everywhere, defaulting to the relevant date
  (sold date for Sales, added date for Inventory, purchase date for Lots).
- **Per-item profit breakdown.** Click any item for its own page: gross, each fee
  (shipping / eBay / Mercari / ad), each attributed expense by name, cost of
  goods, and net — split correctly when sold in a multi-item bundle.
- **Item photos.** Upload multiple photos per item (or snap one on your phone);
  auto-thumbnailed for fast lists, stored on the uploads volume, served only to
  the owner.
- **Smart barcode naming.** Scanning looks the code up across your own catalog
  first (instant, private, learns over time), then OpenLibrary (books/manga),
  MusicBrainz (CDs), and UPCitemdb (retail). External sources are opt-in.
- **CSV export & import.** Export inventory, sales, lots, or expenses to CSV;
  bulk-import inventory and sales (additive — never overwrites). In Settings.
- **Multi-user & self-hostable.** Invite-only accounts, each user's data private,
  all in one `docker compose`.

## Documentation

| Doc | What's in it |
|---|---|
| [Overview](docs/OVERVIEW.md) | What the app does, page by page, with screenshots (demo data) |
| [User guide](docs/USER-GUIDE.md) | Step by step: first login, adding items and lots, sales, expenses, the dashboard, Deal Checker, backups |
| [Quick start](#quick-start) | Run it locally with Docker in a few minutes |
| [Hosting on a NAS](DEPLOY-NAS.md) | Synology / QNAP / UGREEN / Unraid setup, HTTPS for the phone camera, backups, updates |
| [Passwords & lockout](DEPLOY-NAS.md#9-passwords--lockout) | Changing your password, and resetting it from the server if you're locked out |
| [Inviting family & friends](#inviting-family--friends) | Invite-only accounts with private data per user |
| [Importing your existing data](#importing-your-existing-data) | CSV import and backup restore |
| [How the money math works](#how-the-money-math-works) | How lot costs, fees and ROI are calculated |

## Quick start

You only need **Docker** installed.

```bash
cp .env.example .env
# edit .env: set strong POSTGRES_PASSWORD, AUTH_SECRET, and your ADMIN_EMAIL/PASSWORD
#   AUTH_SECRET:  openssl rand -base64 48

docker compose up -d --build
```

Open <http://localhost:3000> and sign in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD`
you set. The database schema and the admin account are created automatically on
first boot.

### Important: keep `DATABASE_URL` and `POSTGRES_*` in sync

`DATABASE_URL` (used by the app) must contain the same user/password/db as the
`POSTGRES_*` values (used by the database). The default `.env.example` already
lines them up — just change the password in both places.

## Inviting family & friends

1. Sign in as admin → **Settings → Invites → Create invite**.
2. Share the link `https://your-host/register?code=THECODE`.
3. They create their own account; their inventory and P&L are completely private
   to them.

To let someone run their **own** copy instead, hand them this repo — the same
`docker compose up` gives them an independent instance.

## Importing your existing data

Use **Settings → Import** to bulk-import inventory and sales from CSV (download
the templates there for the exact columns), or restore a full ResellFlow backup
(`.json` or `.zip` with photos).

## How the money math works

- **Lot allocation:** `lot cost + tax` is split across the lot's items weighted by
  each item's sale price (falling back to estimated value, then an even split for
  unsold items). Set a **cost override** on any item to pin its share exactly.
- **Sale fees** are split across a sale's line items by sale price, then each
  item's net rolls up to its origin lot.
- **Personal belongings** (things you already owned, $0 cost) are flagged and
  tracked in a **separate bucket**. Their profit counts toward total net, but they
  are excluded from **Flip ROI** and per-item ROI — a return on a $0 cost basis is
  meaningless and would otherwise show up as a misleading "high ROI" winner.
- All reporting is in **USD**. Each purchase also stores the yen amount and the
  locked exchange rate you paid; the live rate is only used for the shopping
  calculator.
- Fee percentages are **editable** in Settings. Past sales keep the fees they were
  recorded with, so changing rates never rewrites history.

## Roadmap

- **Reports tab.** Planned: generated financial reports — P&L (profit & loss),
  net operating income, by-period / by-platform / by-source summaries, and
  export to PDF/CSV. Builds on the existing finance engine and ledger.

- **Real-time comps.** eBay/Mercari sold-price comps — deferred (eBay sold data
  is restricted/paid, Mercari has no public API). Currently uses your own sale
  history + manual comps.

- **HTTPS for phone camera.** Barcode scanning needs a secure context. For phone
  use, put the app behind a reverse proxy with TLS (Caddy/Traefik/nginx) or use a
  tunnel (Cloudflare Tunnel, Tailscale). On `localhost` it works as-is.

## Tech

Next.js 14 (App Router) · PostgreSQL · Prisma · Tailwind · Recharts. Auth is a
signed httpOnly session cookie (`jose` + `bcryptjs`). Installable as a PWA for
phone use while sourcing.

## Common commands

```bash
docker compose logs -f app        # tail app logs
docker compose down               # stop
docker compose down -v            # stop and DELETE all data (db + uploads)
docker compose up -d --build      # rebuild after pulling changes
```

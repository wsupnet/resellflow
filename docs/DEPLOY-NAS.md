# Hosting ResellFlow on a NAS

## Layout on the NAS

Code and data live in separate places:

| What | Where (NAS) | Notes |
|---|---|---|
| This repo (code) | `/volume1/docker/apps/reselling-app` | Updated with `git pull`. Holds `.env` (not in Git). |
| App data | `/volume1/docker/appdata/reselling-app/` | Outside the repo, so `git pull` never touches it. |
| ├ `postgres/` | → `/var/lib/postgresql/data` in `db` | Postgres keeps its files in the `pgdata/` subfolder. |
| ├ `uploads/` | → `/app/uploads` in `app` | Item photos (`<id>.jpg` + `<id>.thumb.jpg`). |
| ├ `secrets/` | → `/app/secrets` in `app`, `/secrets` in `db` | `db_password` and `auth_secret`, generated on first start unless `.env` sets them. Keep it private. |
| └ `tailscale/` | → `/var/lib/tailscale` in `tailscale` | Only used with the `ts` profile (`COMPOSE_PROFILES=ts` on the NAS). |

The data folders are **bind mounts** under `DATA_DIR`
(`DATA_DIR=/volume1/docker/appdata` in `.env` on the NAS; the default `./data`
would put them inside the repo folder). Docker creates any missing folder on
first start.

> **Upgrading from a version that used `APPDATA`:** in `.env`, rename
> `APPDATA=/volume1/docker/appdata` to `DATA_DIR=/volume1/docker/appdata` before
> `docker compose up`, and keep your existing `POSTGRES_PASSWORD`, `DATABASE_URL`
> and `ADMIN_*` lines. If you forget, the app starts on an empty `./data` folder
> (your real data isn't touched) and warns about the leftover `APPDATA` line in
> the logs and on the setup page.

Caddy's `caddy_data` / `caddy_config` deliberately stay Docker named volumes: the
`https` profile isn't used on the NAS, so they hold no NAS data.

## ⚡ Simplest path (build on the NAS, like any other app)

The compose file builds the app from source on the NAS, so there's **no tarball
and no registry**. Secrets are generated on first start; the `.env` only says
where the data goes and how to reach the app.

1. SSH in and clone the repo:
   ```bash
   cd /volume1/docker/apps
   git clone <repo-url> reselling-app
   cd reselling-app
   ```
2. Create a `.env` with **`DATA_DIR=/volume1/docker/appdata`**,
   **`APP_BIND=0.0.0.0`** (so other devices can open `http://<NAS-IP>:3939`; the
   default only answers on the NAS itself) and, for HTTPS,
   **`COMPOSE_PROFILES=ts`** plus `TS_AUTHKEY` (see section 2 below).
3. Run:
   ```bash
   sudo docker compose up -d --build
   ```
   The first build takes a few minutes (it installs dependencies + compiles).
4. Wait until it's up, then **right away** open `http://<NAS-IP>:3939` and create
   the admin account on the setup page. (Until an account exists, anyone on your
   network who opens the page first could claim it.)

That's the whole deployment. Start fresh and add your inventory in the app.

**If you hit "unhealthy" from an earlier attempt** on a brand-new install (no
data you want to keep), stop the stack and empty the half-made database folder:
```bash
sudo docker compose down
sudo rm -rf /volume1/docker/appdata/reselling-app/postgres
sudo docker compose up -d --build
```
`docker compose down -v` does **not** delete the data folders — they're bind
mounts, not Docker volumes.

---

ResellFlow is a standard Docker Compose app. It has been run on a **UGREEN** NAS;
other NAS systems that run Docker with Compose v2 (Synology Container Manager,
QNAP Container Station, Unraid, TrueNAS SCALE) should work the same way, but
haven't been tested.

## UGREEN NAS (UGOS Pro) — quick path

UGREEN NASync boxes are x86/amd64 with ample RAM, so build on the NAS directly.

1. **App Center → install "Docker".** This gives you Docker + Compose ("Projects").
2. **Enable SSH:** Control Panel → Terminal/SSH (UGOS) → enable SSH.
3. **Make a shared folder** (File Manager) named `docker` on volume 1, so it
   appears as `/volume1/docker`.
4. **SSH in:** `ssh <youruser>@<NAS-IP>`, then clone the repo into
   `/volume1/docker/apps/reselling-app` (see "Simplest path" above).
5. Create the `.env` with `DATA_DIR=/volume1/docker/appdata` and
   `APP_BIND=0.0.0.0` (see section 2 below).
   Then `sudo docker compose up -d --build` (UGOS usually needs `sudo` for
   docker). First build takes a few minutes.
6. Open `http://<NAS-IP>:3939` and create the admin account.
7. **HTTPS for the camera:** UGOS may not have a Tailscale app yet, and its web UI
   can occupy 80/443 (so the Caddy profile may clash). Easiest reliable option is
   **Tailscale in a container** doing `serve` — see "HTTPS via Tailscale container"
   at the bottom. (If 80/443 are free, the Caddy `--profile https` also works.)

The sections below are the general reference for any NAS.

## 0. Before you start
- Make sure your NAS has **Docker + Docker Compose**, **Git** and ideally **SSH**
  enabled.
- The image build (`next build`) wants roughly **2 GB of free RAM**. If your NAS
  is low on RAM, see **"Build on another machine"** at the bottom.
- Note your NAS CPU architecture. Most Synology/QNAP are **x86_64 (amd64)**; some
  are ARM. This only matters if you build the image elsewhere.

## 1. Get the code onto the NAS
Clone the repo to `/volume1/docker/apps/reselling-app`:
```bash
cd /volume1/docker/apps
git clone <repo-url> reselling-app
```
`node_modules/`, `.next/` and `.env` aren't in Git — the image build recreates
the first two, and you create `.env` next. Your data does **not** go in the repo
folder; it lives under `DATA_DIR` (see "Layout on the NAS").

## 2. Create the `.env`
In the project folder on the NAS, copy `.env.example` to `.env` (or create an
empty `.env`) and set what you need. Everything is optional:
- `DATA_DIR` — `/volume1/docker/appdata` (the stack stores its data in
  `$DATA_DIR/reselling-app/`)
- `COMPOSE_PROFILES=ts` — so the Tailscale sidecar starts with every
  `docker compose up` (needs `TS_AUTHKEY`; see "HTTPS via Tailscale container")
- `APP_PORT` — a free port on the NAS (default `3939`)
- `APP_BIND=0.0.0.0` — publish that port on the LAN. Without it the app only answers
  on the NAS itself (fine if you only use the Tailscale URL)
- `SITE_ADDRESS` — your NAS IP or Tailscale name (only used if you run the Caddy HTTPS profile)

The database password and `AUTH_SECRET` are generated into
`$DATA_DIR/reselling-app/secrets/` on first start. You can still set
`POSTGRES_PASSWORD`, `AUTH_SECRET` and `ADMIN_EMAIL` / `ADMIN_PASSWORD` yourself
(see `.env.example`).

## 3. Build & start
Over SSH, from the project folder:
```bash
docker compose up -d --build
```
First build takes a few minutes. Check it's up: `docker compose ps` and `docker compose logs -f app`.
The log shows the data folder on every start, and on a first start says it
created a new, empty database. If it shows **DATA EXPECTED BUT NOT FOUND**
instead, stop and check `DATA_DIR` before creating an account.

## 4. Restore your data
From a SQL dump and a photos folder (kept **outside** the repo, e.g. in
`/volume1/docker/appdata/reselling-app/backups/`):
```bash
B=/volume1/docker/appdata/reselling-app/backups
# Database
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < $B/resellflow-db.sql

# Photos — copy straight into the bind-mounted uploads folder
cp -a $B/uploads/. /volume1/docker/appdata/reselling-app/uploads/
```
> Re-run the DB dump on the old machine right before cutover so you capture the
> latest data:
> `docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' > resellflow-db.sql`

### Moving from the old Docker named volumes
Earlier versions kept data in the named volumes `reselling-app_db_data`,
`reselling-app_uploads` and `reselling-app_ts_state`. To move to the folders
above, stop the stack (`docker compose down`) and copy each volume's contents
into the matching folder — `db_data` → `postgres/`, `uploads` → `uploads/`,
`ts_state` → `tailscale/` — preserving ownership and permissions (e.g. `cp -a`
from the volume's mountpoint, or a throwaway container mounting both). Copy the
**whole** `db_data` volume, so `postgres/pgdata/` ends up in place. Keep the
old volumes until the app is confirmed working on the new folders.

## 5. Open it
Visit `http://<NAS-IP>:<APP_PORT>` on your LAN and log in. This needs
`APP_BIND=0.0.0.0` in `.env`; without it the app only answers on the NAS itself
(the Tailscale options below still work). Everything (login, inventory, sales,
ledger) works over plain HTTP — **except the camera scanner**, which needs HTTPS
(next step). Plain HTTP sends your password unencrypted over the LAN, so prefer
the HTTPS address once it's set up.

## 6. HTTPS for the phone camera
Two good options:

**A) Tailscale (recommended — trusted cert, works anywhere)**
- Install Tailscale on the NAS (Synology/QNAP have a package), or use the
  built-in `ts` profile — see "HTTPS via Tailscale container" at the bottom.
- Enable HTTPS for your tailnet (admin console → DNS → Enable HTTPS).
- With a NAS package, run: `tailscale serve --bg <APP_PORT>`
- Open `https://<nas-name>.<tailnet>.ts.net` on your phone.

**B) Caddy profile (self-contained)**
- Set `SITE_ADDRESS` in `.env` to the NAS IP, then:
  `docker compose --profile https up -d`
- Visit `https://<NAS-IP>` (accept the one-time self-signed cert warning).
- Caddy publishes ports 80 and 443 on **all** of the NAS's network interfaces,
  whatever `APP_BIND` is set to.

**Sign-in throttling per IP (optional):** if *every* visitor comes in through
Tailscale or Caddy and `APP_BIND` is left at its default (so nobody can reach
`<NAS-IP>:<APP_PORT>` directly), set `TRUST_PROXY=1` in `.env` to also limit
failed sign-ins per client IP. Don't set it together with `APP_BIND=0.0.0.0`:
a visitor reaching the app directly could fake their IP.

If your NAS already runs a reverse proxy (Synology "Reverse Proxy", Nginx Proxy
Manager, Traefik) with a domain + Let's Encrypt, you can instead point it at the
app container / `APP_PORT` for a clean public hostname. A proxy running on the
NAS itself reaches `127.0.0.1:<APP_PORT>` with the default `APP_BIND`; one in
another container or machine needs `APP_BIND=0.0.0.0`. Exposing the app to the
internet this way is possible but not recommended — Tailscale keeps it private.

## 7. Backups & persistence
All data lives in plain folders under `/volume1/docker/appdata/reselling-app/`
(see "Layout on the NAS"), so NAS-native snapshots or Hyper Backup of that
share cover it. The Postgres folder is only consistent while the database is
stopped, so also take a SQL dump regularly:
```bash
B=/volume1/docker/appdata/reselling-app/backups
mkdir -p $B
# DB snapshot
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' > $B/resellflow-$(date +%F).sql
# Photos snapshot
cp -a /volume1/docker/appdata/reselling-app/uploads $B/uploads-$(date +%F)
```
Tip: schedule these with the NAS task scheduler. Keep dumps out of the repo
folder — they're real business data.

## 8. Auto-start & updates
- `restart: unless-stopped` is already set, so the app comes back after reboots
  (ensure the NAS Docker service starts on boot — it does by default).
- To update, from `/volume1/docker/apps/reselling-app`:
  ```bash
  git pull
  sudo docker compose up -d --build
  ```
  Data under `DATA_DIR` is untouched by both steps. If an update would delete data
  from the database, the app refuses to start and says so in
  `sudo docker compose logs app` — see "Updates that change the database" in the
  [README](../README.md#updates-that-change-the-database).
- **Updating from a version before the October 2026 security update:**
  - Add `APP_BIND=0.0.0.0` to `.env` if you open the app by `http://<NAS-IP>:<APP_PORT>`.
    The Tailscale URL works either way.
  - Keep your existing `AUTH_SECRET` in `.env` (nobody gets signed out), or delete
    the line to have one generated into `secrets/` (everyone signs in once more).
    The app now refuses to start with the `.env.example` placeholder or a secret
    shorter than 32 characters, and says so in the logs.
  - **Settings → Today's rate** starts at ¥150 per $1 with automatic fetching off.
    Set your own rate, or tick *Fetch today's rate automatically*.
  - Account emails are now matched exactly, lowercased. The first boot lowercases
    any stored email that has capitals (logged as "Normalized account email …").
  - If the database password in `DATABASE_URL` is wrong, the app now stops with
    that error in `sudo docker compose logs app` instead of "waiting for db..."
    forever.
- **Updating from a version that used `APPDATA`:** see the note under "Layout on
  the NAS" above. Rename the `.env` line to `DATA_DIR` first.

## 9. Passwords & lockout

- **Change your password** in the app: **Settings → Account**. It needs your
  current password, and signs out every other device.
- **Sign out of all devices** (Settings → Account) ends every session for that
  account, including the current one — use it after losing a phone.
- After **10 wrong passwords** for one account, sign-in for that account pauses
  for 15 minutes (restarting the app also clears it). Browsers that have signed
  in to that account before keep their own allowance, so you can still get in
  from your usual devices while someone else is guessing.
- The admin is normally created on the setup page at first visit. If `.env` sets
  `ADMIN_EMAIL` / `ADMIN_PASSWORD`, they're only used to create that account
  while it doesn't exist (a password under 12 characters or an example value is
  refused, and the setup page is offered instead). Changing `ADMIN_PASSWORD`
  later does nothing to the existing account, and changing `ADMIN_EMAIL` would
  create a second admin.

**Locked out?** Reset a password from the NAS over SSH, in the project folder:
```bash
# list accounts
sudo docker compose exec app node dist/scripts/reset-password.js
# reset one — prompts twice for the new password (hidden, min 12 characters)
sudo docker compose exec app node dist/scripts/reset-password.js you@example.com
```
The reset signs that user out everywhere; log in with the new password. Prefer
the prompt over putting a password on the command line (it would land in your
shell history).

## HTTPS via Tailscale container (when the NAS has no Tailscale app)

`docker-compose.yml` already includes a `tailscale` service (profile `ts`) that
shares the app's network and serves it over HTTPS with a trusted cert — no host
ports needed, works remotely. It uses the repo's `./deploy/serve.json` and keeps its
state in `$DATA_DIR/reselling-app/tailscale`.

1. In the Tailscale admin console, create a **reusable auth key**.
2. Put `TS_AUTHKEY=tskey-...` and `COMPOSE_PROFILES=ts` in `.env` (optionally
   `TS_HOSTNAME`, default `resellflow`), then:
   ```bash
   sudo docker compose up -d
   ```
   With `COMPOSE_PROFILES=ts` the sidecar starts with every `up`, no
   `--profile ts` needed.
3. Enable HTTPS for your tailnet (admin → DNS → Enable HTTPS), then visit
   `https://resellflow.<tailnet>.ts.net` on your phone.

## Build on another machine (if the NAS can't build)
On a machine with Docker that matches the NAS architecture (usually amd64):
```bash
docker buildx build --platform linux/amd64 -t resellflow:latest --load .
docker save resellflow:latest | gzip > resellflow.tar.gz
# copy resellflow.tar.gz to the NAS, then on the NAS:
docker load < resellflow.tar.gz
```
Then on the NAS, edit `docker-compose.yml` so the `app` service uses the prebuilt
image instead of building:
```yaml
  app:
    image: resellflow:latest   # replaces: build: .
```
and run `docker compose up -d`.
> Note: a Mac is ARM (arm64); for an Intel NAS you must use
> `buildx --platform linux/amd64`, or just build on the NAS itself.

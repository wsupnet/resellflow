# Hosting ResellFlow on a NAS

## ⚡ Simplest path (build on the NAS, like any other app)

The compose file builds the app from source on the NAS, so there's **no tarball
and no registry**. You only need a `.env` with your own secrets.

1. Copy this whole folder to the NAS (a shared folder via SMB).
2. SSH in, `cd` into the folder, then `cp .env.example .env` and set the
   REQUIRED values (`POSTGRES_PASSWORD`, `DATABASE_URL` with that same password,
   `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`) — see section 2 below.
   Compose refuses to start until they're set.
3. Run:
   ```bash
   sudo docker compose up -d --build
   ```
   The first build takes a few minutes (it installs dependencies + compiles).
4. Wait until it's up, then open `http://<NAS-IP>:3939` and log in with the
   `ADMIN_EMAIL` / `ADMIN_PASSWORD` you set in `.env`.

That's the whole deployment. Start fresh and add your inventory in the app.

**If you hit "unhealthy" from an earlier attempt**, clear the half-made database
volume first:
```bash
sudo docker compose down -v
sudo docker compose up -d --build
```

### Optional config
There are no built-in default secrets — everything comes from your `.env`.
Everything below is reference for HTTPS and backups.

---



ResellFlow is a standard Docker Compose app, so any NAS that runs Docker can host
it: **Synology** (Container Manager), **QNAP** (Container Station), **Unraid**,
or **TrueNAS SCALE**.

## UGREEN NAS (UGOS Pro) — quick path

UGREEN NASync boxes are x86/amd64 with ample RAM, so build on the NAS directly.

1. **App Center → install "Docker".** This gives you Docker + Compose ("Projects").
2. **Enable SSH:** Control Panel → Terminal/SSH (UGOS) → enable SSH.
3. **Make a shared folder** (File Manager), e.g. `docker`, and copy this project
   into it via SMB (`\\<NAS-IP>`).
4. **SSH in:** `ssh <youruser>@<NAS-IP>`. The share is usually under
   `/volume1/<share>` — `ls /volume1` to confirm, then `cd` into the project.
5. `cp .env.example .env` and set the REQUIRED values (see section 2 below).
   Then `sudo docker compose up -d --build` (UGOS usually needs `sudo` for
   docker). First build takes a few minutes.
6. Open `http://<NAS-IP>:3939` and log in with the `ADMIN_EMAIL` /
   `ADMIN_PASSWORD` from your `.env`.
7. **HTTPS for the camera:** UGOS may not have a Tailscale app yet, and its web UI
   can occupy 80/443 (so the Caddy profile may clash). Easiest reliable option is
   **Tailscale in a container** doing `serve` — see "HTTPS via Tailscale container"
   at the bottom. (If 80/443 are free, the Caddy `--profile https` also works.)

The sections below are the general reference for any NAS.

## 0. Before you start
- Make sure your NAS has **Docker + Docker Compose** and ideally **SSH** enabled.
- The image build (`next build`) wants roughly **2 GB of free RAM**. If your NAS
  is low on RAM, see **"Build on another machine"** at the bottom.
- Note your NAS CPU architecture. Most Synology/QNAP are **x86_64 (amd64)**; some
  are ARM. This only matters if you build the image elsewhere.

## 1. Copy the project to the NAS
Copy this whole folder to a share on the NAS (SMB drag-and-drop, `git clone`, or
`scp`). You can skip `node_modules/`, `.next/`, and `.env` — they're rebuilt. Do
bring the `backup/` folder so you can restore your data.

## 2. Create the `.env`
In the project folder on the NAS:
```bash
cp .env.example .env
```
Edit `.env` and set:
- `POSTGRES_PASSWORD` — a strong password
- `DATABASE_URL` — must contain that same password (e.g. `postgresql://resell:THEPASSWORD@db:5432/resellflow?schema=public`)
- `AUTH_SECRET` — generate one: `openssl rand -base64 48`
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — your login
- `APP_PORT` — a free port on the NAS (Synology uses 5000/5001; pick e.g. `3939`)
- `SITE_ADDRESS` — your NAS IP or Tailscale name (only used if you run the Caddy HTTPS profile)

## 3. Build & start
Over SSH, from the project folder:
```bash
docker compose up -d --build
```
First build takes a few minutes. Check it's up: `docker compose ps` and `docker compose logs -f app`.

## 4. Restore your data
```bash
# Database
cat backup/resellflow-db.sql | docker compose exec -T db psql -U resell -d resellflow

# Photos (only if backup/uploads has files)
docker compose cp ./backup/uploads/. app:/app/uploads
```
> Re-run the DB dump on the old machine right before cutover so you capture the
> latest data:
> `docker compose exec -T db pg_dump -U resell -d resellflow --clean --if-exists > backup/resellflow-db.sql`

## 5. Open it
Visit `http://<NAS-IP>:<APP_PORT>` on your LAN and log in. Everything (login,
inventory, sales, ledger) works over plain HTTP — **except the camera scanner**,
which needs HTTPS (next step).

## 6. HTTPS for the phone camera
Two good options:

**A) Tailscale (recommended — trusted cert, works anywhere)**
- Install Tailscale on the NAS (Synology/QNAP have a package; or run the
  `tailscale/tailscale` container).
- Enable HTTPS for your tailnet (admin console → DNS → Enable HTTPS).
- Run: `tailscale serve --bg <APP_PORT>`
- Open `https://<nas-name>.<tailnet>.ts.net` on your phone.

**B) Caddy profile (self-contained)**
- Set `SITE_ADDRESS` in `.env` to the NAS IP, then:
  `docker compose --profile https up -d`
- Visit `https://<NAS-IP>` (accept the one-time self-signed cert warning).

If your NAS already runs a reverse proxy (Synology "Reverse Proxy", Nginx Proxy
Manager, Traefik) with a domain + Let's Encrypt, you can instead point it at the
app container / `APP_PORT` for a clean public hostname.

## 7. Backups & persistence
Data lives in two Docker named volumes on the NAS: `db_data` (Postgres) and
`uploads` (photos). Back them up regularly:
```bash
# DB snapshot
docker compose exec -T db pg_dump -U resell -d resellflow --clean --if-exists > resellflow-$(date +%F).sql
# Photos snapshot
docker compose cp app:/app/uploads ./uploads-$(date +%F)
```
Tip: schedule these with the NAS task scheduler. Or, for easier NAS-native
snapshots, change the compose `volumes` to bind-mounts under a share
(e.g. `./data/db:/var/lib/postgresql/data`) before first launch.

## 8. Auto-start & updates
- `restart: unless-stopped` is already set, so the app comes back after reboots
  (ensure the NAS Docker service starts on boot — it does by default).
- To update after code changes: copy the new code over, then
  `docker compose up -d --build`.

## 9. Passwords & lockout

- **Change your password** in the app: **Settings → Account**. It needs your
  current password, and signs out every other device.
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` are only used to create the admin
  account on the **first** boot. Changing `ADMIN_PASSWORD` later does nothing to
  the existing account (and changing `ADMIN_EMAIL` would create a second admin).

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

Run Tailscale as a sidecar that shares the app's network and serves it over HTTPS
with a trusted cert — no host ports needed, works remotely.

1. In the Tailscale admin console, create a **reusable auth key**.
2. Create `serve.json` next to the compose file:
   ```json
   {
     "TCP": { "443": { "HTTPS": true } },
     "Web": {
       "${TS_CERT_DOMAIN}:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3000" } } }
     }
   }
   ```
3. Add this service to `docker-compose.yml` (shares the app's network namespace so
   `127.0.0.1:3000` is the app):
   ```yaml
   tailscale:
     image: tailscale/tailscale:latest
     network_mode: service:app
     environment:
       TS_AUTHKEY: ${TS_AUTHKEY}
       TS_STATE_DIR: /var/lib/tailscale
       TS_SERVE_CONFIG: /config/serve.json
       TS_HOSTNAME: resellflow
     volumes:
       - ts_state:/var/lib/tailscale
       - ./serve.json:/config/serve.json:ro
     cap_add: [net_admin]
     restart: unless-stopped
   # add to the bottom volumes: list ->  ts_state:
   ```
4. Put `TS_AUTHKEY=tskey-...` in `.env`, then `docker compose up -d`.
5. Enable HTTPS for your tailnet (admin → DNS → Enable HTTPS), then visit
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

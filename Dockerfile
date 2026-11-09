# Debian-based (node:22-slim) for maximum native-module compatibility — sharp and
# Prisma install far more reliably here than on Alpine/musl, which is what made the
# NAS build flaky. Installs are deterministic via package-lock.json + `npm ci`.
# Node 22 is the current LTS line (Node 20 stopped getting security fixes in
# April 2026); the minor tag keeps picking up its patch releases on rebuild.
#
# Privacy: NEXT_TELEMETRY_DISABLED stops Next.js sending build/usage telemetry to
# Vercel, CHECKPOINT_DISABLE stops the Prisma CLI's version check-in to
# checkpoint.prisma.io. Set in every stage — ENV doesn't carry across stages. At
# runtime the Prisma CLI is called directly (not via npx) and
# NPM_CONFIG_UPDATE_NOTIFIER=false stops npm checking the registry for updates, so
# a running container makes no outbound requests of its own.

# ───────────────────────── deps ─────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# ───────────────────────── builder ─────────────────────────
FROM node:22-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
# Generate the Prisma client before copying the rest of the code, so this step is
# cached unless the schema itself changes.
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npx prisma generate
COPY . .
# `next build` directly: `npm run build` would run prisma generate a second time.
# Then drop sharp's WebAssembly fallback, which is never used on Linux (~9 MB).
RUN npx next build && npm run build:scripts \
 && rm -rf node_modules/@img/sharp-wasm32 .next/standalone/node_modules/@img/sharp-wasm32

# ───────────────────────── runner ─────────────────────────
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1 NPM_CONFIG_UPDATE_NOTIFIER=false
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Standalone server output + static assets
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Prisma engine + CLI (for db push at boot), the compiled admin-seed and
# reset-password scripts, and the packages they need at runtime.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/.bin ./node_modules/.bin
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs
# sharp (image thumbnails) ships its native libvips binaries under @img
COPY --from=builder /app/node_modules/sharp ./node_modules/sharp
COPY --from=builder /app/node_modules/@img ./node_modules/@img
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
# Release notes for the in-app "what's new" popup (lib/changelog.ts).
COPY --from=builder /app/CHANGELOG.md ./CHANGELOG.md

# Writable dirs for uploaded item photos + the Next cache.
RUN mkdir -p /app/uploads /app/secrets /app/.next/cache
VOLUME /app/uploads

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
# Runs as root (like the Content Calendar app) so the container can always read
# its own files — some NAS Docker setups block non-root users from /app.

# Startup is inlined (no external entrypoint script) so it can't be blocked by a
# NAS's file-permission sandboxing: check (or generate) AUTH_SECRET, build the
# database URL (from the generated db password unless .env sets one), wait for the
# DB (stopping with the real error on bad credentials), sync the schema, then the
# boot checks (optional admin from .env, data folder / first-run messages), then
# start the server. Any of those failing stops the container with its message in
# the logs. With no accounts yet, the first visitor gets the admin setup page.
#
# The schema sync never deletes data: additive changes (new tables / columns with
# defaults) apply automatically, but if an update would drop data, `db push`
# refuses, the error is shown (not hidden behind "waiting for db"), and the app
# stops until someone reviews it — see README "Updates that change the database".
CMD ["sh", "-c", "AUTH_SECRET=\"$(node dist/scripts/ensure-secret.js)\" || exit 1; export AUTH_SECRET; DATABASE_URL=\"$(node dist/scripts/db-url.js)\" || exit 1; export DATABASE_URL; node dist/scripts/wait-for-db.js || exit 1; node_modules/.bin/prisma db push --skip-generate || { echo; echo '  ✗ Database update stopped - nothing was changed (see the error above).'; echo '    If it warns about data loss: back up first, then see the README section'; echo '    \"Updates that change the database\".'; exit 1; }; node dist/prisma/seed.js || exit 1; exec node server.js"]

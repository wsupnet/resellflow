# Debian-based (node:20-slim) for maximum native-module compatibility — sharp and
# Prisma install far more reliably here than on Alpine/musl, which is what made the
# NAS build flaky. Installs are deterministic via package-lock.json + `npm ci`.

# ───────────────────────── deps ─────────────────────────
FROM node:20-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# ───────────────────────── builder ─────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build
RUN npm run build:scripts

# ───────────────────────── runner ─────────────────────────
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
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

# Writable dirs for uploaded item photos + the Next cache.
RUN mkdir -p /app/uploads /app/.next/cache
VOLUME /app/uploads

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
# Runs as root (like the Content Calendar app) so the container can always read
# its own files — some NAS Docker setups block non-root users from /app.

# Startup is inlined (no external entrypoint script) so it can't be blocked by a
# NAS's file-permission sandboxing: wait for the DB, sync the schema, seed the
# admin, then start the server.
CMD ["sh", "-c", "until npx prisma db push --skip-generate --accept-data-loss 2>/dev/null; do echo 'waiting for db...'; sleep 2; done; node dist/prisma/seed.js || echo 'seed skipped'; exec node server.js"]

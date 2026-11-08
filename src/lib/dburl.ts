// Shared by the app (lib/db.ts) and the boot scripts. No "server-only" import, so
// the esbuild-bundled scripts can use it.
//
// The connection string is built from parts so nobody has to keep a password in
// two places. The password comes from, in order:
//   1. DATABASE_URL, if set (older installs, or an external database) — used as-is
//   2. POSTGRES_PASSWORD, if set in .env
//   3. the file the db container generates on first boot (secrets/db_password)
import { readFileSync } from "fs";
import path from "path";

export const SECRETS_DIR = process.env.SECRETS_DIR || "/app/secrets";
export const DB_PASSWORD_FILE = path.join(SECRETS_DIR, "db_password");

export function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  let password = process.env.POSTGRES_PASSWORD || "";
  if (!password) {
    try {
      password = readFileSync(DB_PASSWORD_FILE, "utf8").trim();
    } catch {
      /* reported below */
    }
  }
  if (!password) {
    throw new Error(
      `No database password: ${DB_PASSWORD_FILE} doesn't exist and POSTGRES_PASSWORD isn't set. ` +
        `The db container creates that file on its first start — check that db and app mount the same secrets folder.`
    );
  }
  const user = process.env.POSTGRES_USER || "resell";
  const db = process.env.POSTGRES_DB || "resellflow";
  const host = process.env.POSTGRES_HOST || "db";
  const e = encodeURIComponent;
  return `postgresql://${e(user)}:${e(password)}@${host}:5432/${e(db)}?schema=public`;
}

/** Fill in DATABASE_URL for Prisma if it isn't set. Never throws: if the password
 *  can't be found, Prisma reports the missing URL when it first connects. */
export function ensureDatabaseUrl(): void {
  if (process.env.DATABASE_URL) return;
  try {
    process.env.DATABASE_URL = databaseUrl();
  } catch {
    /* leave unset */
  }
}

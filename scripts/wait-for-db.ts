/**
 * Boot step, run by the container before the schema sync:
 *
 *   node dist/scripts/wait-for-db.js || exit 1
 *
 * Waits for Postgres to accept connections (it can be slow to start, e.g. a NAS
 * waking its drives), but stops at once with the real error when retrying can't
 * help — wrong password, missing database — instead of printing "waiting for db..."
 * forever. Gives up after about two minutes either way.
 */
import { PrismaClient } from "@prisma/client";
import { ensureDatabaseUrl } from "../src/lib/dburl";

const ATTEMPTS = 60;
const DELAY_MS = 2000;

// Prisma connection errors that won't fix themselves by waiting.
const FATAL: Record<string, string> = {
  P1000: "The database rejected the username/password in DATABASE_URL.",
  P1003: "The database named in DATABASE_URL doesn't exist.",
  P1010: "The database user in DATABASE_URL isn't allowed to connect.",
  P1013: "DATABASE_URL isn't a valid connection string."
};

function fail(lines: string[]): never {
  console.error(`\n  ✗ ${lines.join("\n    ")}\n`);
  process.exit(1);
}

async function main() {
  ensureDatabaseUrl();
  let last = "";
  for (let i = 1; i <= ATTEMPTS; i++) {
    const prisma = new PrismaClient();
    try {
      // $connect (not a query) is what reports Prisma's P10xx connection codes.
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      await prisma.$disconnect();
      return;
    } catch (e) {
      await prisma.$disconnect().catch(() => {});
      const code = (e as { errorCode?: string; code?: string }).errorCode ?? (e as { code?: string }).code ?? "";
      last = (e as Error).message.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("Invalid `")).join(" ") || String(e);
      if (FATAL[code]) {
        fail([
          FATAL[code],
          `(${code}: ${last})`,
          "Postgres keeps the password it was first created with. If .env sets POSTGRES_PASSWORD or",
          "DATABASE_URL, it must match that original password; if neither is set, the generated",
          "secrets/db_password must be the one the database was created with."
        ]);
      }
      console.log("waiting for db...");
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }
  fail([`Couldn't reach the database after ${(ATTEMPTS * DELAY_MS) / 1000}s.`, `Last error: ${last}`]);
}

main();

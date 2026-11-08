/**
 * Boot step, run by the container before anything touches the database:
 *
 *   DATABASE_URL="$(node dist/scripts/db-url.js)" || exit 1
 *
 * Prints the connection string (see src/lib/dburl.ts for where the password comes
 * from). The URL is the only thing written to stdout; errors go to stderr.
 */
import { databaseUrl } from "../src/lib/dburl";

try {
  process.stdout.write(databaseUrl());
} catch (e) {
  console.error(`\n  ✗ ${(e as Error).message}\n`);
  process.exit(1);
}

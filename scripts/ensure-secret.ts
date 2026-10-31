/**
 * Boot-time AUTH_SECRET check, run by the container before the server starts:
 *
 *   AUTH_SECRET="$(node dist/scripts/ensure-secret.js)" || exit 1
 *
 * - AUTH_SECRET set in the environment → validated (no placeholder, long enough)
 *   and echoed back unchanged.
 * - Not set → read from AUTH_SECRET_FILE (default /app/secrets/auth_secret),
 *   generating a random one there on first boot. The file lives on the APPDATA
 *   mount, so sessions survive rebuilds and nobody has to invent a secret.
 *
 * The secret is the only thing written to stdout; messages go to stderr.
 */
import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { secretProblem } from "../src/lib/secret";

function fail(msg: string): never {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

function main() {
  const fromEnv = process.env.AUTH_SECRET;
  if (fromEnv) {
    const problem = secretProblem(fromEnv);
    if (problem) {
      fail(
        `${problem}.\n` +
          `    Fix: delete the AUTH_SECRET line from .env so one is generated for you,\n` +
          `    or set it to the output of: openssl rand -base64 48\n` +
          `    (Changing it signs everyone out once.)`
      );
    }
    process.stdout.write(fromEnv);
    return;
  }

  const file = process.env.AUTH_SECRET_FILE || "/app/secrets/auth_secret";
  if (existsSync(file)) {
    const saved = readFileSync(file, "utf8").trim();
    if (!secretProblem(saved)) {
      process.stdout.write(saved);
      return;
    }
    console.error(`  ! ${file} holds an unusable secret — replacing it (everyone is signed out once).`);
  }

  const secret = randomBytes(48).toString("base64url");
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, secret + "\n", { mode: 0o600 });
  } catch (e) {
    fail(`Couldn't save a generated AUTH_SECRET to ${file}: ${(e as Error).message}`);
  }
  console.error(`  ✓ Generated a new AUTH_SECRET in ${file}`);
  process.stdout.write(secret);
}

main();

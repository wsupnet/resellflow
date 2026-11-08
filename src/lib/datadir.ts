// First-run and missing-data checks. Shared by the boot-time seed script (prints
// them to the logs) and the first-run setup page (shows them in the browser). No
// "server-only" import, so the esbuild-bundled seed script can use it.
import { existsSync, readdirSync, writeFileSync } from "fs";
import path from "path";
import { SECRETS_DIR } from "./dburl";

/** Written once the database has at least one account. If it's there but the
 *  database is empty, the database folder went missing or was swapped. */
const MARKER = path.join(SECRETS_DIR, ".has-data");
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads"));

/** The data folder as written on the host (compose passes DATA_DIR in), for messages. */
export function dataDirLabel(): string {
  return process.env.DATA_DIR_HOST || "./data";
}

export function markHasData(): void {
  try {
    if (!existsSync(MARKER)) writeFileSync(MARKER, `${new Date().toISOString()}\n`, { mode: 0o600 });
  } catch {
    /* best effort: the warning below just won't fire */
  }
}

function hasPhotos(): boolean {
  try {
    return readdirSync(UPLOAD_DIR).some((f) => f.endsWith(".jpg"));
  } catch {
    return false;
  }
}

/**
 * Problems worth shouting about while the database has no accounts. Empty list on
 * a genuine first run.
 */
export function emptyDatabaseWarnings(): string[] {
  const dir = dataDirLabel();
  const out: string[] = [];
  if (existsSync(MARKER) || hasPhotos()) {
    out.push(
      `This server has stored data before (in ${dir}/reselling-app), but its database is empty. ` +
        `If you expected your existing data, stop the app and check that DATA_DIR points at the right folder ` +
        `and that ${dir}/reselling-app/postgres is intact. Don't create a new account until you've checked.`
    );
  }
  // Before this version the folder was set with APPDATA. On Windows APPDATA is
  // always set (to …\AppData\Roaming), so only mention values that look like ours.
  const legacy = process.env.LEGACY_APPDATA || "";
  if (legacy && !/appdata[\\/]+roaming/i.test(legacy) && path.normalize(legacy) !== path.normalize(dir)) {
    out.push(
      `Your .env sets APPDATA=${legacy}, which this version no longer reads — it now uses DATA_DIR (currently ${dir}). ` +
        `If your data is in ${legacy}/reselling-app, rename that .env line to DATA_DIR=${legacy} and run docker compose up -d again.`
    );
  }
  return out;
}

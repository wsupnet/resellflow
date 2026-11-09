// "What's new" — parsed from CHANGELOG.md at the repo root (copied into the
// image). The newest entry's version is the app version.

import fs from "fs";
import path from "path";

export interface ChangelogEntry {
  version: string;
  date: string | null;
  items: { title: string | null; text: string }[];
}

/**
 * Sentinel stored in User.seenVersion for a brand-new account: it skips the
 * backlog of past releases and gets a one-time welcome instead.
 * A null seenVersion is an account that predates this feature (it already had
 * 0.1.0's features), so it's treated as having seen 0.1.0.
 */
export const WELCOME = "welcome";
const LEGACY_SEEN = "0.1.0";

let cache: ChangelogEntry[] | null = null;

export function getChangelog(): ChangelogEntry[] {
  if (cache) return cache;
  let raw = "";
  try {
    raw = fs.readFileSync(path.join(process.cwd(), "CHANGELOG.md"), "utf8");
  } catch {
    return (cache = []);
  }
  const entries: ChangelogEntry[] = [];
  let cur: ChangelogEntry | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const h = line.match(/^##\s+v?(\d+\.\d+\.\d+)\s*(?:[—–-]\s*(.+))?$/);
    if (h) {
      cur = { version: h[1], date: h[2]?.trim() || null, items: [] };
      entries.push(cur);
      continue;
    }
    const b = cur && line.match(/^\s*[-*]\s+(.+)$/);
    if (b && cur) {
      const t = b[1].match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
      cur.items.push(t ? { title: t[1].replace(/:$/, ""), text: t[2] } : { title: null, text: b[1] });
    } else if (cur && line.trim() && !line.startsWith("#") && cur.items.length) {
      // Wrapped continuation of the previous bullet.
      const last = cur.items[cur.items.length - 1];
      last.text += " " + line.trim();
    }
  }
  entries.sort((a, b) => compareVersions(b.version, a.version));
  return (cache = entries);
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** The running app's version (newest changelog entry). */
export function appVersion(): string {
  return getChangelog()[0]?.version ?? "0.0.0";
}

/**
 * What to show a user who last saw `seen`: the welcome (new account), the
 * releases newer than what they saw, or nothing.
 */
export function whatsNewFor(seen: string | null): { kind: "welcome" | "updates"; entries: ChangelogEntry[] } | null {
  const all = getChangelog();
  if (!all.length) return null;
  if (seen === WELCOME) return { kind: "welcome", entries: [all[all.length - 1]] };
  const since = seen && /^\d+\.\d+\.\d+$/.test(seen) ? seen : LEGACY_SEEN;
  const entries = all.filter((e) => compareVersions(e.version, since) > 0);
  return entries.length ? { kind: "updates", entries } : null;
}

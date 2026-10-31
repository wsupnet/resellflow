// Shared by the app (lib/auth.ts) and the boot-time ensure-secret script. No
// "server-only" import, so the esbuild-bundled script can use it.

export const MIN_SECRET_LENGTH = 32;

// Placeholder values that have shipped in this repo's docs/examples. Anyone can
// read them on GitHub, so a server using one can have its sessions forged.
const KNOWN_PLACEHOLDERS = new Set(["replace-with-a-long-random-string"]);

/** Why an AUTH_SECRET is unsafe to sign sessions with, or null if it's fine. */
export function secretProblem(s: string): string | null {
  if (KNOWN_PLACEHOLDERS.has(s.trim())) return "AUTH_SECRET is still the example placeholder from .env.example";
  if (s.length < MIN_SECRET_LENGTH) return `AUTH_SECRET is too short (${s.length} characters; needs at least ${MIN_SECRET_LENGTH})`;
  return null;
}

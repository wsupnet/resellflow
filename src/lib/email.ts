// Shared by the app, the admin seed and the reset-password CLI (no "server-only"
// import, so the esbuild-bundled scripts can use it).

/**
 * The one canonical form of an email/login: trimmed + lowercased. Accounts are
 * stored this way and looked up with an exact match, never a case-insensitive
 * one — Prisma's `mode: "insensitive"` compiles to SQL ILIKE, where `%` and `_`
 * in the input act as wildcards (a login of "%" would match any account).
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Escape `\`, `%` and `_` so a value can be used in a case-insensitive Prisma
 *  `equals` (SQL ILIKE) and match only itself. */
export function likeLiteral(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

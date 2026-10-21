import bcrypt from "bcryptjs";

// Shared by the app and the reset-password CLI so both hash and validate the
// same way. No "server-only" import, so the esbuild-bundled script can use it.

export const MIN_PASSWORD_LENGTH = 12;
// bcrypt only uses the first 72 bytes; reject longer so nothing is silently ignored.
const MAX_PASSWORD_BYTES = 72;

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

/** Why a new password is unacceptable, or null if it's fine. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (Buffer.byteLength(pw, "utf8") > MAX_PASSWORD_BYTES) return `Password must be at most ${MAX_PASSWORD_BYTES} bytes`;
  return null;
}

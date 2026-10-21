import "server-only";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./db";

export { hashPassword, verifyPassword } from "./password";

const COOKIE = "resell_session";
const ALG = "HS256";

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(s);
}

/** `sessionVersion` must be the user's current value; bumping it in the DB
 *  (password change/reset) invalidates every session issued before. */
export async function createSession(userId: string, sessionVersion = 0): Promise<void> {
  const token = await new SignJWT({ uid: userId, sv: sessionVersion })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());

  // Mark the cookie Secure only when the request is actually HTTPS. Browsers
  // reject Secure cookies over plain http:// (except on localhost), which would
  // silently break login when accessing the app by LAN IP from a phone. Behind a
  // TLS proxy (Caddy/Tailscale) the forwarded proto is https, so it stays Secure.
  const proto = headers().get("x-forwarded-proto");
  const isHttps = proto ? proto.split(",")[0].trim() === "https" : false;

  cookies().set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}

export function destroySession(): void {
  cookies().delete(COOKIE);
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
}

/** Returns the logged-in user, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const uid = payload.uid as string;
    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user) return null;
    // Tokens issued before session versioning carry no `sv`; treat them as 0.
    if (((payload.sv as number | undefined) ?? 0) !== user.sessionVersion) return null;
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin
    };
  } catch {
    return null;
  }
}

/** Throws (for use in server actions / routes) if not authenticated. */
export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new Error("UNAUTHORIZED");
  return u;
}

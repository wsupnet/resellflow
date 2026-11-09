import "server-only";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./db";
import { secretProblem } from "./secret";

export { hashPassword, verifyPassword } from "./password";

const COOKIE = "resell_session";
const ALG = "HS256";

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  // The boot script already refuses these; this also covers `next start` / dev.
  const problem = secretProblem(s);
  if (problem) throw new Error(problem);
  return new TextEncoder().encode(s);
}

/** `sessionVersion` must be the user's current value; bumping it in the DB
 *  (password change/reset) invalidates every session issued before. */
export async function createSession(userId: string, sessionVersion = 0): Promise<void> {
  // A row per sign-in, so Settings → Account can list and end sessions one by one.
  const userAgent = (await headers()).get("user-agent")?.slice(0, 400) ?? null;
  const row = await prisma.session.create({ data: { userId, sessionVersion, userAgent } });
  const token = await new SignJWT({ uid: userId, sv: sessionVersion, sid: row.id, typ: "session" })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());

  // Mark the cookie Secure only when the request is actually HTTPS. Browsers
  // reject Secure cookies over plain http:// (except on localhost), which would
  // silently break login when accessing the app by LAN IP from a phone. Behind a
  // TLS proxy (Caddy/Tailscale) the forwarded proto is https, so it stays Secure.
  const proto = (await headers()).get("x-forwarded-proto");
  const isHttps = proto ? proto.split(",")[0].trim() === "https" : false;

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const sid = await currentSessionId();
  if (sid) await prisma.session.deleteMany({ where: { id: sid } });
  jar.delete(COOKIE);
}

/** The session row id named by this browser's cookie (null for older cookies). */
export async function currentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.sid === "string" ? payload.sid : null;
  } catch {
    return null;
  }
}

/** How long a session lives (matches the cookie / token expiry). */
export const SESSION_DAYS = 30;
// lastSeenAt is refreshed at most this often, so normal browsing isn't a DB write per request.
const TOUCH_MS = 5 * 60 * 1000;

// ─── trusted-device cookie (login throttling) ───
// After a successful sign-in the browser keeps a signed, long-lived "device" cookie
// naming the account. Login throttling gives such a device its own attempt budget,
// so someone hammering an account from elsewhere can lock out strangers but not the
// owner's own browsers/phone. It grants nothing by itself — a password is still
// required — and isn't a session (signing out leaves it, as intended).
const DEVICE_COOKIE = "resell_device";
const DEVICE_MAX_AGE = 60 * 60 * 24 * 365;

export async function issueDeviceCookie(userId: string): Promise<void> {
  const jar = await cookies();
  // Keep the same device id across sign-ins on this browser.
  const existing = await trustedDeviceId(userId);
  const did = existing ?? crypto.randomUUID();
  const token = await new SignJWT({ uid: userId, did, typ: "device" })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("365d")
    .sign(secret());
  const proto = (await headers()).get("x-forwarded-proto");
  jar.set(DEVICE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: proto ? proto.split(",")[0].trim() === "https" : false,
    path: "/api/auth",
    maxAge: DEVICE_MAX_AGE
  });
}

/** This browser's device id if it has signed in to `userId` before, else null. */
export async function trustedDeviceId(userId: string): Promise<string | null> {
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload.typ === "device" && payload.uid === userId && typeof payload.did === "string" ? payload.did : null;
  } catch {
    return null;
  }
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
  /** This browser's session row; null for cookies issued before sessions were tracked. */
  sessionId: string | null;
}

/** Returns the logged-in user, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    // Only session tokens (older ones carry no `typ`) — never a device token,
    // which is signed with the same secret.
    if (payload.typ !== undefined && payload.typ !== "session") return null;
    const uid = payload.uid as string;
    const sid = typeof payload.sid === "string" ? payload.sid : null;
    let user;
    if (sid) {
      // A tracked session must still exist: signing it out (here or from another
      // device) deletes the row and ends it immediately.
      const row = await prisma.session.findUnique({ where: { id: sid }, include: { user: true } });
      if (!row || row.userId !== uid) return null;
      user = row.user;
      if (Date.now() - +row.lastSeenAt > TOUCH_MS) {
        await prisma.session.update({ where: { id: sid }, data: { lastSeenAt: new Date() } }).catch(() => {});
      }
    } else {
      user = await prisma.user.findUnique({ where: { id: uid } });
    }
    if (!user) return null;
    // Tokens issued before session versioning carry no `sv`; treat them as 0.
    if (((payload.sv as number | undefined) ?? 0) !== user.sessionVersion) return null;
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
      sessionId: sid
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

/**
 * The user's open sessions, newest activity first. Rows that can no longer be
 * used (expired, or from before a password change) are cleared out first.
 */
export async function listSessions(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
  if (!user) return [];
  const cutoff = new Date(Date.now() - SESSION_DAYS * 86400000);
  await prisma.session.deleteMany({
    where: { userId, OR: [{ createdAt: { lt: cutoff } }, { sessionVersion: { not: user.sessionVersion } }] }
  });
  return prisma.session.findMany({ where: { userId }, orderBy: { lastSeenAt: "desc" } });
}


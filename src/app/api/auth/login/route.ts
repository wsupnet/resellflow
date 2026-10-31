import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword, createSession, issueDeviceCookie, trustedDeviceId } from "@/lib/auth";
import { clearFailures, clientIp, recordFailure, retryAfter } from "@/lib/ratelimit";
import { isCrossSite, isJson } from "@/lib/origin";
import { readJsonLimited } from "@/lib/body";
import { normalizeEmail } from "@/lib/email";

// Accept any non-empty identifier (not a strict RFC email) so local logins like
// "admin@local" work — the value is just matched against the stored account.
// Length caps keep a huge body from being hashed (bcrypt only reads 72 bytes anyway).
const schema = z.object({
  email: z.string().min(1).max(254),
  password: z.string().min(1).max(1024)
});
const MAX_BODY_BYTES = 8 * 1024;

// Brute-force throttle. Attempts are counted per account (by user id, so every
// spelling of the email shares one budget) and, behind a trusted proxy, per IP.
// A browser that has signed in to the account before (trusted-device cookie) gets
// its own budget instead, so a stranger hammering the account can't lock its owner
// out of their usual devices.
const WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_LIMIT = 10;
const DEVICE_LIMIT = 10;
const IP_LIMIT = 30;

// Unknown emails are still checked against a real bcrypt hash, so a wrong email
// takes as long as a wrong password and response time can't reveal who has an account.
let dummyHash: Promise<string> | null = null;

export async function POST(req: Request) {
  if (isCrossSite(req) || !isJson(req)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }
  const body = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!body.ok) {
    return NextResponse.json({ error: body.status === 413 ? "Request too large" : "Invalid input" }, { status: body.status });
  }
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { password } = parsed.data;
  // Exact match on the normalized email (accounts are stored lowercased) — never a
  // case-insensitive/LIKE match, where "%" or "_" would act as wildcards.
  const email = normalizeEmail(parsed.data.email);
  const user = await prisma.user.findUnique({ where: { email } });

  const deviceId = user ? await trustedDeviceId(user.id) : null;
  const ip = clientIp(req);
  const gates: [key: string, limit: number][] = deviceId
    ? [[`login:device:${deviceId}`, DEVICE_LIMIT]]
    : [[`login:acct:${user ? user.id : `email:${email}`}`, ACCOUNT_LIMIT], ...(ip ? [[`login:ip:${ip}`, IP_LIMIT] as [string, number]] : [])];

  const wait = Math.max(...gates.map(([k, limit]) => retryAfter(k, limit)));
  if (wait > 0) {
    return NextResponse.json(
      { error: `Too many failed sign-in attempts. Try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? "s" : ""}.` },
      { status: 429, headers: { "Retry-After": String(wait) } }
    );
  }

  dummyHash ??= hashPassword("timing-equalizer-not-a-real-password");
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !ok) {
    for (const [k] of gates) recordFailure(k, WINDOW_MS);
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }
  // Success only resets this route's own budget (a trusted device's success doesn't
  // reset the stranger-facing account budget).
  clearFailures(gates[0][0]);
  await createSession(user.id, user.sessionVersion);
  await issueDeviceCookie(user.id);
  return NextResponse.json({ ok: true });
}

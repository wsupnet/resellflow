import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";
import { clientIp, recordFailure, retryAfter } from "@/lib/ratelimit";
import { isCrossSite, isJson } from "@/lib/origin";
import { passwordProblem } from "@/lib/password";
import { normalizeEmail } from "@/lib/email";
import { readJsonLimited } from "@/lib/body";

const WINDOW_MS = 60 * 60 * 1000;
const IP_LIMIT = 10;
const GLOBAL_LIMIT = 100;
const MAX_BODY_BYTES = 8 * 1024;

// Invite-only registration: a valid, unused invite code is required.
const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().max(1024),
  displayName: z.string().max(100).optional(),
  code: z.string().min(1, "An invite code is required").max(100)
});

// Thrown inside the transaction when a concurrent signup claimed the invite first.
class InviteTaken extends Error {}

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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const { email, password, displayName, code } = parsed.data;
  const lowerEmail = normalizeEmail(email);
  // Same rule as password change / reset (12+ chars, ≤72 bytes).
  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  // Throttle invite-code guessing overall (codes are 48-bit random, so 100/hour
  // makes guessing hopeless) and per client IP when TRUST_PROXY says the
  // X-Forwarded-For header can be believed.
  const ip = clientIp(req);
  const keys: [string, number][] = [["register:all", GLOBAL_LIMIT], ...(ip ? [[`register:ip:${ip}`, IP_LIMIT] as [string, number]] : [])];
  const wait = Math.max(...keys.map(([k, limit]) => retryAfter(k, limit)));
  if (wait > 0) {
    return NextResponse.json(
      { error: "Too many invalid invite codes. Try again later." },
      { status: 429, headers: { "Retry-After": String(wait) } }
    );
  }

  const invite = await prisma.invite.findUnique({ where: { code } });
  if (!invite || invite.usedAt) {
    for (const [k] of keys) recordFailure(k, WINDOW_MS);
    return NextResponse.json({ error: "Invalid or already-used invite code" }, { status: 403 });
  }
  if (invite.email && normalizeEmail(invite.email) !== lowerEmail) {
    return NextResponse.json({ error: "This invite is for a different email" }, { status: 403 });
  }

  const existing = await prisma.user.findUnique({ where: { email: lowerEmail } });
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      // Claim the invite atomically: only one of two simultaneous signups with the
      // same code matches "still unused"; the other rolls back without an account.
      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { usedAt: new Date(), usedByEmail: lowerEmail }
      });
      if (claimed.count !== 1) throw new InviteTaken();
      return tx.user.create({
        data: {
          email: lowerEmail,
          passwordHash,
          displayName: displayName || null,
          settings: { create: {} }
        }
      });
    });
  } catch (e) {
    if (e instanceof InviteTaken) {
      return NextResponse.json({ error: "Invalid or already-used invite code" }, { status: 403 });
    }
    if ((e as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
    }
    throw e;
  }

  await createSession(user.id);
  return NextResponse.json({ ok: true });
}

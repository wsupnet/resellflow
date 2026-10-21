import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";

// Invite-only registration: a valid, unused invite code is required.
const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().optional(),
  code: z.string().min(1, "An invite code is required")
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const { email, password, displayName, code } = parsed.data;
  const lowerEmail = email.toLowerCase();

  const invite = await prisma.invite.findUnique({ where: { code } });
  if (!invite || invite.usedAt) {
    return NextResponse.json({ error: "Invalid or already-used invite code" }, { status: 403 });
  }
  if (invite.email && invite.email.toLowerCase() !== lowerEmail) {
    return NextResponse.json({ error: "This invite is for a different email" }, { status: 403 });
  }

  const existing = await prisma.user.findUnique({ where: { email: lowerEmail } });
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: lowerEmail,
        passwordHash,
        displayName: displayName || null,
        settings: { create: {} }
      }
    });
    await tx.invite.update({
      where: { id: invite.id },
      data: { usedAt: new Date(), usedByEmail: lowerEmail }
    });
    return u;
  });

  await createSession(user.id);
  return NextResponse.json({ ok: true });
}

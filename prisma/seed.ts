import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { passwordProblem } from "../src/lib/password";
import { normalizeEmail } from "../src/lib/email";

const prisma = new PrismaClient();

// Example values that have shipped in this repo's docs/.env.example. They're
// public, so an admin created with one is a known login.
const PLACEHOLDER_PASSWORDS = new Set(["change-me-admin", "changeme123"]);

/**
 * One-time fix-up for installs from before emails were normalized: older
 * versions stored ADMIN_EMAIL exactly as typed (e.g. "Wes@Example.com"), but
 * logins now match the lowercased email exactly. Lowercases any such row unless
 * that would collide with another account (then it's left as-is and reported).
 */
async function lowercaseStoredEmails() {
  const rows = await prisma.$queryRaw<{ id: string; email: string }[]>`SELECT id, email FROM "User" WHERE email <> lower(btrim(email))`;
  for (const r of rows) {
    try {
      await prisma.user.update({ where: { id: r.id }, data: { email: normalizeEmail(r.email) } });
      console.log(`  Normalized account email ${r.email} → ${normalizeEmail(r.email)}`);
    } catch {
      console.warn(`  ! Couldn't lowercase ${r.email}: another account already uses ${normalizeEmail(r.email)}.`);
    }
  }
}

async function main() {
  await lowercaseStoredEmails();

  const email = normalizeEmail(process.env.ADMIN_EMAIL ?? "");
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("  ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping admin seed.");
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`  Admin ${email} already exists.`);
    return;
  }

  // Refuse to create the first admin with the example password or one that breaks
  // the app's own rule — the boot stops here (like the AUTH_SECRET check) so a
  // copied .env.example can't ship a publicly known admin login.
  const problem = PLACEHOLDER_PASSWORDS.has(password) ? "it is the example placeholder from .env.example" : passwordProblem(password);
  if (problem) {
    console.error(
      `\n  ✗ ADMIN_PASSWORD can't be used (${problem}).\n` +
        `    Set ADMIN_PASSWORD in .env to your own password (at least 12 characters),\n` +
        `    then run: docker compose up -d\n`
    );
    process.exitCode = 1;
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: "Admin",
      isAdmin: true,
      settings: { create: {} }
    }
  });
  console.log(`  Created admin user ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

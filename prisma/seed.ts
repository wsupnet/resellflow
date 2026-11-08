import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { passwordProblem } from "../src/lib/password";
import { normalizeEmail } from "../src/lib/email";
import { ensureDatabaseUrl } from "../src/lib/dburl";
import { dataDirLabel, emptyDatabaseWarnings, markHasData } from "../src/lib/datadir";

ensureDatabaseUrl();
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

/**
 * Says where the data lives on every boot, and — while there are no accounts yet —
 * whether this looks like a genuine first run or like data that went missing.
 */
async function reportDataFolder() {
  const dir = dataDirLabel();
  console.log(`  Data folder: ${dir}/reselling-app`);
  if ((await prisma.user.count()) > 0) {
    markHasData();
    return;
  }
  const warnings = emptyDatabaseWarnings();
  if (warnings.length) {
    const bar = "  " + "!".repeat(72);
    console.warn(`\n${bar}\n  ! DATA EXPECTED BUT NOT FOUND\n${bar}`);
    for (const w of warnings) console.warn(`  ! ${w}\n`);
    console.warn(bar + "\n");
  } else {
    console.log(
      `  First run: started with a new, empty database in ${dir}/reselling-app/postgres.\n` +
        `  Open the app in your browser to create the admin account.\n` +
        `  (Expected existing data? Stop now and check DATA_DIR.)`
    );
  }
}

/** Optional: create the first admin from ADMIN_EMAIL / ADMIN_PASSWORD (for setups
 *  without a browser handy). Normally the first-run page in the browser does it. */
async function seedAdminFromEnv() {
  const email = normalizeEmail(process.env.ADMIN_EMAIL ?? "");
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`  Admin ${email} already exists.`);
    return;
  }

  // Refuse to create the first admin with the example password or one that breaks
  // the app's own rule, so a copied example can't ship a publicly known admin
  // login. The boot carries on (no crash loop); the admin can be created in the
  // browser instead.
  const problem = PLACEHOLDER_PASSWORDS.has(password) ? "it is the example placeholder from .env.example" : passwordProblem(password);
  if (problem) {
    console.error(
      `\n  ✗ ADMIN_PASSWORD can't be used (${problem}), so no admin was created from .env.\n` +
        `    Create the admin account in the browser instead, or set ADMIN_PASSWORD to your\n` +
        `    own password (at least 12 characters) and run: docker compose up -d\n`
    );
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

async function main() {
  await lowercaseStoredEmails();
  await seedAdminFromEnv();
  await reportDataFolder();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

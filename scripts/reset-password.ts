/**
 * Reset a user's password from the server — for when you're locked out.
 *
 *   docker compose exec app node dist/scripts/reset-password.js you@example.com
 *
 * Prompts for the new password twice (input hidden). For non-interactive use,
 * pipe it on stdin instead (note `-T`):
 *
 *   printf '%s\n' "$NEWPW" | docker compose exec -T app node dist/scripts/reset-password.js you@example.com
 *
 * Signs the user out on every device. Run with no email to list accounts.
 */
import readline from "readline";
import { PrismaClient } from "@prisma/client";
import { hashPassword, passwordProblem } from "../src/lib/password";

const prisma = new PrismaClient();

/** Prompt on the terminal without echoing what's typed. */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const rlOut = rl as unknown as { _writeToOutput: (s: string) => void };
    rlOut._writeToOutput = (s: string) => {
      if (s.includes(prompt)) process.stdout.write(prompt);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function readStdinLine(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.split(/\r?\n/)[0];
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    const users = await prisma.user.findMany({ select: { email: true, isAdmin: true }, orderBy: { createdAt: "asc" } });
    console.log("Usage: node dist/scripts/reset-password.js <email>\n\nAccounts:");
    for (const u of users) console.log(`  ${u.email}${u.isAdmin ? " (admin)" : ""}`);
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (!user) {
    console.error(`No account with email ${email}. Run without an email to list accounts.`);
    process.exitCode = 1;
    return;
  }

  let pw: string;
  if (process.stdin.isTTY) {
    pw = await askHidden("New password: ");
    if ((await askHidden("Repeat new password: ")) !== pw) {
      console.error("Passwords don't match — nothing changed.");
      process.exitCode = 1;
      return;
    }
  } else {
    pw = await readStdinLine();
  }
  const problem = passwordProblem(pw);
  if (problem) {
    console.error(`${problem} — nothing changed.`);
    process.exitCode = 1;
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(pw), sessionVersion: { increment: 1 } }
  });
  console.log(`Password reset for ${user.email}. All of its sessions have been signed out.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

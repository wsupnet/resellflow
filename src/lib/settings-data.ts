import { prisma } from "./db";

/** The user's settings row, created with defaults on first use. */
export async function loadSettings(userId: string) {
  return (await prisma.settings.findUnique({ where: { userId } })) ?? (await prisma.settings.create({ data: { userId } }));
}

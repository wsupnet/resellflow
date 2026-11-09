import { prisma } from "./db";
import { DEFAULT_TZ, isValidTz } from "./tz";

/** The user's saved timezone, or UTC until one is set (auto-detected on first visit). */
export async function getUserTz(userId: string): Promise<string> {
  const s = await prisma.settings.findUnique({ where: { userId }, select: { timezone: true } });
  return isValidTz(s?.timezone) ? s!.timezone! : DEFAULT_TZ;
}

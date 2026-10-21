import { readFile } from "fs/promises";
import path from "path";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

/** Streams an item photo, after verifying it belongs to the signed-in user. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const photo = await prisma.photo.findFirst({ where: { id: params.id, userId: user.id } });
  if (!photo) return new Response("not found", { status: 404 });

  const thumb = new URL(req.url).searchParams.get("size") === "thumb";
  const file = path.join(UPLOAD_DIR, `${photo.id}${thumb ? ".thumb" : ""}.jpg`);
  const buf = await readFile(file).catch(() => null);
  if (!buf) return new Response("not found", { status: 404 });

  return new Response(buf, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=3600"
    }
  });
}

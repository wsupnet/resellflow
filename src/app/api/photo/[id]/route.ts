import { readFile } from "fs/promises";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isPhotoId, photoPath } from "@/lib/uploads";

/** Streams an item photo, after verifying it belongs to the signed-in user. */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getSessionUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  if (!isPhotoId(params.id)) return new Response("not found", { status: 404 });

  const photo = await prisma.photo.findFirst({ where: { id: params.id, userId: user.id } });
  if (!photo) return new Response("not found", { status: 404 });

  const thumb = new URL(req.url).searchParams.get("size") === "thumb";
  const file = photoPath(photo.id, thumb);
  const buf = file ? await readFile(file).catch(() => null) : null;
  if (!buf) return new Response("not found", { status: 404 });

  return new Response(buf, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

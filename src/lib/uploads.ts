import path from "path";

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads"));

// Photo ids are Prisma cuids (lowercase letters + digits). Anything else — e.g. an
// id smuggled in through a crafted backup like "../../etc/x" — is rejected so it
// can never be turned into a path outside the uploads folder.
const PHOTO_ID = /^[a-z0-9]{20,40}$/;

export function isPhotoId(id: unknown): id is string {
  return typeof id === "string" && PHOTO_ID.test(id);
}

/** Absolute path of a photo's file (or its thumbnail), or null for an invalid id. */
export function photoPath(id: string, thumb = false): string | null {
  if (!isPhotoId(id)) return null;
  const p = path.resolve(UPLOAD_DIR, `${id}${thumb ? ".thumb" : ""}.jpg`);
  // Belt and braces: the resolved path must still sit directly in UPLOAD_DIR.
  return path.dirname(p) === UPLOAD_DIR ? p : null;
}

/** Parse a backup zip entry name like "<id>.jpg" / "<id>.thumb.jpg". */
export function parsePhotoFileName(name: string): { id: string; thumb: boolean } | null {
  const m = /^([a-z0-9]{20,40})(\.thumb)?\.jpg$/.exec(name);
  return m ? { id: m[1], thumb: !!m[2] } : null;
}

// Largest image we'll decode: 110 megapixels covers phone cameras up to 108MP
// (bigger shots exceed the 30MB upload limit anyway) but stops a tiny crafted
// file that claims huge dimensions from making sharp allocate gigabytes. sharp's
// own default is ~268MP.
const MAX_INPUT_PIXELS = 110_000_000;

/** Re-encode an uploaded/restored image as the stored JPEG (full size or thumbnail).
 *  Throws on anything that isn't a readable image within the size limit. */
export async function encodePhoto(input: Buffer, thumb: boolean): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const size = thumb ? 400 : 1600;
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(size, size, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: thumb ? 75 : 82 })
    .toBuffer();
}

/** Largest side of any photo this app stores (see encodePhoto). */
const STORED_MAX_SIDE = 1600;

/**
 * For backup restore: is this file a photo exactly as this app stores them — a
 * JPEG no bigger than 1600px a side? Checked from the image header only, so it
 * costs next to nothing; nothing is decoded. Restore writes such files back as-is
 * and skips everything else, which keeps a crafted zip from making the server
 * decode thousands of large images (anything this app exported always passes).
 */
export async function isStoredPhoto(input: Buffer): Promise<boolean> {
  const { default: sharp } = await import("sharp");
  try {
    const m = await sharp(input, { limitInputPixels: STORED_MAX_SIDE * STORED_MAX_SIDE }).metadata();
    return m.format === "jpeg" && !!m.width && !!m.height && m.width <= STORED_MAX_SIDE && m.height <= STORED_MAX_SIDE;
  } catch {
    return false;
  }
}

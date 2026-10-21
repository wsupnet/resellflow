import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { editDistance } from "@/lib/normalize";

/**
 * Find an existing product whose barcode is 1 edit off the scanned code — almost
 * always a mis-scan (a digit misread/transposed), so we can offer "did you mean".
 */
async function nearBarcode(userId: string, code: string) {
  if (code.length < 6) return null; // too short to judge proximity meaningfully
  const withSku = await prisma.product.findMany({
    where: { userId, sku: { not: null } },
    select: { id: true, name: true, sku: true, category: true, _count: { select: { items: true } } }
  });
  let best: { productId: string; name: string; sku: string; category: string | null; count: number } | null = null;
  for (const p of withSku) {
    if (!p.sku || p.sku === code) continue;
    if (editDistance(p.sku, code, 1) === 1) {
      best = { productId: p.id, name: p.name, sku: p.sku, category: p.category, count: p._count.items };
      break;
    }
  }
  return best;
}

/**
 * Barcode → name lookup used to pre-fill the item name after a scan.
 *
 * Sources are tried in order, returning the first hit:
 *  1. YOUR catalog — a product you've already tagged with this code. Free,
 *     private, instant, and gets smarter the more you scan. Always on.
 *  2. OpenLibrary — books/manga by ISBN (codes starting 978/979).
 *  3. MusicBrainz — music CDs/vinyl by barcode.
 *  4. UPCitemdb — generic retail products.
 * Sources 2–4 are external and only run when "UPC lookup" is enabled in Settings.
 * (There is no reliable free barcode API for loose game cartridges; those lean on
 * source 1 once you've named them once.)
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const code = new URL(req.url).searchParams.get("code")?.trim();
  if (!code) return NextResponse.json({ title: null });

  // 1) Your own catalog — always available, no external call. Returns the master
  // name + category so a re-scan inherits them (condition/cost stay per-item).
  const owned = await prisma.product.findFirst({ where: { userId: user.id, sku: code } });
  if (owned) {
    const count = await prisma.item.count({ where: { userId: user.id, productId: owned.id } });
    return NextResponse.json({ title: owned.name, source: "your catalog", category: owned.category, owned: true, count });
  }

  // No exact match — flag a barcode that's one digit off (likely a mis-scan).
  const near = await nearBarcode(user.id, code);

  const settings = await prisma.settings.findUnique({ where: { userId: user.id } });
  if (!settings?.upcLookup) return NextResponse.json({ title: null, enabled: false, near });

  // 2) Books / manga by ISBN.
  if (/^(978|979)\d{10}$/.test(code)) {
    const t = await openLibrary(code);
    if (t) return NextResponse.json({ title: t, source: "OpenLibrary", near });
  }
  // 3) Music CDs by barcode.
  const mb = await musicBrainz(code);
  if (mb) return NextResponse.json({ title: mb, source: "MusicBrainz", near });
  // 4) Generic retail.
  const upc = await upcItemDb(code);
  if (upc) return NextResponse.json({ title: upc, source: "UPCitemdb", near });

  return NextResponse.json({ title: null, enabled: true, near });
}

async function openLibrary(isbn: string): Promise<string | null> {
  try {
    const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, {
      next: { revalidate: 86400 }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.[`ISBN:${isbn}`]?.title ?? null;
  } catch {
    return null;
  }
}

async function musicBrainz(barcode: string): Promise<string | null> {
  try {
    const res = await fetch(`https://musicbrainz.org/ws/2/release?query=barcode:${encodeURIComponent(barcode)}&fmt=json`, {
      headers: { "User-Agent": "ResellFlow/1.0 (self-hosted reseller app)" },
      next: { revalidate: 86400 }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rel = data?.releases?.[0];
    if (!rel) return null;
    const artist = rel["artist-credit"]?.[0]?.name;
    return artist ? `${artist} – ${rel.title}` : rel.title ?? null;
  } catch {
    return null;
  }
}

async function upcItemDb(code: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86400 }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.items?.[0]?.title ?? null;
  } catch {
    return null;
  }
}

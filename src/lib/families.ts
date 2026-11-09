// Product families: different products (different barcodes) that are the same
// thing on the surface — US vs Japan release, colour variants. Profits stay per
// product; a family only links them for side-by-side and combined views.

import { prisma } from "./db";
import { normalizeKey } from "./normalize";
import { getFinancials, type FinancialsBundle } from "./queries";

// Words that name the version rather than the thing, stripped to find family
// matches: "New 3DS LL - Blue" and "NEW 3DS LL - Burgundy" → "new 3ds ll".
const REGION_WORDS = [
  "us", "usa", "na", "ntsc", "ntscj", "ntscu", "pal", "jp", "jpn", "japan", "japanese", "eu", "europe", "european",
  "uk", "mexico", "mexican", "mx", "canada", "asia", "asian", "korea", "korean", "kr", "hk", "china", "chinese",
  "import", "imported", "release", "version", "ver", "region", "english", "domestic", "intl", "international"
];
const COLOUR_WORDS = [
  "black", "white", "red", "blue", "navy", "green", "yellow", "orange", "purple", "violet", "pink", "burgundy", "gold",
  "silver", "grey", "gray", "metallic", "pearl", "turquoise", "teal", "lime", "coral", "clear", "transparent", "cobalt",
  "crimson", "indigo", "brown", "beige", "cream", "rose", "mint", "aqua", "color", "colour"
];
const VARIANT = new Set([...REGION_WORDS, ...COLOUR_WORDS]);

/** The product name with version words removed, for grouping family suggestions. */
export function familyKey(name: string): string {
  return normalizeKey(name)
    .split(" ")
    .filter((t) => t && !VARIANT.has(t))
    .join(" ");
}

/** A readable family name from a member's name: version words and empty brackets dropped. */
export function familyNameFrom(name: string): string {
  const words = new RegExp(`\\b(${[...VARIANT].map((w) => w.replace(/\s+/g, "\\s+")).join("|")})\\b`, "gi");
  return (
    name
      .replace(words, " ")
      .replace(/[([{]\s*[)\]}]/g, " ") // brackets left empty
      .replace(/\s+[-–—/|,]+\s*$/g, "") // dangling separator at the end
      .replace(/\s{2,}/g, " ")
      .trim() || name
  );
}

export interface ProductRollup {
  productId: string;
  name: string;
  label: string | null;
  sku: string | null;
  units: number;
  inStock: number;
  listed: number;
  sold: number;
  saleSum: number;
  totalNet: number;
  roiSum: number;
  roiN: number;
  daysSum: number;
  daysN: number;
  thumbId: string | null;
}

/** Per-product totals (all conditions), from an already-loaded financials bundle. */
export function productRollups(bundle: FinancialsBundle, productIds?: Set<string>): Map<string, ProductRollup> {
  const soldAt = new Map<string, number>();
  for (const s of bundle.sales) for (const l of s.lines) soldAt.set(l.itemId, +new Date(s.soldAt));
  const out = new Map<string, ProductRollup>();
  for (const p of bundle.purchases)
    for (const i of p.items) {
      if (!i.product || (productIds && !productIds.has(i.product.id))) continue;
      const r =
        out.get(i.product.id) ??
        {
          productId: i.product.id,
          name: i.product.name,
          label: i.product.familyLabel,
          sku: i.product.sku,
          units: 0, inStock: 0, listed: 0, sold: 0, saleSum: 0, totalNet: 0, roiSum: 0, roiN: 0, daysSum: 0, daysN: 0,
          thumbId: null
        };
      if (!r.thumbId && i.photos[0]) r.thumbId = i.photos[0].id;
      r.units++;
      const f = bundle.itemFin.get(i.id);
      if (f?.sold) {
        r.sold++;
        r.saleSum += f.gross;
        r.totalNet += f.net;
        if (f.roi != null) { r.roiSum += f.roi; r.roiN++; }
        const sd = soldAt.get(i.id);
        if (sd && !p.purchasedAtApprox) { r.daysSum += Math.max(0, Math.round((sd - +new Date(p.purchasedAt)) / 86400000)); r.daysN++; }
      } else if (i.status === "UNLISTED" || i.status === "LISTED") {
        r.inStock++;
        if (i.status === "LISTED") r.listed++;
      }
      out.set(i.product.id, r);
    }
  return out;
}

/** Sum several product rollups into one (the family total). */
export function sumRollups(rows: ProductRollup[]) {
  const s = (f: (r: ProductRollup) => number) => rows.reduce((a, r) => a + f(r), 0);
  const sold = s((r) => r.sold);
  const roiN = s((r) => r.roiN);
  const daysN = s((r) => r.daysN);
  return {
    units: s((r) => r.units),
    inStock: s((r) => r.inStock),
    listed: s((r) => r.listed),
    sold,
    avgSale: sold ? s((r) => r.saleSum) / sold : null,
    totalNet: s((r) => r.totalNet),
    avgRoi: roiN ? s((r) => r.roiSum) / roiN : null,
    avgDays: daysN ? s((r) => r.daysSum) / daysN : null
  };
}

/** A family member's display name: its label if set, else the product name. */
export const memberLabel = (r: { name: string; label: string | null }) => r.label || r.name;

/** All families with their members' rollups and the combined totals. */
export async function listFamilies(userId: string, bundle?: FinancialsBundle) {
  const [families, b] = await Promise.all([
    prisma.family.findMany({
      where: { userId },
      include: { products: { select: { id: true, name: true, familyLabel: true, sku: true } } },
      orderBy: { name: "asc" }
    }),
    bundle ? Promise.resolve(bundle) : getFinancials(userId)
  ]);
  const roll = productRollups(b);
  return families.map((f) => {
    const members = f.products
      .map(
        (p) =>
          roll.get(p.id) ?? {
            productId: p.id, name: p.name, label: p.familyLabel, sku: p.sku,
            units: 0, inStock: 0, listed: 0, sold: 0, saleSum: 0, totalNet: 0, roiSum: 0, roiN: 0, daysSum: 0, daysN: 0, thumbId: null
          }
      )
      .sort((a, z) => memberLabel(a).localeCompare(memberLabel(z)));
    return { id: f.id, name: f.name, members, total: sumRollups(members) };
  });
}

export type FamilySuggestion =
  | { kind: "new"; name: string; products: { id: string; name: string }[] }
  | { kind: "join"; familyId: string; familyName: string; products: { id: string; name: string }[] };

/**
 * Suggested families, from products whose names match once version words are
 * removed. Pairs the user dismissed ("Not a family") are left out. A match that
 * includes one existing family's member becomes "add to that family".
 */
export async function familySuggestions(userId: string): Promise<FamilySuggestion[]> {
  const products = await prisma.product.findMany({
    where: { userId, items: { some: {} } },
    select: { id: true, name: true, familyId: true, notFamilyWith: true, family: { select: { id: true, name: true } } }
  });
  const groups = new Map<string, typeof products>();
  for (const p of products) {
    const k = familyKey(p.name);
    // One-word keys ("3ds", "zelda") are too loose to suggest on.
    if (k.split(" ").length < 2) continue;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const out: FamilySuggestion[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const dismissed = (a: (typeof g)[number], b: (typeof g)[number]) => a.notFamilyWith.includes(b.id) || b.notFamilyWith.includes(a.id);
    const famIds = [...new Set(g.map((p) => p.familyId).filter((x): x is string => !!x))];
    const loose = g.filter((p) => !p.familyId);
    if (loose.length === 0 || famIds.length > 1) continue;
    if (famIds.length === 1) {
      const fam = g.find((p) => p.familyId)!.family!;
      const famMembers = g.filter((p) => p.familyId === fam.id);
      // A loose product joins unless it was dismissed against every matching member.
      const add = loose.filter((p) => famMembers.some((m) => !dismissed(p, m)));
      if (add.length) out.push({ kind: "join", familyId: fam.id, familyName: fam.name, products: add.map((p) => ({ id: p.id, name: p.name })) });
    } else {
      const keep = loose.filter((p) => loose.some((q) => q.id !== p.id && !dismissed(p, q)));
      if (keep.length >= 2) {
        const sorted = [...keep].sort((a, b) => a.name.length - b.name.length);
        out.push({ kind: "new", name: familyNameFrom(sorted[0].name), products: keep.map((p) => ({ id: p.id, name: p.name })) });
      }
    }
  }
  return out.sort((a, b) => b.products.length - a.products.length);
}

/** Products not yet in a family whose names look like this product's (for the product-page hint). */
export async function familyHintFor(userId: string, productId: string) {
  const sugg = await familySuggestions(userId);
  return sugg.find((s) => s.products.some((p) => p.id === productId)) ?? null;
}

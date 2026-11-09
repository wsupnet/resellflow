"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { mkdir, writeFile, unlink } from "fs/promises";
import { prisma } from "./db";
import { requireUser, createSession, destroySession, hashPassword, verifyPassword } from "./auth";
import { passwordProblem } from "./password";
import { normalizeKey, similarity } from "./normalize";
import { setFlash } from "./flash";
import { likeLiteral, normalizeEmail } from "./email";
import { rebalanceBundles } from "./bundles";
import { UPLOAD_DIR, encodePhoto, isPhotoId, isStoredPhoto, photoPath, parsePhotoFileName } from "./uploads";
import { parseEntryDate, todayDay, isValidTz } from "./tz";
import { getUserTz } from "./usertz";
import { getFxRate } from "./fx";

/** A typed date as a calendar day; blank or unreadable → today in the user's timezone. */
async function entryDay(userId: string, raw: FormDataEntryValue | null): Promise<Date> {
  const tz = await getUserTz(userId);
  return parseEntryDate(str(raw), tz) ?? todayDay(tz);
}

/** A typed date for an edit: blank or unreadable keeps the existing value. */
function editDay(raw: FormDataEntryValue | null, existing: Date): Date {
  return (str(raw) && parseEntryDate(str(raw), "UTC")) || existing;
}

export async function clearFlash() {
  (await cookies()).delete("flash");
}

// ─────────────── helpers ───────────────

function num(v: FormDataEntryValue | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[, $¥]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function str(v: FormDataEntryValue | null): string {
  return (v == null ? "" : String(v)).trim();
}

// Auto-link threshold: names this similar (or an exact normalized match) link to
// the existing product automatically. Looser matches are surfaced for review.
const STRONG_MATCH = 0.85;

/**
 * Find or create the Product for an item title. Links to an existing product on
 * an exact normalized-name match OR a strong fuzzy match (inheriting its SKU,
 * category, etc.), so re-adding the same item keeps one product + its history.
 */
async function ensureProduct(userId: string, title: string, category?: string | null) {
  const key = normalizeKey(title) || title.toLowerCase();

  const exact = await prisma.product.findUnique({
    where: { userId_normalizedKey: { userId, normalizedKey: key } }
  });
  if (exact) {
    if (category && !exact.category) await prisma.product.update({ where: { id: exact.id }, data: { category } });
    return exact;
  }

  // Strong fuzzy match → reuse that product.
  const all = await prisma.product.findMany({ where: { userId } });
  let best: (typeof all)[number] | null = null;
  let bestScore = 0;
  for (const p of all) {
    const s = similarity(title, p.name);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  if (best && bestScore >= STRONG_MATCH) {
    if (category && !best.category) await prisma.product.update({ where: { id: best.id }, data: { category } });
    return best;
  }

  return prisma.product.create({
    data: { userId, name: title, normalizedKey: key, category: category ?? null }
  });
}

/**
 * Resolve a typed/picked location name to a Location id, creating it if new
 * (case-insensitive match so "Book Off Downtown" isn't duplicated by casing).
 * Empty → null. This is what makes the location picklist "add & reuse".
 */
async function resolveLocation(userId: string, raw: string): Promise<string | null> {
  const name = raw.trim();
  if (!name) return null;
  const existing = await prisma.location.findFirst({ where: { userId, name: { equals: likeLiteral(name), mode: "insensitive" } } });
  if (existing) return existing.id;
  const created = await prisma.location.create({ data: { userId, name } });
  return created.id;
}

function revalidateAll() {
  for (const p of ["/", "/inventory", "/lots", "/sales", "/insights", "/settings"]) {
    revalidatePath(p);
  }
}

// ─────────────── purchases & items ───────────────

/** Create a single-item purchase (one buy = one sellable item). */
export async function createSinglePurchase(fd: FormData) {
  const user = await requireUser();
  const title = str(fd.get("title"));
  if (!title) throw new Error("Title is required");

  const isPersonal = fd.get("isPersonal") != null;
  const product = await ensureProduct(user.id, title, str(fd.get("category")) || null);
  const locationId = isPersonal ? null : await resolveLocation(user.id, str(fd.get("location")));
  const purchase = await prisma.purchase.create({
    data: {
      userId: user.id,
      kind: "SINGLE",
      title,
      source: isPersonal ? "Personal Belongings" : str(fd.get("source")) || "Other",
      locationId,
      isPersonal,
      purchasedAt: await entryDay(user.id, fd.get("purchasedAt")),
      purchasedAtApprox: fd.get("purchasedAtApprox") != null,
      costUsd: isPersonal ? 0 : num(fd.get("costUsd")) ?? 0,
      costJpy: isPersonal ? null : num(fd.get("costJpy")),
      taxUsd: isPersonal ? 0 : num(fd.get("taxUsd")) ?? 0,
      taxJpy: isPersonal ? null : num(fd.get("taxJpy")),
      fxRate: isPersonal ? null : num(fd.get("fxRate")),
      notes: str(fd.get("notes")) || null,
      items: {
        create: {
          userId: user.id,
          title,
          productId: product.id,
          estimatedValue: num(fd.get("estimatedValue")),
          condition: str(fd.get("condition")) || null,
          status: "UNLISTED"
        }
      }
    },
    include: { items: true }
  });

  const sku = str(fd.get("sku"));
  if (sku) await applyItemSku(user.id, { id: purchase.items[0].id, productId: product.id, title }, sku);
  await setFlash(`Added “${title}”`);
  revalidateAll();
}

/**
 * Create a lot purchase. Item titles come in as newline-separated text; the lot
 * cost is allocated across them automatically (proportional to sale price later).
 */
export async function createLotPurchase(fd: FormData) {
  const user = await requireUser();
  const isPersonal = fd.get("isPersonal") != null;
  const source = isPersonal ? "Personal Belongings" : str(fd.get("source")) || "Other";
  const purchasedAt = await entryDay(user.id, fd.get("purchasedAt"));

  // Auto-name the lot when left blank: "<source> lot · <date> #N", still editable.
  let title = str(fd.get("title"));
  if (!title) {
    const dateStr = purchasedAt.toISOString().slice(0, 10);
    const sameDay = await prisma.purchase.count({
      where: { userId: user.id, kind: "LOT", source, purchasedAt: { gte: new Date(dateStr), lt: new Date(new Date(dateStr).getTime() + 86400000) } }
    });
    title = `${source} lot · ${dateStr}${sameDay > 0 ? ` #${sameDay + 1}` : ""}`;
  }

  const rawItems = str(fd.get("items"))
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const locationId = isPersonal ? null : await resolveLocation(user.id, str(fd.get("location")));
  const purchase = await prisma.purchase.create({
    data: {
      userId: user.id,
      kind: "LOT",
      title,
      source,
      locationId,
      isPersonal,
      purchasedAt,
      purchasedAtApprox: fd.get("purchasedAtApprox") != null,
      costUsd: isPersonal ? 0 : num(fd.get("costUsd")) ?? 0,
      costJpy: isPersonal ? null : num(fd.get("costJpy")),
      taxUsd: isPersonal ? 0 : num(fd.get("taxUsd")) ?? 0,
      taxJpy: isPersonal ? null : num(fd.get("taxJpy")),
      fxRate: isPersonal ? null : num(fd.get("fxRate")),
      notes: str(fd.get("notes")) || null
    }
  });

  const lotCategory = str(fd.get("category")) || null;
  for (const itemTitle of rawItems) {
    const product = await ensureProduct(user.id, itemTitle, lotCategory);
    await prisma.item.create({
      data: {
        userId: user.id,
        purchaseId: purchase.id,
        productId: product.id,
        title: itemTitle,
        status: "UNLISTED"
      }
    });
  }
  await setFlash(`Created lot “${title}” with ${rawItems.length} item${rawItems.length === 1 ? "" : "s"}`);
  revalidateAll();
}

/** Add another item to an existing lot. */
export async function addItemToLot(fd: FormData) {
  const user = await requireUser();
  const purchaseId = str(fd.get("purchaseId"));
  const title = str(fd.get("title"));
  if (!purchaseId || !title) throw new Error("Missing data");

  const purchase = await prisma.purchase.findFirst({ where: { id: purchaseId, userId: user.id } });
  if (!purchase) throw new Error("Lot not found");

  const product = await ensureProduct(user.id, title);
  await prisma.item.create({
    data: {
      userId: user.id,
      purchaseId,
      productId: product.id,
      title,
      estimatedValue: num(fd.get("estimatedValue")),
      status: "UNLISTED"
    }
  });
  await setFlash(`Added “${title}” to the lot`);
  await rebalanceBundles(user.id);
  revalidateAll();
}

/**
 * Rename a product (the SKU/group master) and cascade the name to every item
 * under it, so the group always shares one name and only condition varies. The
 * normalizedKey is left as-is to avoid unique-key collisions and surprise merges;
 * SKU-based re-scans still match by code regardless of name.
 */
async function cascadeProductName(userId: string, productId: string, name: string) {
  await prisma.product.update({ where: { id: productId }, data: { name } }).catch(() => {});
  await prisma.item.updateMany({ where: { productId, userId }, data: { title: name } });
}

/** Rename the master product from the by-product view; cascades to all its items. */
export async function renameProduct(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const name = str(fd.get("name"));
  if (!name) return;
  const product = await prisma.product.findFirst({ where: { id, userId: user.id } });
  if (!product) throw new Error("Product not found");
  await cascadeProductName(user.id, id, name);
  await setFlash(`Renamed to “${name}”`);
  revalidateAll();
}

// ─────────────── guided (scan-driven) lot builder ───────────────

/** Create an empty lot to add scanned items into; returns its id + name. */
export async function createLotDraft(fd: FormData): Promise<{ id: string; title: string }> {
  const user = await requireUser();
  const isPersonal = fd.get("isPersonal") != null;
  const source = isPersonal ? "Personal Belongings" : str(fd.get("source")) || "Other";
  const purchasedAt = await entryDay(user.id, fd.get("purchasedAt"));

  let title = str(fd.get("title"));
  if (!title) {
    const dateStr = purchasedAt.toISOString().slice(0, 10);
    const sameDay = await prisma.purchase.count({
      where: { userId: user.id, kind: "LOT", source, purchasedAt: { gte: new Date(dateStr), lt: new Date(new Date(dateStr).getTime() + 86400000) } }
    });
    title = `${source} lot · ${dateStr}${sameDay > 0 ? ` #${sameDay + 1}` : ""}`;
  }

  const locationId = isPersonal ? null : await resolveLocation(user.id, str(fd.get("location")));
  const purchase = await prisma.purchase.create({
    data: {
      userId: user.id,
      kind: "LOT",
      title,
      source,
      locationId,
      isPersonal,
      purchasedAt,
      purchasedAtApprox: fd.get("purchasedAtApprox") != null,
      costUsd: isPersonal ? 0 : num(fd.get("costUsd")) ?? 0,
      costJpy: isPersonal ? null : num(fd.get("costJpy")),
      taxUsd: isPersonal ? 0 : num(fd.get("taxUsd")) ?? 0,
      taxJpy: isPersonal ? null : num(fd.get("taxJpy")),
      fxRate: isPersonal ? null : num(fd.get("fxRate")),
      notes: str(fd.get("notes")) || null
    }
  });
  revalidateAll();
  return { id: purchase.id, title: purchase.title };
}

/**
 * Add one scanned item (optionally several identical via qty, optionally a photo)
 * to a lot. The scanned SKU resolves the product first (a catalog hit reuses that
 * product + its name/category); otherwise we match/create by name and tag the SKU.
 */
export async function addLotItem(fd: FormData): Promise<{ itemId: string; count: number }> {
  const user = await requireUser();
  const lotId = str(fd.get("lotId"));
  const lot = await prisma.purchase.findFirst({ where: { id: lotId, userId: user.id } });
  if (!lot) throw new Error("Lot not found");

  const title = str(fd.get("title"));
  if (!title) throw new Error("Name is required");
  const category = str(fd.get("category")) || null;
  const sku = str(fd.get("sku"));
  const qty = Math.max(1, Math.min(99, Math.round(num(fd.get("qty")) ?? 1)));

  // Resolve the product by scanned SKU first (catalog hit), else by name.
  let product = sku ? await prisma.product.findFirst({ where: { userId: user.id, sku } }) : null;
  if (product) {
    if (category && !product.category) await prisma.product.update({ where: { id: product.id }, data: { category } });
    // Master-name model: an edited name renames the whole group.
    if (title !== product.name) await cascadeProductName(user.id, product.id, title);
  } else {
    product = await ensureProduct(user.id, title, category);
    if (sku) {
      const owner = await prisma.product.findFirst({ where: { userId: user.id, sku } });
      if (!owner) await prisma.product.update({ where: { id: product.id }, data: { sku } });
    }
  }

  const condition = str(fd.get("condition")) || null;
  const estimatedValue = num(fd.get("estimatedValue"));
  const costOverrideUsd = num(fd.get("costOverrideUsd"));
  // Exact yen the per-item cost was typed in (null when typed in USD).
  const costOverrideJpy = costOverrideUsd == null ? null : num(fd.get("costOverrideJpy"));
  const notes = str(fd.get("notes")) || null;

  let firstId = "";
  for (let n = 0; n < qty; n++) {
    const item = await prisma.item.create({
      data: { userId: user.id, purchaseId: lotId, productId: product.id, title, condition, estimatedValue, costOverrideUsd, costOverrideJpy, notes, status: "UNLISTED" }
    });
    if (!firstId) firstId = item.id;
  }

  // Optional photo attaches to the first created item.
  const photo = fd.get("photo");
  if (photo instanceof File && photo.size > 0 && firstId) await storeItemPhoto(user.id, firstId, photo);

  await rebalanceBundles(user.id);
  revalidateAll();
  const count = await prisma.item.count({ where: { purchaseId: lotId } });
  return { itemId: firstId, count };
}

/** Add loose / no-barcode items to a lot from newline-separated titles. */
export async function addLooseLotItems(fd: FormData): Promise<{ added: number }> {
  const user = await requireUser();
  const lotId = str(fd.get("lotId"));
  const lot = await prisma.purchase.findFirst({ where: { id: lotId, userId: user.id } });
  if (!lot) throw new Error("Lot not found");

  const category = str(fd.get("category")) || null;
  const lines = str(fd.get("items")).split("\n").map((s) => s.trim()).filter(Boolean);
  for (const t of lines) {
    const product = await ensureProduct(user.id, t, category);
    await prisma.item.create({ data: { userId: user.id, purchaseId: lotId, productId: product.id, title: t, status: "UNLISTED" } });
  }
  await rebalanceBundles(user.id);
  revalidateAll();
  return { added: lines.length };
}

async function cleanupProductIfEmpty(productId: string | null) {
  if (!productId) return;
  const count = await prisma.item.count({ where: { productId } });
  if (count === 0) await prisma.product.delete({ where: { id: productId } }).catch(() => {});
}

/**
 * Attach (or clear) a barcode/SKU on an item. The SKU lives on the Product, so
 * tagging two items with the same code auto-merges them into one product (counts
 * combine), and tagging an item with a brand-new code splits it off from its
 * name-based group.
 */
async function applyItemSku(
  userId: string,
  item: { id: string; productId: string | null; title: string },
  sku: string
) {
  if (sku === "") {
    // Clearing a barcode is the "I mis-scanned this" move, so it must DETACH the
    // item from the barcode's product (stock count drops, ready to rescan) — not
    // strip the code off the whole product, which would orphan the barcode for
    // every other (correctly scanned) item in the group.
    if (!item.productId) return;
    const current = await prisma.product.findUnique({
      where: { id: item.productId },
      include: { _count: { select: { items: true } } }
    });
    if (!current?.sku) return; // no code to clear
    if (current._count.items <= 1) {
      // Group of one — just drop the code, the item keeps its product.
      await prisma.product.update({ where: { id: current.id }, data: { sku: null } });
    } else {
      // Split this item into its own (code-less) product; the original product
      // keeps its barcode and the rest of its stock.
      const key = `${normalizeKey(item.title) || item.title.toLowerCase()}#split-${item.id}`;
      const np = await prisma.product.create({
        data: { userId, name: item.title, normalizedKey: key, category: current.category }
      });
      await prisma.item.update({ where: { id: item.id }, data: { productId: np.id } });
    }
    return;
  }

  const existing = await prisma.product.findFirst({ where: { userId, sku } });
  if (existing) {
    if (existing.id !== item.productId) {
      // Joining an existing SKU group → inherit its master name (category is
      // already shared via the product). Condition/cost stay per-item.
      const oldId = item.productId;
      await prisma.item.update({ where: { id: item.id }, data: { productId: existing.id, title: existing.name } });
      await cleanupProductIfEmpty(oldId);
    }
    return;
  }

  // No product owns this code yet.
  const current = item.productId
    ? await prisma.product.findUnique({ where: { id: item.productId }, include: { _count: { select: { items: true } } } })
    : null;

  if (current && current._count.items <= 1) {
    await prisma.product.update({ where: { id: current.id }, data: { sku } });
  } else {
    // Split this item into its own product keyed by the SKU.
    const key = `${normalizeKey(item.title) || item.title.toLowerCase()}#${sku}`;
    const np = await prisma.product.create({ data: { userId, name: item.title, normalizedKey: key, sku } });
    const oldId = item.productId;
    await prisma.item.update({ where: { id: item.id }, data: { productId: np.id } });
    await cleanupProductIfEmpty(oldId);
  }
}

export async function updateItem(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const item = await prisma.item.findFirst({ where: { id, userId: user.id } });
  if (!item) throw new Error("Item not found");

  const title = str(fd.get("title"));
  const overrideUsd = num(fd.get("costOverrideUsd"));
  const data: Record<string, unknown> = {
    estimatedValue: num(fd.get("estimatedValue")),
    costOverrideUsd: overrideUsd,
    // Exact yen the override was typed in (empty → null, e.g. entered in USD).
    costOverrideJpy: overrideUsd == null ? null : num(fd.get("costOverrideJpy")),
    notes: str(fd.get("notes")) || null
  };
  if (title) data.title = title;
  const status = str(fd.get("status"));
  const WRITE_OFF = ["LOST", "DAMAGED"];
  if (["UNLISTED", "LISTED", "SOLD", ...WRITE_OFF].includes(status)) {
    // An item that's on a sale stays SOLD — undo the sale first, then write off.
    if (!(WRITE_OFF.includes(status) && item.status === "SOLD")) {
      data.status = status;
      // Stamp/clear the write-off date so reports recognize the loss in the right period.
      if (WRITE_OFF.includes(status)) {
        if (!WRITE_OFF.includes(item.status)) data.writtenOffAt = todayDay(await getUserTz(user.id));
      } else if (item.writtenOffAt) {
        data.writtenOffAt = null;
      }
    }
  }
  if (fd.has("condition")) data.condition = str(fd.get("condition")) || null;

  await prisma.item.update({ where: { id }, data });

  // The product (SKU group) is the master name: renaming any item renames the
  // product and cascades to all its items, so a group stays one name with only
  // condition varying — no per-item name management. See renameProduct.
  if (title && title !== item.title && item.productId) {
    await cascadeProductName(user.id, item.productId, title);
  }

  // Category lives on the product (shared by all its items).
  if (fd.has("category") && item.productId) {
    await prisma.product.update({ where: { id: item.productId }, data: { category: str(fd.get("category")) || null } });
  }

  // SKU is handled separately because it may move the item to another product.
  if (fd.has("sku")) {
    await applyItemSku(user.id, { id: item.id, productId: item.productId, title: title || item.title }, str(fd.get("sku")));
  }
  await setFlash("Item updated");
  await rebalanceBundles(user.id);
  revalidateAll();
}

/** Bulk-set condition, status, category, and/or location on many selected items. */
export async function bulkUpdateItems(fd: FormData) {
  const user = await requireUser();
  const ids = fd.getAll("itemId").map(String).filter(Boolean);
  if (ids.length === 0) return;

  const data: Record<string, unknown> = {};
  const condition = str(fd.get("condition"));
  if (condition) data.condition = condition;
  const status = str(fd.get("status"));
  const isWriteOff = status === "LOST" || status === "DAMAGED";
  if (["UNLISTED", "LISTED", "SOLD"].includes(status)) {
    data.status = status;
    data.writtenOffAt = null; // leaving a write-off state clears the date
  }

  let count = 0;
  if (Object.keys(data).length > 0) {
    const res = await prisma.item.updateMany({ where: { id: { in: ids }, userId: user.id }, data });
    count = res.count;
  }
  // Write-offs are applied separately so items on a sale stay SOLD (undo the
  // sale first if one of these was actually sold).
  if (isWriteOff) {
    const res = await prisma.item.updateMany({
      where: { id: { in: ids }, userId: user.id, status: { not: "SOLD" } },
      data: { status: status as "LOST" | "DAMAGED", writtenOffAt: todayDay(await getUserTz(user.id)) }
    });
    count = Math.max(count, res.count);
  }

  // Category lives on the product (shared by all its items), so apply it to the
  // distinct products behind the selected items.
  const category = str(fd.get("category"));
  if (category) {
    const items = await prisma.item.findMany({ where: { id: { in: ids }, userId: user.id }, select: { id: true, productId: true } });
    const productIds = [...new Set(items.map((i) => i.productId).filter((p): p is string => !!p))];
    if (productIds.length) await prisma.product.updateMany({ where: { id: { in: productIds }, userId: user.id }, data: { category } });
    if (count === 0) count = items.length;
  }

  // Location lives on the purchase (lot), so tag the distinct lots behind the
  // selected items — note this applies to the whole lot, not just the ticked items.
  const location = str(fd.get("location"));
  if (location) {
    const locationId = await resolveLocation(user.id, location);
    const its = await prisma.item.findMany({ where: { id: { in: ids }, userId: user.id }, select: { purchaseId: true } });
    const purchaseIds = [...new Set(its.map((i) => i.purchaseId))];
    if (purchaseIds.length) await prisma.purchase.updateMany({ where: { id: { in: purchaseIds }, userId: user.id }, data: { locationId } });
    if (count === 0) count = its.length;
  }

  if (count === 0) return;
  await setFlash(`Updated ${count} item${count === 1 ? "" : "s"}`);
  await rebalanceBundles(user.id);
  revalidateAll();
}

/**
 * Force-merge several products into one. All items of the losing products are
 * reassigned to the survivor (keeping their own lot / condition / cost / status),
 * then the emptied products are deleted and the survivor's details are set to the
 * user's chosen values. Net effect: the merged product's stock count sums up, but
 * no item leaves its lot. The kept barcode wins; the others are dropped.
 */
export async function mergeProducts(fd: FormData) {
  const user = await requireUser();
  const productIds = [...new Set(fd.getAll("productId").map(String).filter(Boolean))];
  const keepId = str(fd.get("keepProductId"));
  if (productIds.length < 2 || !keepId || !productIds.includes(keepId)) return;

  const products = await prisma.product.findMany({ where: { id: { in: productIds }, userId: user.id } });
  const keep = products.find((p) => p.id === keepId);
  if (!keep || products.length < 2) return;
  const others = products.filter((p) => p.id !== keepId);

  const name = str(fd.get("name")) || keep.name;
  const sku = str(fd.get("sku")) || null;
  const category = str(fd.get("category")) || null;
  const compPrice = num(fd.get("compPrice"));

  await prisma.$transaction(async (tx) => {
    // Reassign items off each losing product, then delete it (frees its unique
    // barcode before we set the survivor's, avoiding a unique-constraint clash).
    for (const o of others) {
      await tx.item.updateMany({ where: { productId: o.id, userId: user.id }, data: { productId: keep.id } });
      await tx.product.delete({ where: { id: o.id } });
    }
    await tx.product.update({ where: { id: keep.id }, data: { name, sku, category, compPrice } });
    // Master-name model: every item in the merged group takes the chosen name.
    await tx.item.updateMany({ where: { productId: keep.id, userId: user.id }, data: { title: name } });
  }, { timeout: 30000, maxWait: 10000 });

  await setFlash(`Merged ${products.length} products into “${name}”`);
  revalidateAll();
}

/** Reassign an item to an existing product (used by the fuzzy "link" suggestion). */
export async function linkItemToProduct(fd: FormData) {
  const user = await requireUser();
  const itemId = str(fd.get("itemId"));
  const productId = str(fd.get("productId"));
  const item = await prisma.item.findFirst({ where: { id: itemId, userId: user.id } });
  const product = await prisma.product.findFirst({ where: { id: productId, userId: user.id } });
  if (!item || !product) throw new Error("Not found");
  const oldId = item.productId;
  await prisma.item.update({ where: { id: itemId }, data: { productId } });
  if (oldId && oldId !== productId) await cleanupProductIfEmpty(oldId);
  await setFlash(`Linked to “${product.name}”`);
  revalidateAll();
}

/** "Not the same": silence the lot page's name-match suggestion for this pair of products. */
export async function dismissProductMatch(fd: FormData) {
  const user = await requireUser();
  // Own field names: this button shares a form with the link action's productId.
  const productId = str(fd.get("pairA"));
  const otherId = str(fd.get("pairB"));
  const pair = await prisma.product.findMany({ where: { id: { in: [productId, otherId] }, userId: user.id } });
  if (pair.length !== 2) throw new Error("Not found");
  for (const p of pair) {
    const other = p.id === productId ? otherId : productId;
    if (!p.notSameAs.includes(other)) await prisma.product.update({ where: { id: p.id }, data: { notSameAs: { push: other } } });
  }
  await setFlash("Got it — won't suggest that match again");
  revalidateAll();
}

export async function deleteItem(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  await prisma.item.deleteMany({ where: { id, userId: user.id } });
  await setFlash("Item deleted");
  await rebalanceBundles(user.id);
  revalidateAll();
}

/**
 * Edit a lot/purchase's details after creation: name, source, location, date,
 * cost (USD/JPY + tax), and notes. Location lives on the purchase, so setting it
 * here applies to every item in the lot (and follows them into the By-location
 * report). Blank cost fields become 0; a blank location clears the tag.
 */
export async function updateLot(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const lot = await prisma.purchase.findFirst({ where: { id, userId: user.id } });
  if (!lot) throw new Error("Lot not found");

  const data: Record<string, unknown> = {};
  const title = str(fd.get("title"));
  if (title) data.title = title;
  const source = str(fd.get("source"));
  if (source) data.source = source;
  if (str(fd.get("purchasedAt"))) data.purchasedAt = editDay(fd.get("purchasedAt"), lot.purchasedAt);
  data.purchasedAtApprox = fd.get("purchasedAtApprox") != null;
  if (fd.has("costUsd")) data.costUsd = num(fd.get("costUsd")) ?? 0;
  if (fd.has("costJpy")) data.costJpy = num(fd.get("costJpy"));
  // Yen-only entry: derive USD from the yen at the purchase's locked rate
  // (USD per JPY), else today's rate.
  if (fd.has("costFromJpy") && fd.has("costJpy")) {
    const yen = num(fd.get("costJpy"));
    const usdPerJpy = lot.fxRate ?? 1 / (await getFxRate(user.id)).rate;
    data.costUsd = yen == null ? 0 : Math.round(yen * usdPerJpy * 100) / 100;
    if (yen != null && lot.fxRate == null) data.fxRate = usdPerJpy;
  }
  if (fd.has("taxUsd")) data.taxUsd = num(fd.get("taxUsd")) ?? 0;
  if (fd.has("taxJpy")) data.taxJpy = num(fd.get("taxJpy"));
  if (fd.has("notes")) data.notes = str(fd.get("notes")) || null;
  if (fd.has("location")) data.locationId = await resolveLocation(user.id, str(fd.get("location")));

  await prisma.purchase.update({ where: { id }, data });
  await setFlash(lot.kind === "LOT" ? "Lot updated" : "Purchase updated");
  await rebalanceBundles(user.id);
  revalidateAll();
}

export async function deletePurchase(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  await prisma.purchase.deleteMany({ where: { id, userId: user.id } });
  await setFlash("Purchase deleted");
  await rebalanceBundles(user.id);
  revalidateAll();
  // The lot detail page would 404 after its record is gone, so send the user back.
  redirect("/lots");
}

// ─────────────── sales ───────────────

/**
 * Record a sale. Accepts one or more item IDs (cross-lot bundles allowed) with a
 * sale price each. Fees are passed explicitly (the form pre-fills them from the
 * user's fee settings) and frozen onto the sale.
 */
export async function recordSale(fd: FormData) {
  const user = await requireUser();

  const itemIds = fd.getAll("itemId").map(String).filter(Boolean);
  if (itemIds.length === 0) throw new Error("Select at least one item");

  // Validate ownership and gather prices. When the sale was entered in yen, the
  // exact typed yen amount rides along (salePrice is its USD conversion).
  const ownedCount = await prisma.item.count({ where: { id: { in: itemIds }, userId: user.id } });
  if (ownedCount !== new Set(itemIds).size) throw new Error("Item not found");
  // "One total" mode: the buyer paid a single price for several items. Lines you
  // didn't type a price for are flagged `allocated`; their prices are re-derived
  // from the total by cost share (rebalanceBundles below), not trusted as typed.
  const bundleTotal = itemIds.length > 1 ? num(fd.get("bundleTotal")) : null;
  const isBundle = bundleTotal != null && bundleTotal > 0;
  const lines = itemIds.map((itemId) => ({
    itemId,
    salePrice: num(fd.get(`price_${itemId}`)) ?? 0,
    priceJpy: num(fd.get(`priceJpy_${itemId}`)),
    allocated: isBundle && fd.get(`locked_${itemId}`) == null
  }));

  const platformRaw = str(fd.get("platform")).toUpperCase();
  const platform = ["EBAY", "MERCARI", "FACEBOOK", "OTHER"].includes(platformRaw)
    ? (platformRaw as "EBAY" | "MERCARI" | "FACEBOOK" | "OTHER")
    : "OTHER";

  // Batch (not interactive) transaction: both writes go to the DB together, so
  // there's no 5s interactive-transaction clock that a slow disk (e.g. the NAS
  // waking its drives) can blow through. Still all-or-nothing.
  await prisma.$transaction([
    prisma.sale.create({
      data: {
        userId: user.id,
        platform,
        soldAt: await entryDay(user.id, fd.get("soldAt")),
        fxRate: num(fd.get("fxRate")),
        shippingFee: num(fd.get("shippingFee")) ?? 0,
        ebayFee: num(fd.get("ebayFee")) ?? 0,
        mercariFee: num(fd.get("mercariFee")) ?? 0,
        adFee: num(fd.get("adFee")) ?? 0,
        // Exact entered-yen figures (null when the sale was entered in USD).
        shippingFeeJpy: num(fd.get("shippingFeeJpy")),
        ebayFeeJpy: num(fd.get("ebayFeeJpy")),
        mercariFeeJpy: num(fd.get("mercariFeeJpy")),
        adFeeJpy: num(fd.get("adFeeJpy")),
        bundleTotal: isBundle ? bundleTotal : null,
        bundleTotalJpy: isBundle ? num(fd.get("bundleTotalJpy")) : null,
        // Entered as a bundle (or priced one by one) on purpose — nothing to review.
        bundleReviewed: true,
        notes: str(fd.get("notes")) || null,
        lines: { create: lines }
      }
    }),
    prisma.item.updateMany({
      where: { id: { in: itemIds }, userId: user.id },
      data: { status: "SOLD" }
    })
  ]);
  await rebalanceBundles(user.id);
  await setFlash(`Sale recorded · ${itemIds.length} item${itemIds.length === 1 ? "" : "s"}`);
  revalidateAll();
}

/**
 * Edit an already-recorded sale after the fact — e.g. attaching shipping you
 * learned later, fixing a fee, the platform/date, or a line's sale price. Blank
 * fee fields keep the current value; any changed fee/price is frozen onto the
 * sale (fees are always USD). Item↔sale links are unchanged.
 */
export async function updateSale(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const sale = await prisma.sale.findFirst({ where: { id, userId: user.id }, include: { lines: true } });
  if (!sale) throw new Error("Sale not found");

  const platformRaw = str(fd.get("platform")).toUpperCase();
  const platform = ["EBAY", "MERCARI", "FACEBOOK", "OTHER"].includes(platformRaw)
    ? (platformRaw as "EBAY" | "MERCARI" | "FACEBOOK" | "OTHER")
    : sale.platform;

  // The edit form works in USD, so any CHANGED amount invalidates its stored
  // entered-yen record (it no longer reflects what was typed at recording time).
  // Unchanged amounts keep their exact yen.
  const shippingFee = num(fd.get("shippingFee")) ?? 0;
  const ebayFee = num(fd.get("ebayFee")) ?? 0;
  const mercariFee = num(fd.get("mercariFee")) ?? 0;
  const adFee = num(fd.get("adFee")) ?? 0;
  await prisma.sale.update({
    where: { id },
    data: {
      platform,
      soldAt: editDay(fd.get("soldAt"), sale.soldAt),
      // Fee fields are pre-filled with current values, so a cleared field means 0.
      shippingFee,
      ebayFee,
      mercariFee,
      adFee,
      ...(shippingFee !== sale.shippingFee ? { shippingFeeJpy: null } : {}),
      ...(ebayFee !== sale.ebayFee ? { ebayFeeJpy: null } : {}),
      ...(mercariFee !== sale.mercariFee ? { mercariFeeJpy: null } : {}),
      ...(adFee !== sale.adFee ? { adFeeJpy: null } : {}),
      notes: str(fd.get("notes")) || null
    }
  });

  // Bundle sale: the total is editable, and "re-split" hands every line back to
  // the cost-share split (undoing any prices typed over it).
  const resplit = sale.bundleTotal != null && fd.get("resplit") != null;
  if (sale.bundleTotal != null) {
    const bt = num(fd.get("bundleTotal"));
    if (bt != null && bt > 0 && Math.abs(bt - sale.bundleTotal) >= 0.005) {
      await prisma.sale.update({ where: { id }, data: { bundleTotal: bt, bundleTotalJpy: null } });
    }
    if (resplit) await prisma.saleItem.updateMany({ where: { saleId: id }, data: { allocated: true } });
  }

  // Update any line whose price field was provided (a changed price drops its
  // stored entered-yen for the same reason). On a bundle, typing a price locks
  // that line; the rest of the total re-splits around it.
  if (!resplit) {
    for (const l of sale.lines) {
      const p = num(fd.get(`price_${l.itemId}`));
      if (p != null && Math.abs(p - l.salePrice) >= 0.005) await prisma.saleItem.update({ where: { id: l.id }, data: { salePrice: p, priceJpy: null, allocated: false } });
    }
  }

  await rebalanceBundles(user.id);
  await setFlash("Sale updated");
  revalidateAll();
}

/**
 * Turn recorded multi-item sales into bundle sales: the current line prices sum
 * to the bundle total, then every line is re-split by cost share. Used by the
 * bundle review screen (one sale or many at once) for sales recorded before
 * bundles were tracked.
 */
export async function convertToBundle(fd: FormData) {
  const user = await requireUser();
  const ids = fd.getAll("saleId").map(String).filter(Boolean);
  const sales = await prisma.sale.findMany({ where: { id: { in: ids }, userId: user.id }, include: { lines: true } });
  for (const s of sales) {
    if (s.lines.length < 2) continue;
    const total = Math.round(s.lines.reduce((a, l) => a + l.salePrice, 0) * 100) / 100;
    const allYen = s.lines.every((l) => l.priceJpy != null);
    await prisma.$transaction([
      prisma.sale.update({
        where: { id: s.id },
        data: { bundleTotal: total, bundleTotalJpy: allYen ? s.lines.reduce((a, l) => a + (l.priceJpy ?? 0), 0) : null, bundleReviewed: true }
      }),
      prisma.saleItem.updateMany({ where: { saleId: s.id }, data: { allocated: true } })
    ]);
  }
  await rebalanceBundles(user.id);
  await setFlash(`Converted ${sales.length} sale${sales.length === 1 ? "" : "s"} to bundle pricing`);
  revalidateAll();
  revalidatePath("/sales/bundles");
}

/** Mark multi-item sales as genuinely priced item by item (review screen), or
 *  turn a bundle sale back into one — current line prices are kept as typed. */
export async function markPricedIndividually(fd: FormData) {
  const user = await requireUser();
  const ids = fd.getAll("saleId").map(String).filter(Boolean);
  const owned = (await prisma.sale.findMany({ where: { id: { in: ids }, userId: user.id }, select: { id: true } })).map((s) => s.id);
  await prisma.$transaction([
    prisma.sale.updateMany({ where: { id: { in: owned } }, data: { bundleTotal: null, bundleTotalJpy: null, bundleReviewed: true } }),
    prisma.saleItem.updateMany({ where: { saleId: { in: owned } }, data: { allocated: false } })
  ]);
  await setFlash(owned.length === 1 ? "Kept as priced item by item" : `Kept ${owned.length} sales as priced item by item`);
  revalidateAll();
  revalidatePath("/sales/bundles");
}

export async function deleteSale(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const sale = await prisma.sale.findFirst({ where: { id, userId: user.id }, include: { lines: true } });
  if (!sale) return;
  const itemIds = sale.lines.map((l) => l.itemId);
  await prisma.$transaction([
    prisma.sale.delete({ where: { id } }),
    prisma.item.updateMany({ where: { id: { in: itemIds }, userId: user.id }, data: { status: "UNLISTED" } })
  ]);
  await setFlash("Sale removed · items back in stock");
  await rebalanceBundles(user.id);
  revalidateAll();
}

// ─────────────── products / comps ───────────────

export async function setProductComp(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const product = await prisma.product.findFirst({ where: { id, userId: user.id } });
  if (!product) throw new Error("Product not found");
  await prisma.product.update({
    where: { id },
    data: { compPrice: num(fd.get("compPrice")), compNotes: str(fd.get("compNotes")) || null }
  });
  await setFlash("Comp saved");
  revalidateAll();
}

// ─────────────── general ledger / expenses ───────────────

// Parse an "attach" value like "purchase:abc" / "item:abc" / "sale:abc" / "".
async function parseAttach(userId: string, raw: string) {
  const [kind, attachId] = raw.split(":");
  if (!attachId) return { purchaseId: null, itemId: null, saleId: null };
  if (kind === "purchase") {
    const ok = await prisma.purchase.findFirst({ where: { id: attachId, userId } });
    return { purchaseId: ok ? attachId : null, itemId: null, saleId: null };
  }
  if (kind === "item") {
    const ok = await prisma.item.findFirst({ where: { id: attachId, userId } });
    return { purchaseId: null, itemId: ok ? attachId : null, saleId: null };
  }
  if (kind === "sale") {
    const ok = await prisma.sale.findFirst({ where: { id: attachId, userId } });
    return { purchaseId: null, itemId: null, saleId: ok ? attachId : null };
  }
  return { purchaseId: null, itemId: null, saleId: null };
}

export async function createExpense(fd: FormData) {
  const user = await requireUser();
  const category = str(fd.get("category")) || "Other";
  const attach = await parseAttach(user.id, str(fd.get("attach")));
  await prisma.expense.create({
    data: {
      userId: user.id,
      category,
      description: str(fd.get("description")) || null,
      amountUsd: num(fd.get("amountUsd")) ?? 0,
      amountJpy: num(fd.get("amountJpy")),
      date: await entryDay(user.id, fd.get("date")),
      ...attach
    }
  });
  await setFlash("Expense added");
  revalidateAll();
  revalidatePath("/ledger");
}

export async function updateExpense(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const existing = await prisma.expense.findFirst({ where: { id, userId: user.id } });
  if (!existing) throw new Error("Expense not found");
  const attach = await parseAttach(user.id, str(fd.get("attach")));
  await prisma.expense.update({
    where: { id },
    data: {
      category: str(fd.get("category")) || existing.category,
      description: str(fd.get("description")) || null,
      amountUsd: num(fd.get("amountUsd")) ?? existing.amountUsd,
      amountJpy: num(fd.get("amountJpy")),
      date: editDay(fd.get("date"), existing.date),
      ...attach
    }
  });
  await setFlash("Expense updated");
  revalidateAll();
  revalidatePath("/ledger");
}

export async function deleteExpense(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  await prisma.expense.deleteMany({ where: { id, userId: user.id } });
  await setFlash("Expense deleted");
  revalidateAll();
  revalidatePath("/ledger");
}

// ─────────────── item photos ───────────────

/** Downscale + thumbnail a single image with sharp and write it to the uploads
 *  volume, recording one Photo row. Shared by uploadPhotos and the lot builder. */
async function storeItemPhoto(userId: string, itemId: string, f: File) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const order = await prisma.photo.count({ where: { itemId } });
  const photo = await prisma.photo.create({ data: { userId, itemId, order } });
  try {
    const buf = Buffer.from(await f.arrayBuffer());
    const full = await encodePhoto(buf, false);
    const thumb = await encodePhoto(buf, true);
    await writeFile(photoPath(photo.id)!, full);
    await writeFile(photoPath(photo.id, true)!, thumb);
    return true;
  } catch {
    await prisma.photo.delete({ where: { id: photo.id } }).catch(() => {});
    return false;
  }
}

/** Upload one or more photos for an item. Each is downscaled + thumbnailed with
 *  sharp and written to the uploads volume; only metadata goes in the DB. */
export async function uploadPhotos(fd: FormData) {
  const user = await requireUser();
  const itemId = str(fd.get("itemId"));
  const item = await prisma.item.findFirst({ where: { id: itemId, userId: user.id } });
  if (!item) throw new Error("Item not found");

  const files = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return;

  await mkdir(UPLOAD_DIR, { recursive: true });
  let order = await prisma.photo.count({ where: { itemId } });
  let added = 0;

  for (const f of files) {
    const buf = Buffer.from(await f.arrayBuffer());
    const photo = await prisma.photo.create({ data: { userId: user.id, itemId, order: order++ } });
    try {
      const full = await encodePhoto(buf, false);
      const thumb = await encodePhoto(buf, true);
      await writeFile(photoPath(photo.id)!, full);
      await writeFile(photoPath(photo.id, true)!, thumb);
      added++;
    } catch {
      await prisma.photo.delete({ where: { id: photo.id } }).catch(() => {});
    }
  }
  await setFlash(added > 0 ? `Added ${added} photo${added === 1 ? "" : "s"}` : "Couldn't read those images");
  revalidateAll();
}

export async function deletePhoto(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const photo = await prisma.photo.findFirst({ where: { id, userId: user.id } });
  if (!photo) return;
  await prisma.photo.delete({ where: { id } });
  for (const thumb of [false, true]) {
    const fp = photoPath(id, thumb);
    if (fp) await unlink(fp).catch(() => {});
  }
  await setFlash("Photo deleted");
  revalidateAll();
}

// ─────────────── CSV import (additive) ───────────────

const platformFrom = (s: string): "EBAY" | "MERCARI" | "FACEBOOK" | "OTHER" => {
  const v = s.toLowerCase();
  if (v.includes("ebay")) return "EBAY";
  if (v.includes("mercari")) return "MERCARI";
  if (v.includes("facebook") || v.includes("fb")) return "FACEBOOK";
  return "OTHER";
};

export interface ImportResult {
  created: number;
  skipped: string[];
  error?: string;
}

/** Bulk-create single items from a CSV. Never overwrites existing records. */
export async function importInventoryCsv(fd: FormData): Promise<ImportResult> {
  const user = await requireUser();
  const file = fd.get("file") as File | null;
  if (!file || file.size === 0) return { created: 0, skipped: [], error: "No file selected" };
  const { parseCsvObjects } = await import("./csv");
  const rows = parseCsvObjects(await file.text());
  const tz = await getUserTz(user.id);

  let created = 0;
  const skipped: string[] = [];
  for (const o of rows) {
    const title = o.title || o.name || o.item;
    if (!title) {
      skipped.push("(row with no title)");
      continue;
    }
    const statusRaw = (o.status || "UNLISTED").toUpperCase();
    const status = ["UNLISTED", "LISTED", "SOLD"].includes(statusRaw) ? (statusRaw as "UNLISTED" | "LISTED" | "SOLD") : "UNLISTED";
    // Category: case-insensitive match against the known list (unknown values ignored).
    const { CATEGORIES } = await import("./catalog");
    const category = CATEGORIES.find((c) => c.toLowerCase() === (o.category || "").toLowerCase()) ?? null;
    const product = await ensureProduct(user.id, title, category);
    const isPersonal = /personal|belonging/i.test(o.type || "") || /personal|belonging/i.test(o.source || "");
    // Location is a managed picklist — find-or-create by name (not for personal items).
    const locationId = !isPersonal && o.location ? await resolveLocation(user.id, o.location) : null;
    const purchase = await prisma.purchase.create({
      data: {
        userId: user.id,
        kind: "SINGLE",
        title,
        source: o.source || "Imported",
        isPersonal,
        locationId,
        purchasedAt: parseEntryDate(o.purchasedat || o.addedat || o.date, tz) ?? todayDay(tz),
        purchasedAtApprox: /^(y|yes|true|1|approx)/i.test(o.dateapprox || ""),
        costUsd: isPersonal ? 0 : num(o.costusd) ?? 0,
        costJpy: isPersonal ? null : num(o.costjpy),
        notes: o.notes || null,
        items: { create: { userId: user.id, productId: product.id, title, status, estimatedValue: num(o.estimatedvalue), condition: o.condition || null } }
      },
      include: { items: true }
    });
    if (o.sku) await applyItemSku(user.id, { id: purchase.items[0].id, productId: product.id, title }, o.sku);
    created++;
  }
  revalidateAll();
  return { created, skipped };
}

/** Bulk-record sales from a CSV, matching each row to an existing UNSOLD item by
 *  SKU (preferred) or exact title. Never overwrites; unmatched rows are reported. */
export async function importSalesCsv(fd: FormData): Promise<ImportResult> {
  const user = await requireUser();
  const file = fd.get("file") as File | null;
  if (!file || file.size === 0) return { created: 0, skipped: [], error: "No file selected" };
  const { parseCsvObjects } = await import("./csv");
  const rows = parseCsvObjects(await file.text());
  const tz = await getUserTz(user.id);

  const items = await prisma.item.findMany({
    where: { userId: user.id, status: { not: "SOLD" } },
    include: { product: true }
  });
  const bySku = new Map<string, string>();
  const byTitle = new Map<string, string>();
  for (const i of items) {
    if (i.product?.sku) bySku.set(i.product.sku.toLowerCase(), i.id);
    const k = i.title.toLowerCase();
    if (!byTitle.has(k)) byTitle.set(k, i.id);
  }

  let created = 0;
  const skipped: string[] = [];
  const used = new Set<string>();
  for (const o of rows) {
    const sku = (o.sku || "").toLowerCase();
    const title = (o.title || o.item || o.items || o.name || "").toLowerCase();
    let itemId = (sku && bySku.get(sku)) || (title && byTitle.get(title)) || null;
    if (!itemId || used.has(itemId)) {
      skipped.push(o.sku || o.title || o.item || "(unmatched row)");
      continue;
    }
    used.add(itemId);
    await prisma.$transaction([
      prisma.sale.create({
        data: {
          userId: user.id,
          platform: platformFrom(o.platform || ""),
          soldAt: parseEntryDate(o.date || o.soldat, tz) ?? todayDay(tz),
          shippingFee: num(o.shipping ?? o.shippingfee) ?? 0,
          ebayFee: num(o.ebayfee) ?? 0,
          mercariFee: num(o.mercarifee) ?? 0,
          adFee: num(o.adfee) ?? 0,
          lines: { create: { itemId, salePrice: num(o.saleprice ?? o.gross ?? o.soldfor) ?? 0 } }
        }
      }),
      prisma.item.update({ where: { id: itemId }, data: { status: "SOLD" } })
    ]);
    created++;
  }
  await rebalanceBundles(user.id);
  revalidateAll();
  return { created, skipped };
}

// ─────────────── full backup restore ───────────────

/**
 * Insert a backup's records for a user. Non-destructive + idempotent: records go
 * in with their original IDs and skipDuplicates, so anything already present is
 * left untouched. Dangling references (to records that didn't come through) are
 * dropped so foreign keys stay valid.
 */
async function applyRestore(uid: string, d: any): Promise<Record<string, number>> {
  const D = (v: unknown) => (v ? new Date(v as string) : undefined);
  const counts: Record<string, number> = {};

  await prisma.$transaction(
    async (tx) => {
      const idsOf = async (model: "location" | "product" | "purchase" | "item" | "sale") =>
        new Set((await (tx as any)[model].findMany({ where: { userId: uid }, select: { id: true } })).map((r: any) => r.id));

      // 0) Locations (referenced by purchases)
      if (Array.isArray(d.locations) && d.locations.length) {
        const r = await tx.location.createMany({
          data: d.locations.map((l: any) => ({ id: l.id, userId: uid, name: l.name, kind: l.kind ?? null, notes: l.notes ?? null, createdAt: D(l.createdAt) })),
          skipDuplicates: true
        });
        counts.locations = r.count;
      }
      const locationIds = await idsOf("location");

      // 1) Products
      if (Array.isArray(d.products) && d.products.length) {
        const r = await tx.product.createMany({
          data: d.products.map((p: any) => ({ id: p.id, userId: uid, name: p.name, normalizedKey: p.normalizedKey, category: p.category ?? null, sku: p.sku ?? null, compPrice: p.compPrice ?? null, compNotes: p.compNotes ?? null })),
          skipDuplicates: true
        });
        counts.products = r.count;
      }
      const productIds = await idsOf("product");

      // 2) Purchases
      if (Array.isArray(d.purchases) && d.purchases.length) {
        const r = await tx.purchase.createMany({
          data: d.purchases.map((p: any) => ({ id: p.id, userId: uid, kind: p.kind, title: p.title, source: p.source, locationId: p.locationId && locationIds.has(p.locationId) ? p.locationId : null, isPersonal: !!p.isPersonal, purchasedAt: D(p.purchasedAt), purchasedAtApprox: !!p.purchasedAtApprox, costUsd: p.costUsd ?? 0, costJpy: p.costJpy ?? null, taxUsd: p.taxUsd ?? 0, taxJpy: p.taxJpy ?? null, fxRate: p.fxRate ?? null, notes: p.notes ?? null })),
          skipDuplicates: true
        });
        counts.purchases = r.count;
      }
      const purchaseIds = await idsOf("purchase");

      // 3) Items — need a valid lot; drop a missing product reference to null.
      const items = (d.items ?? []).filter((i: any) => purchaseIds.has(i.purchaseId));
      if (items.length) {
        const r = await tx.item.createMany({
          data: items.map((i: any) => ({ id: i.id, userId: uid, purchaseId: i.purchaseId, productId: i.productId && productIds.has(i.productId) ? i.productId : null, title: i.title, status: i.status, condition: i.condition ?? null, estimatedValue: i.estimatedValue ?? null, costOverrideUsd: i.costOverrideUsd ?? null, costOverrideJpy: i.costOverrideJpy ?? null, notes: i.notes ?? null, createdAt: D(i.createdAt), writtenOffAt: i.writtenOffAt ? D(i.writtenOffAt) : null })),
          skipDuplicates: true
        });
        counts.items = r.count;
      }
      const itemIds = await idsOf("item");

      // 4) Sales
      if (Array.isArray(d.sales) && d.sales.length) {
        const r = await tx.sale.createMany({
          data: d.sales.map((s: any) => ({ id: s.id, userId: uid, platform: s.platform, soldAt: D(s.soldAt), fxRate: s.fxRate ?? null, shippingFee: s.shippingFee ?? 0, ebayFee: s.ebayFee ?? 0, mercariFee: s.mercariFee ?? 0, adFee: s.adFee ?? 0, shippingFeeJpy: s.shippingFeeJpy ?? null, ebayFeeJpy: s.ebayFeeJpy ?? null, mercariFeeJpy: s.mercariFeeJpy ?? null, adFeeJpy: s.adFeeJpy ?? null, bundleTotal: s.bundleTotal ?? null, bundleTotalJpy: s.bundleTotalJpy ?? null, bundleReviewed: s.bundleReviewed ?? false, notes: s.notes ?? null })),
          skipDuplicates: true
        });
        counts.sales = r.count;
      }
      const saleIds = await idsOf("sale");

      // 5) Sale lines — both ends must exist.
      const lines = (d.saleItems ?? []).filter((l: any) => saleIds.has(l.saleId) && itemIds.has(l.itemId));
      if (lines.length) {
        const r = await tx.saleItem.createMany({
          data: lines.map((l: any) => ({ id: l.id, saleId: l.saleId, itemId: l.itemId, salePrice: l.salePrice ?? 0, priceJpy: l.priceJpy ?? null, allocated: l.allocated ?? false })),
          skipDuplicates: true
        });
        counts.saleItems = r.count;
      }

      // 6) Expenses — null out any attachment whose target didn't come through.
      if (Array.isArray(d.expenses) && d.expenses.length) {
        const r = await tx.expense.createMany({
          data: d.expenses.map((e: any) => ({ id: e.id, userId: uid, date: D(e.date), category: e.category, description: e.description ?? null, amountUsd: e.amountUsd ?? 0, amountJpy: e.amountJpy ?? null, purchaseId: e.purchaseId && purchaseIds.has(e.purchaseId) ? e.purchaseId : null, itemId: e.itemId && itemIds.has(e.itemId) ? e.itemId : null, saleId: e.saleId && saleIds.has(e.saleId) ? e.saleId : null, createdAt: D(e.createdAt) })),
          skipDuplicates: true
        });
        counts.expenses = r.count;
      }

      // 7) Photos — metadata only; files re-link if still on the uploads volume.
      // Ids become file names, so only well-formed ids are accepted.
      const photos = (d.photos ?? []).filter((ph: any) => isPhotoId(ph.id) && itemIds.has(ph.itemId));
      if (photos.length) {
        const r = await tx.photo.createMany({
          data: photos.map((ph: any) => ({ id: ph.id, userId: uid, itemId: ph.itemId, order: ph.order ?? 0, createdAt: D(ph.createdAt) })),
          skipDuplicates: true
        });
        counts.photos = r.count;
      }

      // 8) Settings — taken from the backup only while the account's own settings
      // are still the untouched defaults (a new account, e.g. moving to a fresh
      // install). Settings someone has already changed are never overwritten.
      if (d.settings) {
        const restored = { ...settingsFromBackup(d.settings), ...(isValidTz(d.settings.timezone) ? { timezone: d.settings.timezone as string } : {}) };
        const current = await tx.settings.findUnique({ where: { userId: uid } });
        if (!current) {
          await tx.settings.create({ data: { userId: uid, ...restored } });
          counts.settings = 1;
        } else if (hasDefaultSettings(current)) {
          await tx.settings.update({ where: { userId: uid }, data: restored });
          counts.settings = 1;
        }
      }
    },
    { timeout: 120000, maxWait: 15000 }
  );

  return counts;
}

// Settings schema defaults (prisma/schema.prisma). An account whose settings all
// still match these has never changed them, so a restore may fill them in.
const DEFAULT_SETTINGS = {
  ebayFeePct: 0.1325,
  ebayFlatFee: 0.4,
  mercariFeePct: 0.1,
  adFeePct: 0.02,
  defaultShipping: 0,
  upcLookup: false,
  homeCurrency: "USD",
  fxMode: "live",
  singleCurrency: false,
  fxLive: false,
  fxManualRate: 150,
  theme: "light"
};

function hasDefaultSettings(s: Record<string, unknown>): boolean {
  return Object.entries(DEFAULT_SETTINGS).every(([k, v]) => s[k] === v);
}

/** A backup's settings, checked field by field. Anything missing or out of range
 *  (older backups lack the newer fields) falls back to the default. */
function settingsFromBackup(s: any): typeof DEFAULT_SETTINGS {
  const num = (v: unknown, def: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : def);
  const D = DEFAULT_SETTINGS;
  return {
    ebayFeePct: num(s.ebayFeePct, D.ebayFeePct, 1),
    ebayFlatFee: num(s.ebayFlatFee, D.ebayFlatFee, 1000),
    mercariFeePct: num(s.mercariFeePct, D.mercariFeePct, 1),
    adFeePct: num(s.adFeePct, D.adFeePct, 1),
    defaultShipping: num(s.defaultShipping, D.defaultShipping, 100000),
    upcLookup: s.upcLookup === true,
    homeCurrency: s.homeCurrency === "JPY" ? "JPY" : "USD",
    fxMode: s.fxMode === "historical" ? "historical" : "live",
    singleCurrency: s.singleCurrency === true,
    fxLive: s.fxLive === true,
    fxManualRate: typeof s.fxManualRate === "number" && Number.isFinite(s.fxManualRate) && s.fxManualRate > 0 ? s.fxManualRate : D.fxManualRate,
    theme: ["light", "cream", "dark", "system"].includes(s.theme) ? s.theme : D.theme
  };
}

// Restore limits: generous for real backups (photos are stored downscaled, ~0.5MB
// each), small enough that a crafted zip can't exhaust the server's memory.
const MAX_ZIP_ENTRIES = 20000;
const MAX_ZIP_ENTRY = 50 * 1024 * 1024;
const MAX_ZIP_TOTAL = 1024 * 1024 * 1024;

/**
 * Restore from a backup file — either the JSON export (data only) or the .zip
 * export (data + photo image files, which are written back to the uploads volume).
 */
export async function restoreBackup(fd: FormData): Promise<{ error?: string; counts?: Record<string, number> }> {
  const user = await requireUser();
  const file = fd.get("file") as File | null;
  if (!file || file.size === 0) return { error: "No backup file selected" };

  let data: any;
  // Photo files found in the zip, not yet decompressed (see the write loop below).
  let photoEntries: { id: string; thumb: boolean; entry: import("adm-zip").IZipEntry }[] = [];

  if (file.name.toLowerCase().endsWith(".zip")) {
    const { default: AdmZip } = await import("adm-zip");
    let zip: InstanceType<typeof AdmZip>;
    let entries: import("adm-zip").IZipEntry[];
    try {
      zip = new AdmZip(Buffer.from(await file.arrayBuffer()));
      entries = zip.getEntries();
    } catch {
      return { error: "Couldn't read that .zip file" };
    }
    // Zip-bomb guard: check declared sizes before decompressing anything (adm-zip
    // refuses to inflate an entry past its declared size).
    const declared = entries.reduce((a, e) => a + e.header.size, 0);
    if (entries.length > MAX_ZIP_ENTRIES || declared > MAX_ZIP_TOTAL || entries.some((e) => e.header.size > MAX_ZIP_ENTRY)) {
      return { error: "That .zip is too large to restore" };
    }
    const entry = zip.getEntry("backup.json");
    if (!entry) return { error: "Zip has no backup.json — not a ResellFlow backup" };
    try {
      const parsed = JSON.parse(entry.getData().toString("utf8"));
      if (parsed?.app !== "resellflow" || !parsed.data) return { error: "Not a ResellFlow backup file" };
      data = parsed.data;
    } catch {
      return { error: "backup.json inside the zip isn't valid" };
    }
    // Only "<photoId>.jpg" / "<photoId>.thumb.jpg" at the zip root are photo files;
    // everything else (other names, folders, "../" tricks) is ignored.
    for (const e of entries) {
      if (e.isDirectory) continue;
      const parsedName = parsePhotoFileName(e.entryName);
      if (parsedName) photoEntries.push({ ...parsedName, entry: e });
    }
  } else {
    let backup: any;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      return { error: "That file isn't valid JSON" };
    }
    if (backup?.app !== "resellflow" || !backup.data) return { error: "Not a ResellFlow backup file" };
    data = backup.data;
  }

  const counts = await applyRestore(user.id, data);

  // Restore photo image files from the zip onto the uploads volume — only for
  // photo records this user owns (a backup can't overwrite someone else's photo),
  // at most one full image + one thumbnail per photo (duplicate entries ignored),
  // and only files that are already this app's stored format (JPEG ≤1600px,
  // checked from the header without decoding), so a crafted zip can't make the
  // server decode thousands of images.
  if (photoEntries.length) {
    const owned = new Set(
      (await prisma.photo.findMany({ where: { userId: user.id, id: { in: photoEntries.map((p) => p.id) } }, select: { id: true } })).map((p) => p.id)
    );
    const seen = new Set<string>();
    await mkdir(UPLOAD_DIR, { recursive: true });
    let written = 0;
    for (const p of photoEntries) {
      const slot = `${p.id}${p.thumb ? ".thumb" : ""}`;
      const dest = owned.has(p.id) && !seen.has(slot) ? photoPath(p.id, p.thumb) : null;
      if (!dest) continue;
      seen.add(slot);
      try {
        const data = p.entry.getData();
        if (!(await isStoredPhoto(data))) continue;
        await writeFile(dest, data);
        written++;
      } catch {
        /* skip unreadable / unwritable */
      }
    }
    counts.photoFiles = written;
  }

  await rebalanceBundles(user.id);
  revalidateAll();
  revalidatePath("/ledger");
  await setFlash(`Restore complete · ${Object.values(counts).reduce((a, b) => a + b, 0)} records added`);
  return { counts };
}

// ─────────────── locations ───────────────

export async function createLocation(fd: FormData) {
  const user = await requireUser();
  const name = str(fd.get("name"));
  if (!name) return;
  const existing = await prisma.location.findFirst({ where: { userId: user.id, name: { equals: likeLiteral(name), mode: "insensitive" } } });
  if (existing) {
    await setFlash(`“${name}” already exists`);
  } else {
    await prisma.location.create({ data: { userId: user.id, name, kind: str(fd.get("kind")) || null, notes: str(fd.get("notes")) || null } });
    await setFlash(`Added location “${name}”`);
  }
  revalidateAll();
  revalidatePath("/locations");
}

export async function renameLocation(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const name = str(fd.get("name"));
  if (!name) return;
  await prisma.location.updateMany({ where: { id, userId: user.id }, data: { name, kind: str(fd.get("kind")) || null } });
  await setFlash("Location updated");
  revalidateAll();
  revalidatePath("/locations");
}

/** Delete a location; its purchases keep their history but lose the tag (SetNull). */
export async function deleteLocation(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  await prisma.location.deleteMany({ where: { id, userId: user.id } });
  await setFlash("Location deleted");
  revalidateAll();
  revalidatePath("/locations");
}

// ─────────────── settings & invites ───────────────

export async function updateSettings(fd: FormData) {
  const user = await requireUser();
  const pctFromForm = (k: string) => {
    const n = num(fd.get(k));
    return n == null ? undefined : n / 100; // form is in %, stored as fraction
  };
  const upcLookup = fd.get("upcLookup") != null;
  const homeCurrency = str(fd.get("homeCurrency")) === "JPY" ? "JPY" : "USD";
  const singleCurrency = str(fd.get("secondCurrency")) === "none";
  const fxMode = str(fd.get("fxMode")) === "historical" ? "historical" : "live";
  const fxLive = fd.get("fxLive") != null;
  const manualRate = num(fd.get("fxManualRate"));
  const fxManualRate = manualRate != null && manualRate > 0 && manualRate < 10000 ? manualRate : undefined;
  const theme = ["light", "cream", "dark", "system"].includes(str(fd.get("theme"))) ? str(fd.get("theme")) : "light";
  // Only touched when the form sends a valid zone; otherwise the saved one stays.
  const timezone = isValidTz(str(fd.get("timezone"))) ? str(fd.get("timezone")) : undefined;
  // The root layout renders the theme from this cookie (no flash of wrong theme).
  (await cookies()).set("theme", theme, { path: "/", maxAge: 31536000, sameSite: "lax" });
  await prisma.settings.upsert({
    where: { userId: user.id },
    update: {
      ebayFeePct: pctFromForm("ebayFeePct"),
      mercariFeePct: pctFromForm("mercariFeePct"),
      adFeePct: pctFromForm("adFeePct"),
      ebayFlatFee: num(fd.get("ebayFlatFee")) ?? undefined,
      defaultShipping: num(fd.get("defaultShipping")) ?? undefined,
      upcLookup,
      homeCurrency,
      singleCurrency,
      fxMode,
      fxLive,
      fxManualRate,
      theme,
      timezone
    },
    create: {
      userId: user.id,
      ebayFeePct: pctFromForm("ebayFeePct") ?? 0.1325,
      mercariFeePct: pctFromForm("mercariFeePct") ?? 0.1,
      adFeePct: pctFromForm("adFeePct") ?? 0.02,
      ebayFlatFee: num(fd.get("ebayFlatFee")) ?? 0.4,
      defaultShipping: num(fd.get("defaultShipping")) ?? 0,
      upcLookup,
      homeCurrency,
      singleCurrency,
      fxMode,
      fxLive,
      fxManualRate,
      theme,
      timezone
    }
  });
  await setFlash("Settings saved");
  revalidatePath("/settings");
}

/**
 * First-visit auto-detect: saves the browser's timezone, but only while none is
 * set yet — a zone the user picked in Settings is never overwritten.
 */
export async function detectTimezone(tz: string) {
  const user = await requireUser();
  if (!isValidTz(tz)) return;
  await prisma.settings.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, timezone: tz }
  });
  await prisma.settings.updateMany({ where: { userId: user.id, timezone: null }, data: { timezone: tz } });
}

/** Dismiss the "what's new" popup: the user has now seen the running version. */
export async function markWhatsNewSeen() {
  const user = await requireUser();
  const { appVersion } = await import("./changelog");
  await prisma.user.update({ where: { id: user.id }, data: { seenVersion: appVersion() } });
}

/** Change the signed-in user's password. Signs out every other session (by
 *  bumping sessionVersion) and re-issues this browser's cookie so it stays in. */
export async function changePassword(fd: FormData): Promise<{ error?: string }> {
  const user = await requireUser();
  // Passwords are taken verbatim (no trimming).
  const current = String(fd.get("currentPassword") ?? "");
  const next = String(fd.get("newPassword") ?? "");
  const confirm = String(fd.get("confirmPassword") ?? "");
  if (next !== confirm) return { error: "The new passwords don't match" };
  const problem = passwordProblem(next);
  if (problem) return { error: problem };

  const row = await prisma.user.findUnique({ where: { id: user.id } });
  if (!row || !(await verifyPassword(current, row.passwordHash))) {
    return { error: "Current password is incorrect" };
  }
  if (await verifyPassword(next, row.passwordHash)) {
    return { error: "The new password must be different from the current one" };
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(next), sessionVersion: { increment: 1 } }
  });
  await createSession(updated.id, updated.sessionVersion);
  return {};
}

/** Sign out of every device, this one included — e.g. after a lost phone or a
 *  shared computer. Bumping sessionVersion invalidates every cookie issued so far,
 *  even a copied one that hasn't expired yet. */
export async function signOutEverywhere() {
  const user = await requireUser();
  await prisma.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
  await destroySession();
  redirect("/login");
}

export async function createInvite(fd: FormData) {
  const user = await requireUser();
  if (!user.isAdmin) throw new Error("Only admins can create invites");
  const code = randomBytes(6).toString("hex");
  await prisma.invite.create({
    data: { code, email: normalizeEmail(str(fd.get("email"))) || null, createdBy: user.id }
  });
  await setFlash("Invite created");
  revalidatePath("/settings");
}

export async function deleteInvite(fd: FormData) {
  const user = await requireUser();
  if (!user.isAdmin) throw new Error("Only admins can delete invites");
  const id = str(fd.get("id"));
  await prisma.invite.deleteMany({ where: { id } });
  revalidatePath("/settings");
}

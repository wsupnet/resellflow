import { getSessionUser } from "@/lib/auth";
import { getFinancials } from "@/lib/queries";
import { prisma } from "@/lib/db";
import { resolveRange, normalizePeriod } from "@/lib/period";
import { getMoney } from "@/lib/money";
import fs from "fs";
import path from "path";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

/** Full-fidelity JSON backup of the user's records (everything except photo files,
 *  which live on the uploads volume; photo metadata is included so surviving files
 *  re-link on restore). Pairs with restoreBackup(). */
async function fullBackup(userId: string) {
  const [settings, locations, products, purchases, items, sales, saleItems, expenses, photos] = await Promise.all([
    prisma.settings.findUnique({ where: { userId } }),
    prisma.location.findMany({ where: { userId } }),
    prisma.product.findMany({ where: { userId } }),
    prisma.purchase.findMany({ where: { userId } }),
    prisma.item.findMany({ where: { userId } }),
    prisma.sale.findMany({ where: { userId } }),
    prisma.saleItem.findMany({ where: { sale: { userId } } }),
    prisma.expense.findMany({ where: { userId } }),
    prisma.photo.findMany({ where: { userId } })
  ]);
  return {
    app: "resellflow",
    version: 1,
    exportedAt: new Date().toISOString(),
    counts: {
      locations: locations.length, products: products.length, purchases: purchases.length, items: items.length,
      sales: sales.length, saleItems: saleItems.length, expenses: expenses.length, photos: photos.length
    },
    data: { settings, locations, products, purchases, items, sales, saleItems, expenses, photos }
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers: string[], rows: (unknown[])[]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const type = new URL(req.url).searchParams.get("type") ?? "inventory";

  // Import templates: the exact headers the CSV importers accept, plus two
  // example rows showing formats (overwrite them). No user data involved.
  if (type === "template-inventory" || type === "template-sales") {
    const csv =
      type === "template-inventory"
        ? [
            "title,sku,category,condition,status,source,location,costUsd,costJpy,estimatedValue,purchasedAt,type,notes",
            '"Final Fantasy VI (Super Famicom)",4988601007498,Video Game,"Complete (CIB)",UNLISTED,Book Off,"Book Off Downtown",18.50,2970,45,2026-01-15,,"example row — delete me"',
            '"Vintage Band Tee",,Apparel,,LISTED,Personal Belongings,,,,25,2026-02-01,personal,"personal item: no cost, excluded from flip ROI"'
          ].join("\n")
        : [
            "title,sku,salePrice,platform,soldAt,shippingFee,ebayFee,mercariFee,adFee",
            '"Final Fantasy VI (Super Famicom)",4988601007498,52.00,ebay,2026-03-10,6.50,7.29,0,1.04',
            '"Vintage Band Tee",,25.00,mercari,2026-03-12,4.00,0,2.50,0'
          ].join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="resellflow-${type}.csv"`
      }
    });
  }

  // Full JSON backup (all records) — handled before the CSV path.
  if (type === "backup") {
    const backup = await fullBackup(user.id);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(backup, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="resellflow-backup-${date}.json"`
      }
    });
  }

  // Full backup + photo image files, as a .zip.
  if (type === "backup-zip") {
    const { default: AdmZip } = await import("adm-zip");
    const backup = await fullBackup(user.id);
    const zip = new AdmZip();
    zip.addFile("backup.json", Buffer.from(JSON.stringify(backup, null, 2)));
    for (const ph of backup.data.photos) {
      for (const suffix of [".jpg", ".thumb.jpg"]) {
        const fp = path.join(UPLOAD_DIR, `${ph.id}${suffix}`);
        if (fs.existsSync(fp)) zip.addLocalFile(fp);
      }
    }
    const date = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(zip.toBuffer()), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="resellflow-backup-${date}.zip"`
      }
    });
  }

  const bundle = await getFinancials(user.id);

  let headers: string[] = [];
  let rows: unknown[][] = [];

  if (type === "inventory") {
    headers = ["title", "sku", "status", "source", "type", "lot", "costUsd", "soldFor", "fees", "expenses", "net", "roiPct", "addedAt"];
    for (const p of bundle.purchases) {
      for (const i of p.items) {
        const f = bundle.itemFin.get(i.id);
        rows.push([
          i.title,
          i.product?.sku ?? "",
          i.status,
          p.source,
          p.isPersonal ? "personal" : p.kind.toLowerCase(),
          p.kind === "LOT" ? p.title : "",
          r2(f?.allocatedCost ?? 0),
          f?.gross ? r2(f.gross) : "",
          r2(f?.feeShare ?? 0),
          r2(f?.expense ?? 0),
          i.status === "SOLD" ? r2(f?.net ?? 0) : "",
          i.status === "SOLD" && f?.roi != null ? r2(f.roi * 100) : "",
          new Date(i.createdAt).toISOString().slice(0, 10)
        ]);
      }
    }
  } else if (type === "sales") {
    headers = ["date", "platform", "items", "gross", "shipping", "ebayFee", "mercariFee", "adFee", "totalFees", "net"];
    for (const s of bundle.sales) {
      const gross = s.lines.reduce((a, l) => a + l.salePrice, 0);
      const net = s.lines.reduce((a, l) => a + (bundle.itemFin.get(l.itemId)?.net ?? 0), 0);
      rows.push([
        new Date(s.soldAt).toISOString().slice(0, 10),
        s.platform.toLowerCase(),
        s.lines.map((l) => l.item.title).join("; "),
        r2(gross),
        r2(s.shippingFee),
        r2(s.ebayFee),
        r2(s.mercariFee),
        r2(s.adFee),
        r2(s.shippingFee + s.ebayFee + s.mercariFee + s.adFee),
        r2(net)
      ]);
    }
  } else if (type === "lots") {
    headers = ["title", "kind", "source", "date", "costUsd", "costJpy", "gross", "fees", "expenses", "net", "roiPct", "items", "sold"];
    bundle.purchases.forEach((p, idx) => {
      // rollupLot via finance — reuse summarizeLots indexing
      const fin = bundle.finLots[idx];
      let gross = 0, fees = 0, expense = 0, sold = 0;
      for (const it of p.items) {
        const f = bundle.itemFin.get(it.id);
        if (!f) continue;
        gross += f.gross; fees += f.feeShare; expense += f.expense; if (f.sold) sold++;
      }
      const cost = (fin.costUsd || 0) + (fin.taxUsd || 0);
      const net = gross - fees - expense - cost;
      rows.push([
        p.title, p.isPersonal ? "personal" : p.kind.toLowerCase(), p.source,
        new Date(p.purchasedAt).toISOString().slice(0, 10),
        r2(cost), p.costJpy ?? "", r2(gross), r2(fees), r2(expense), r2(net),
        cost > 0 ? r2((net / (cost + fees + expense)) * 100) : "", p.items.length, sold
      ]);
    });
  } else if (type === "expenses") {
    headers = ["date", "category", "description", "amountUsd", "amountJpy", "attachedTo"];
    const itemTitle = new Map<string, string>();
    const lotTitle = new Map<string, string>();
    for (const p of bundle.purchases) {
      lotTitle.set(p.id, p.title);
      for (const i of p.items) itemTitle.set(i.id, i.title);
    }
    for (const e of bundle.expenses) {
      const attached = e.itemId
        ? `item: ${itemTitle.get(e.itemId) ?? e.itemId}`
        : e.purchaseId
          ? `lot: ${lotTitle.get(e.purchaseId) ?? e.purchaseId}`
          : e.saleId
            ? `sale: ${e.saleId}`
            : "general";
      rows.push([
        new Date(e.date).toISOString().slice(0, 10),
        e.category, e.description ?? "", r2(e.amountUsd), e.amountJpy ?? "", attached
      ]);
    }
  } else if (type === "report") {
    // Realized P&L line items for a period (one row per item sold in range) —
    // the detail behind the Reports page, for an accountant/spreadsheet.
    const sp = new URL(req.url).searchParams;
    const { start, end } = resolveRange(normalizePeriod(sp.get("period") ?? undefined), sp.get("from") ?? undefined, sp.get("to") ?? undefined);
    const inRange = (d: Date) => d >= start && d <= end;

    // Honor the yen/USD view toggle (cookie). Money columns are converted at the
    // live rate; a `currency` column makes the amounts unambiguous for accounting.
    const m = await getMoney(user.id);
    const money = (n: number) => (m.currency === "JPY" ? Math.round(n * m.rate) : r2(n));
    const locs = await prisma.location.findMany({ where: { userId: user.id }, select: { id: true, name: true } });
    const locName = new Map(locs.map((l) => [l.id, l.name]));
    const saleByItem = new Map<string, (typeof bundle.sales)[number]>();
    for (const s of bundle.sales) for (const l of s.lines) saleByItem.set(l.itemId, s);
    const purchaseByItem = new Map<string, (typeof bundle.purchases)[number]>();
    const itemById = new Map<string, (typeof bundle.purchases)[number]["items"][number]>();
    for (const p of bundle.purchases) for (const i of p.items) { purchaseByItem.set(i.id, p); itemById.set(i.id, i); }

    headers = ["soldAt", "item", "category", "condition", "platform", "source", "location", "currency", "gross", "fees", "cogs", "expenses", "net"];
    for (const [itemId, f] of bundle.itemFin) {
      if (!f.sold) continue;
      const s = saleByItem.get(itemId);
      if (!s || !inRange(new Date(s.soldAt))) continue;
      const p = purchaseByItem.get(itemId);
      const i = itemById.get(itemId);
      rows.push([
        new Date(s.soldAt).toISOString().slice(0, 10),
        i?.title ?? "",
        i?.product?.category ?? "",
        i?.condition ?? "",
        s.platform.toLowerCase(),
        p?.source ?? "",
        p?.locationId ? locName.get(p.locationId) ?? "" : "",
        m.currency,
        money(f.gross), money(f.feeShare), money(f.allocatedCost), money(f.expense), money(f.net)
      ]);
    }
    rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  } else {
    return new Response("unknown type", { status: 400 });
  }

  const csv = toCsv(headers, rows);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="resellflow-${type}-${date}.csv"`
    }
  });
}

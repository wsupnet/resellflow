import Link from "next/link";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { getFinancials, listLocations } from "@/lib/queries";
import { getUsdToJpy } from "@/lib/fx";
import { sortRows, dirOf } from "@/lib/sort";
import { variantKey, tracksCondition } from "@/lib/catalog";
import AddInventory from "@/components/AddInventory";
import MobileCollapse from "@/components/MobileCollapse";
import { type ItemRowData } from "@/components/ItemRow";
import ItemTable from "@/components/ItemTable";
import ProductRename from "@/components/ProductRename";
import SubNav from "@/components/SubNav";
import { SortableTh, SearchBox, Pagination } from "@/components/TableControls";
import InventoryFilters from "@/components/InventoryFilters";
import { resolvePer, paginate } from "@/lib/paginate";
import { SectionTitle } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { getMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams
}: {
  searchParams: { status?: string; q?: string; source?: string; type?: string; sort?: string; dir?: string; view?: string; missing?: string; location?: string; age?: string; category?: string; condition?: string; result?: string; roi?: string; page?: string; per?: string };
}) {
  const user = await requireUser();
  const [bundle, fx, locations, m] = await Promise.all([getFinancials(user.id), getUsdToJpy(), listLocations(user.id), getMoney(user.id)]);
  const locationNames = locations.map((l) => l.name);

  // "Sold N× before" counts per variant (product, or product+condition for
  // condition-tracked categories) so the count tracks the exact thing you're holding.
  const soldByVariant = new Map<string, number>();
  for (const p of bundle.purchases)
    for (const i of p.items)
      if (i.status === "SOLD" && i.productId) {
        const k = variantKey(i.productId, i.product?.category, i.condition);
        soldByVariant.set(k, (soldByVariant.get(k) ?? 0) + 1);
      }

  const view = searchParams.view === "product" ? "product" : "items";
  const statusFilter = (searchParams.status ?? "").toUpperCase();
  const sourceFilter = searchParams.source ?? "";
  const typeFilter = searchParams.type ?? "";
  const missingFilter = searchParams.missing ?? "";
  const locationFilter = searchParams.location ?? ""; // location id, or "none" for unassigned
  const ageFilter = searchParams.age ?? ""; // "30" | "60" | "90" — days unsold, in-stock items only
  const ageThreshold = ageFilter ? Number(ageFilter) : null;
  const categoryFilter = searchParams.category ?? "";
  const conditionFilter = searchParams.condition ?? "";
  const resultFilter = searchParams.result ?? ""; // "profit" | "loss" — sold items only
  const minRoi = searchParams.roi ? Number(searchParams.roi) / 100 : null; // sold items only
  const now = Date.now();
  const daysUnsold = (purchasedAt: Date) => Math.floor((now - +purchasedAt) / 86400000);
  const q = (searchParams.q ?? "").toLowerCase();
  const sources = [...new Set(bundle.purchases.map((p) => p.source))].sort();

  // Base set: every (purchase, item) pair matching type/source/location/category/
  // condition/search (NOT status) — shared by both views.
  const base: { p: (typeof bundle.purchases)[number]; i: (typeof bundle.purchases)[number]["items"][number] }[] = [];
  for (const p of bundle.purchases) {
    const matchesType =
      !typeFilter ||
      (typeFilter === "lot" && p.kind === "LOT" && !p.isPersonal) ||
      (typeFilter === "single" && p.kind === "SINGLE" && !p.isPersonal) ||
      (typeFilter === "personal" && p.isPersonal);
    if (!matchesType) continue;
    if (sourceFilter && p.source !== sourceFilter) continue;
    if (locationFilter && (locationFilter === "none" ? p.locationId != null : p.locationId !== locationFilter)) continue;
    for (const i of p.items) {
      if (categoryFilter && i.product?.category !== categoryFilter) continue;
      if (conditionFilter && i.condition !== conditionFilter) continue;
      if (
        q &&
        !i.title.toLowerCase().includes(q) &&
        !p.title.toLowerCase().includes(q) &&
        !i.product?.name?.toLowerCase().includes(q) &&
        !i.product?.sku?.toLowerCase().includes(q)
      )
        continue;
      base.push({ p, i });
    }
  }

  // ── Product (stock) aggregation — one row per product; condition-tracked
  //    products carry an in-stock breakdown by condition (rolled up, not split). ──
  const productGroups = new Map<
    string,
    { baseName: string; productId: string | null; sku: string | null; tracks: boolean; inStock: number; listed: number; sold: number; costTiedUp: number; saleSum: number; thumbId: string | null; condInStock: Map<string, number> }
  >();
  for (const { i } of base) {
    const tracks = tracksCondition(i.product?.category ?? null);
    const key = i.productId ?? `t:${i.title.toLowerCase()}`;
    const baseName = i.product?.name ?? i.title;
    const g =
      productGroups.get(key) ??
      {
        baseName,
        productId: i.productId ?? null,
        sku: i.product?.sku ?? null,
        tracks,
        inStock: 0, listed: 0, sold: 0, costTiedUp: 0, saleSum: 0, thumbId: null,
        condInStock: new Map<string, number>()
      };
    const fin = bundle.itemFin.get(i.id);
    if (i.status === "SOLD") {
      g.sold++;
      g.saleSum += fin?.gross ?? 0;
    } else if (i.status === "LOST" || i.status === "DAMAGED") {
      // Written off — out of inventory: not in stock, cost isn't "tied up" (it's gone).
    } else {
      g.inStock++;
      if (i.status === "LISTED") g.listed++;
      g.costTiedUp += fin?.allocatedCost ?? 0;
      if (tracks) {
        const c = i.condition ?? "Unspecified";
        g.condInStock.set(c, (g.condInStock.get(c) ?? 0) + 1);
      }
    }
    if (!g.thumbId && i.photos[0]) g.thumbId = i.photos[0].id;
    if (!g.sku && i.product?.sku) g.sku = i.product.sku;
    g.tracks = g.tracks || tracks;
    productGroups.set(key, g);
  }
  let products = [...productGroups.values()];
  const psort = searchParams.sort ?? "stock";
  const pdir = dirOf(searchParams.dir ?? (psort === "name" ? "asc" : "desc"));
  const pget: Record<string, (g: (typeof products)[number]) => string | number> = {
    name: (g) => g.baseName.toLowerCase(),
    stock: (g) => g.inStock,
    listed: (g) => g.listed,
    sold: (g) => g.sold,
    cost: (g) => g.costTiedUp
  };
  products = sortRows(products, pget[psort] ?? pget.stock, pdir);

  // ── Item rows (apply status + "missing field" filters, then sort) ──
  // Written-off (lost/damaged) items are OUT of inventory: hidden from "All" and
  // the normal status tabs, visible only on their own tab.
  const isWriteOff = (s: string) => s === "LOST" || s === "DAMAGED";
  let rows: ItemRowData[] = base
    .filter(({ i }) =>
      statusFilter === "WRITEOFF"
        ? isWriteOff(i.status)
        : statusFilter === "INSTOCK"
          ? i.status === "UNLISTED" || i.status === "LISTED"
          : statusFilter
            ? i.status === statusFilter
            : !isWriteOff(i.status)
    )
    .filter(({ p, i }) => {
      if (!missingFilter) return true;
      const cat = i.product?.category ?? null;
      switch (missingFilter) {
        case "category": return !cat;
        // "No condition" only means something for condition-tracked categories.
        case "condition": return tracksCondition(cat) && !i.condition;
        case "barcode": return !i.product?.sku;
        case "photo": return i.photos.length === 0;
        case "value": return i.estimatedValue == null;
        // Personal belongings have no sourcing location, so don't flag them.
        case "location": return !p.isPersonal && !p.locationId;
        default: return true;
      }
    })
    .filter(({ p, i }) => {
      if (!ageThreshold) return true;
      // Aging is only meaningful for stock still sitting unsold.
      if (i.status !== "UNLISTED" && i.status !== "LISTED") return false;
      return daysUnsold(p.purchasedAt) >= ageThreshold;
    })
    .filter(({ i }) => {
      if (!resultFilter && minRoi == null) return true;
      // Outcome/ROI filters only make sense for items that actually sold.
      if (i.status !== "SOLD") return false;
      const fin = bundle.itemFin.get(i.id);
      const net = fin?.net ?? null;
      if (resultFilter === "profit" && !(net != null && net > 0)) return false;
      if (resultFilter === "loss" && !(net != null && net < 0)) return false;
      if (minRoi != null && !(fin?.roi != null && fin.roi >= minRoi)) return false;
      return true;
    })
    .map(({ p, i }) => {
      const fin = bundle.itemFin.get(i.id);
      return {
        id: i.id,
        title: i.title,
        status: i.status,
        estimatedValue: i.estimatedValue,
        costOverrideUsd: i.costOverrideUsd,
        costOverrideJpy: i.costOverrideJpy,
        notes: i.notes,
        purchaseId: p.id,
        purchaseTitle: p.title,
        isLot: p.kind === "LOT",
        isPersonal: p.isPersonal,
        allocatedCost: fin?.allocatedCost ?? 0,
        gross: fin?.gross ?? 0,
        net: fin?.net ?? null,
        roi: fin?.roi ?? null,
        timesSold: i.productId ? soldByVariant.get(variantKey(i.productId, i.product?.category, i.condition)) ?? 0 : 0,
        addedAt: i.createdAt.toISOString(),
        // Days sitting unsold, from the purchase date — only meaningful in stock.
        daysInStock: i.status === "UNLISTED" || i.status === "LISTED" ? daysUnsold(p.purchasedAt) : null,
        sku: i.product?.sku ?? null,
        category: i.product?.category ?? null,
        condition: i.condition,
        photoCount: i.photos.length,
        thumbId: i.photos[0]?.id ?? null,
        productId: i.productId ?? null,
        productName: i.product?.name ?? i.title,
        compPrice: i.product?.compPrice ?? null
      };
    });
  const sort = searchParams.sort ?? "added";
  const dir = dirOf(searchParams.dir ?? (sort === "added" || sort === "name" ? undefined : "desc"));
  const getters: Record<string, (r: ItemRowData) => string | number | null> = {
    name: (r) => r.title.toLowerCase(),
    status: (r) => r.status,
    cost: (r) => r.allocatedCost,
    sold: (r) => (r.gross ? r.gross : null),
    net: (r) => (r.status === "SOLD" ? r.net : null),
    roi: (r) => (r.status === "SOLD" ? r.roi : null),
    added: (r) => r.addedAt
  };
  rows = sortRows(rows, getters[sort] ?? getters.added, dir);

  // Pagination (both views share the page/per params; filters & sorting reset page).
  const per = resolvePer(searchParams.per, cookies().get("pageSize")?.value);
  const pgItems = paginate(rows, searchParams.page, per);
  const pgProducts = paginate(products, searchParams.page, per);

  const tabs = [
    { key: "", label: "All" },
    { key: "INSTOCK", label: "In stock" },
    { key: "UNLISTED", label: "Unlisted" },
    { key: "LISTED", label: "Listed" },
    { key: "SOLD", label: "Sold" },
    { key: "WRITEOFF", label: "Lost/damaged" }
  ];
  // Links keep every current filter; only page (and sort, which differs per
  // view) reset. Status rides along harmlessly in product view.
  const linkParams = (set: Record<string, string>) => {
    const pr = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (v && k !== "page" && k !== "sort" && k !== "dir") pr.set(k, v);
    for (const [k, v] of Object.entries(set)) v ? pr.set(k, v) : pr.delete(k);
    return pr.toString();
  };
  const viewParams = (v: string) => linkParams({ view: v });

  return (
    <div className="space-y-6">
      <SubNav items={[{ href: "/inventory", label: "Items" }, { href: "/lots", label: "Lots" }]} />
      <h1 className="text-2xl font-bold">Inventory</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
        <div>
          <MobileCollapse label="+ Add inventory">
            <AddInventory rate={fx.rate} locations={locationNames} defaultCurrency={m.currency} />
          </MobileCollapse>
        </div>

        <div className="card">
          <SectionTitle action={<SearchBox placeholder="Search name or SKU…" />}>
            {view === "product" ? `In stock by product (${products.length})` : `Items (${rows.length})`}
          </SectionTitle>

          {/* View toggle */}
          <div className="mb-3 flex gap-1 text-sm">
            <Link scroll={false} href={`/inventory?${viewParams("items")}`} className={`rounded-lg px-3 py-1 font-medium ${view === "items" ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100"}`}>
              By item
            </Link>
            <Link scroll={false} href={`/inventory?${viewParams("product")}`} className={`rounded-lg px-3 py-1 font-medium ${view === "product" ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100"}`}>
              By product (stock)
            </Link>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            {view === "items" && (
              <div className="flex flex-wrap gap-1">
                {tabs.map((t) => {
                  const active = statusFilter === t.key;
                  return (
                    <Link scroll={false} key={t.key} href={`/inventory?${linkParams({ view: "items", status: t.key })}`} className={`rounded-lg px-3 py-1 font-medium ${active ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100"}`}>
                      {t.label}
                    </Link>
                  );
                })}
              </div>
            )}
            <InventoryFilters view={view} sources={sources} locations={locations.map((l) => ({ id: l.id, name: l.name }))} />
          </div>

          {view === "product" ? (
            products.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">No products match.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full rtable">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <SortableTh field="name">Product</SortableTh>
                      <SortableTh field="stock">In stock</SortableTh>
                      <SortableTh field="listed">Listed</SortableTh>
                      <SortableTh field="sold">Sold</SortableTh>
                      <SortableTh field="cost">Cost tied up</SortableTh>
                      <th className="th">Avg sale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pgProducts.rows.map((g) => (
                      <tr key={g.productId ?? g.baseName} className="border-b border-slate-50 hover:bg-slate-50/60">
                        <td className="td cell-main" data-label="">
                          <div className="flex items-center gap-2">
                            {g.thumbId ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={`/api/photo/${g.thumbId}?size=thumb`} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                            ) : (
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-300">▦</span>
                            )}
                            <Link href={`/inventory?view=items&q=${encodeURIComponent(g.baseName)}`} className="font-medium text-slate-800 hover:text-brand-700">
                              {g.baseName}
                            </Link>
                            {g.productId && <ProductRename productId={g.productId} name={g.baseName} />}
                          </div>
                          {(() => {
                            const parts = [...g.condInStock.entries()].filter(([, n]) => n > 0);
                            // Only show a breakdown when stock actually spans 2+ conditions.
                            if (parts.length < 2) return null;
                            return (
                              <div className="mt-0.5 text-xs text-slate-400">
                                {parts.map(([c, n]) => `${n} ${c === "Unspecified" ? "unspecified" : c}`).join(" · ")}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="td" data-label="In stock">
                          <span className={`font-semibold ${g.inStock > 0 ? "text-slate-800" : "text-slate-300"}`}>{g.inStock}</span>
                        </td>
                        <td className="td text-slate-500" data-label="Listed">{g.listed}</td>
                        <td className="td text-slate-500" data-label="Sold">{g.sold}</td>
                        <td className="td" data-label="Cost tied up">{fmtMoney(g.costTiedUp, m)}</td>
                        <td className="td text-slate-500" data-label="Avg sale">{g.sold > 0 ? fmtMoney(g.saleSum / g.sold, m) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination {...pgProducts} per={per} />
              </div>
            )
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No items match. Add one on the left or clear filters.</p>
          ) : (
            <>
              <ItemTable rows={pgItems.rows} rate={fx.rate} locations={locationNames} m={m} />
              <Pagination {...pgItems} per={per} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

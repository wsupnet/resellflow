#!/usr/bin/env python3
"""Generate a fictional ResellFlow dataset as SQL, for demo videos and screenshots.

Every name, price, barcode and place here is made up. The SQL attaches the data to
an existing user (the demo admin), so run it only against a throwaway demo stack:

    python3 scripts/demo/seed-demo.py demo@resellflow.test > demo.sql
    docker compose -p resellflow-demo ... exec -T db psql -U resell -d resellflow < demo.sql

See scripts/demo/README.md for the full recording workflow.
"""
import random
import re
import sys
import unicodedata
from datetime import date, timedelta

EMAIL = sys.argv[1] if len(sys.argv) > 1 else "demo@resellflow.test"
TODAY = date(2026, 10, 21)
YEN_PER_USD = 150.0
rng = random.Random(42)
_ids = 0


def nid(prefix):
    global _ids
    _ids += 1
    return f"demo{prefix}{_ids:05d}"


def normalize_key(title):
    """Mirror of src/lib/normalize.ts normalizeKey()."""
    s = unicodedata.normalize("NFKD", title.lower())
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\b(the|a|an|of|for|with|and)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(round(v, 2)) if isinstance(v, float) else str(v)
    if isinstance(v, date):
        return f"'{v.isoformat()} 12:00:00'"
    return "'" + str(v).replace("'", "''") + "'"


out = ["BEGIN;", f"CREATE TEMP TABLE demo_user AS SELECT id FROM \"User\" WHERE email = {q(EMAIL)};"]
U = "(SELECT id FROM demo_user)"


def insert(table, row):
    cols = ", ".join(f'"{c}"' for c in row)
    vals = ", ".join(q(v) for v in row.values())
    out.append(f'INSERT INTO "{table}" ("userId", {cols}) VALUES ({U}, {vals});')


# ── Catalog: name, category, sku, typical sale price, typical buy price, condition ──
CATALOG = {
    "emerald": ("Pokemon Emerald (GBA)", "Video Game", "045496736057", 110, 30, "Loose / disc only"),
    "sm64": ("Super Mario 64 (N64)", "Video Game", "045496870010", 42, 12, "Loose / disc only"),
    "oot": ("Zelda Ocarina of Time (N64)", "Video Game", "045496870089", 48, 14, "Loose / disc only"),
    "chrono": ("Chrono Trigger (SNES)", "Video Game", "4988601001153", 175, 60, "Complete (CIB)"),
    "dq5": ("Dragon Quest V (Super Famicom)", "Video Game", "4988601007012", 26, 6, "Complete (CIB)"),
    "dslite": ("Nintendo DS Lite", "Video Game Console", "045496717509", 68, 22, "Console only"),
    "gbc": ("Game Boy Color", "Video Game Console", "045496712009", 72, 25, "Console only"),
    "ff7guide": ("Final Fantasy VII Official Strategy Guide", "Game Guide", "9780761510666", 32, 5, "Good (light wear)"),
    "spirited": ("Spirited Away Blu-ray", "Movie", "786936856421", 22, 4, "Complete (CIB)"),
    "rumours": ("Fleetwood Mac Rumours LP", "Music", "075992731316", 28, 6, "Like new"),
    "levis": ("Vintage Levi's 501 Jeans", "Apparel", None, 55, 9, None),
    "pyrex": ("Pyrex Butterprint Bowl Set", "Collectible", None, 48, 10, None),
    "artbook": ("The Art of Totoro Artbook", "Book", "9781421561554", 36, 8, None),
    "walkman": ("Sony Walkman WM-F45", "Other", None, 85, 15, None),
    "charizard": ("Charizard Holo Card (Base Set)", "Trading Card", None, 140, 40, "Loose / disc only"),
    "yellow": ("Pokemon Yellow (Game Boy)", "Video Game", "045496730956", 38, 10, "Loose / disc only"),
    "kirby": ("Kirby's Adventure (NES)", "Video Game", "045496630334", 24, 6, "Loose / disc only"),
    "fleece": ("Patagonia Synchilla Fleece", "Apparel", None, 62, 8, None),
    "corning": ("Corningware Blue Cornflower Dish", "Collectible", None, 30, 4, None),
    "gameboy": ("Original Game Boy DMG-01", "Video Game Console", "045496711002", 80, 28, "Console only"),
}

LOCATIONS = {
    "bo": ("Book Off Downtown", "Book Off"),
    "gw": ("Goodwill Eastside", "Thrift Store"),
    "maple": ("Maple St Estate Sale", "Estate Sale"),
    "flea": ("Riverside Flea Market", "Other"),
    "oak": ("Oak Ave Garage Sale", "Garage Sale"),
}

# Settings: standard fee rates, USD display.
out.append(f'UPDATE "Settings" SET "ebayFeePct"=0.1325, "ebayFlatFee"=0.4, "adFeePct"=0.02, "mercariFeePct"=0.10, "defaultShipping"=0, "homeCurrency"=\'USD\', "fxMode"=\'live\', theme=\'light\' WHERE "userId"={U};')

loc_ids = {}
for k, (name, kind) in LOCATIONS.items():
    loc_ids[k] = nid("loc")
    insert("Location", {"id": loc_ids[k], "name": name, "kind": kind, "createdAt": date(2026, 1, 2)})

prod_ids = {}
for k, (name, cat, sku, sale, buy, cond) in CATALOG.items():
    prod_ids[k] = nid("prd")
    comp = 120.0 if k == "charizard" else None
    insert("Product", {"id": prod_ids[k], "name": name, "normalizedKey": normalize_key(name), "category": cat, "sku": sku, "compPrice": comp})

items = {}  # handle -> dict(id, key, purchased, purchaseId)


def jitter(v, pct=0.15):
    return round(v * (1 + rng.uniform(-pct, pct)), 2)


def purchase(kind, title, source, loc, when, cost_usd, keys, yen=False, tax=0.0, notes=None):
    pid = nid("pur")
    fx = 1 / YEN_PER_USD if yen else None
    insert("Purchase", {
        "id": pid, "kind": kind, "title": title, "source": source,
        "locationId": loc_ids.get(loc), "isPersonal": False, "purchasedAt": when,
        "costUsd": cost_usd, "costJpy": round(cost_usd * YEN_PER_USD) if yen else None,
        "taxUsd": tax, "taxJpy": round(tax * YEN_PER_USD) if yen and tax else None,
        "fxRate": fx, "notes": notes,
    })
    handles = []
    for i, k in enumerate(keys):
        name, cat, sku, sale, buy, cond = CATALOG[k]
        iid = nid("itm")
        handle = f"{k}#{len([h for h in items if h.startswith(k + '#')])}"
        items[handle] = {"id": iid, "key": k, "purchased": when, "pid": pid}
        insert("Item", {
            "id": iid, "purchaseId": pid, "productId": prod_ids[k], "title": name,
            "status": "UNLISTED", "condition": cond, "estimatedValue": float(sale),
            "createdAt": when,
        })
        handles.append(handle)
    return handles


def single(k, source, loc, when, yen=False):
    name, cat, sku, sale, buy, cond = CATALOG[k]
    return purchase("SINGLE", name, source, loc, when, jitter(buy), [k], yen=yen)[0]


def set_status(handle, status, when=None):
    extra = f', "writtenOffAt"={q(when)}' if when else ""
    out.append(f'UPDATE "Item" SET status=\'{status}\'{extra} WHERE id={q(items[handle]["id"])};')


def sale(platform, when, lines, ship=None, notes=None):
    """lines: [(handle, price)]. Fees are computed like SaleForm's auto-fees."""
    sid = nid("sal")
    gross = sum(p for _, p in lines)
    ebay = mercari = ad = 0.0
    if platform == "EBAY":
        ebay, ad = gross * 0.1325 + 0.40, gross * 0.02
    elif platform == "MERCARI":
        mercari = gross * 0.10
    shipping = ship if ship is not None else (round(rng.uniform(4.5, 11.5), 2) if platform in ("EBAY", "MERCARI") else 0.0)
    insert("Sale", {
        "id": sid, "platform": platform, "soldAt": when, "fxRate": 1 / YEN_PER_USD,
        "shippingFee": shipping, "ebayFee": round(ebay, 2), "mercariFee": round(mercari, 2), "adFee": round(ad, 2), "notes": notes,
    })
    for h, price in lines:
        out.append(f'INSERT INTO "SaleItem" (id, "saleId", "itemId", "salePrice") VALUES ({q(nid("sli"))}, {q(sid)}, {q(items[h]["id"])}, {q(float(price))});')
        set_status(h, "SOLD")
    return sid


d = lambda m, day: date(2026, m, day)

# ── Lots ──
lot_bo_jan = purchase("LOT", "Book Off haul · Jan", "Book Off", "bo", d(1, 10), 62.0,
                      ["dq5", "ff7guide", "spirited", "yellow", "kirby", "artbook"], yen=True, tax=6.2)
lot_estate = purchase("LOT", "Maple St estate box", "Estate Sale", "maple", d(2, 14), 45.0,
                      ["pyrex", "corning", "rumours", "walkman", "levis"])
lot_flea_mar = purchase("LOT", "Flea market retro games", "Other", "flea", d(3, 22), 90.0,
                        ["sm64", "oot", "gbc", "emerald", "kirby"])
lot_bo_may = purchase("LOT", "Book Off haul · May", "Book Off", "bo", d(5, 9), 80.0,
                      ["dq5", "ff7guide", "spirited", "artbook", "yellow", "emerald"], yen=True, tax=8.0)
lot_garage = purchase("LOT", "Oak Ave garage sale", "Garage Sale", "oak", d(6, 20), 30.0,
                      ["fleece", "levis", "corning", "rumours"])
lot_flea_aug = purchase("LOT", "Flea market consoles", "Other", "flea", d(8, 16), 110.0,
                        ["dslite", "gameboy", "sm64", "oot", "emerald"])

# ── Singles ──
s = {}
s["chrono"] = single("chrono", "Facebook Marketplace", None, d(1, 25))
s["charizard"] = single("charizard", "Other", "flea", d(2, 8))
s["dslite"] = single("dslite", "Thrift Store", "gw", d(2, 27))
s["emerald1"] = single("emerald", "Thrift Store", "gw", d(4, 3))
s["walkman"] = single("walkman", "Thrift Store", "gw", d(4, 18))
s["gbc"] = single("gbc", "Facebook Marketplace", None, d(5, 30))
s["fleece"] = single("fleece", "Thrift Store", "gw", d(6, 6))
s["chrono2"] = single("chrono", "Estate Sale", "maple", d(7, 11))
s["pyrex"] = single("pyrex", "Thrift Store", "gw", d(7, 26))
s["gameboy"] = single("gameboy", "Thrift Store", "gw", d(9, 5))
s["levis"] = single("levis", "Thrift Store", "gw", d(9, 19))
s["oot"] = single("oot", "Garage Sale", "oak", d(10, 4))

# ── Sales (spread over the year; Pokemon Emerald trends up for the Deal Checker) ──
sale("EBAY", d(1, 28), [(lot_bo_jan[0], 27.5)])                       # dq5
sale("EBAY", d(2, 6), [(lot_bo_jan[1], 34.0)])                        # ff7 guide
sale("MERCARI", d(2, 15), [(lot_bo_jan[2], 21.0)])                    # spirited
sale("EBAY", d(2, 22), [(s["chrono"], 168.0)])
sale("EBAY", d(3, 3), [(lot_estate[0], 52.0)])                        # pyrex
sale("FACEBOOK", d(3, 9), [(lot_estate[1], 30.0)])                    # corning
sale("EBAY", d(3, 18), [(lot_estate[3], 92.0)])                       # walkman
sale("MERCARI", d(3, 27), [(lot_bo_jan[3], 36.0), (lot_bo_jan[4], 22.0)], notes="Bundle: two Game Boy/NES carts")
sale("EBAY", d(4, 8), [(lot_flea_mar[3], 60.0)])                      # emerald
sale("EBAY", d(4, 12), [(s["charizard"], 128.0)])
sale("EBAY", d(4, 20), [(lot_flea_mar[0], 40.0), (s["dslite"], 70.0)], notes="Bundle across two purchases")
sale("MERCARI", d(5, 2), [(lot_estate[4], 58.0)])                     # levis
sale("EBAY", d(5, 14), [(lot_flea_mar[1], 46.0)])                     # oot
sale("EBAY", d(5, 21), [(s["emerald1"], 112.0)])
sale("FACEBOOK", d(6, 1), [(s["walkman"], 80.0)])
sale("EBAY", d(6, 11), [(lot_bo_may[0], 25.0)])                       # dq5
sale("EBAY", d(6, 25), [(lot_flea_mar[2], 74.0)])                     # gbc
sale("MERCARI", d(7, 2), [(lot_bo_may[1], 31.0), (lot_bo_may[2], 19.0)])
sale("EBAY", d(7, 9), [(lot_garage[0], 64.0)])                        # fleece
sale("EBAY", d(7, 17), [(lot_bo_may[5], 120.0)])                      # emerald
sale("EBAY", d(7, 30), [(s["gbc"], 69.0)])
sale("MERCARI", d(8, 7), [(lot_garage[1], 49.0)])                     # levis
sale("EBAY", d(8, 21), [(s["chrono2"], 182.0)])
sale("EBAY", d(8, 29), [(lot_flea_aug[0], 66.0)])                     # ds lite
sale("FACEBOOK", d(9, 6), [(s["pyrex"], 45.0)])
sale("EBAY", d(9, 12), [(lot_flea_aug[4], 130.0)])                    # emerald
sale("EBAY", d(9, 24), [(s["fleece"], 58.0)])
sale("MERCARI", d(10, 3), [(lot_bo_may[3], 38.0)])                    # artbook
sale("EBAY", d(10, 11), [(lot_flea_aug[1], 84.0)])                    # gameboy
sale("EBAY", d(10, 17), [(lot_flea_aug[2], 44.0)])                    # sm64

# ── Statuses for what's left: some listed, one write-off, the rest unlisted ──
for h in (lot_bo_jan[5], lot_garage[3], s["gameboy"], s["levis"], lot_flea_aug[3]):
    set_status(h, "LISTED")
set_status(lot_garage[2], "DAMAGED", d(7, 1))  # corningware dish arrived chipped

# ── Expenses ──
for m in range(1, 11):
    insert("Expense", {"id": nid("exp"), "date": d(m, 5), "category": "Subscription", "description": "eBay store subscription", "amountUsd": 7.95})
for m, amt in ((1, 24.5), (3, 18.2), (5, 31.0), (7, 22.4), (9, 27.9)):
    insert("Expense", {"id": nid("exp"), "date": d(m, 12), "category": "Supplies", "description": "Bubble mailers & tape", "amountUsd": amt})
for m, mi in ((2, 38), (4, 22), (6, 41), (8, 30)):
    insert("Expense", {"id": nid("exp"), "date": d(m, 20), "category": "Mileage", "description": f"Sourcing run ({mi} mi)", "amountUsd": round(mi * 0.7, 2)})
insert("Expense", {"id": nid("exp"), "date": d(1, 12), "category": "Import Fee", "description": "Forwarding service", "amountUsd": 14.0, "purchaseId": items[lot_bo_jan[0]]["pid"]})
insert("Expense", {"id": nid("exp"), "date": d(5, 12), "category": "Import Fee", "description": "Forwarding service", "amountUsd": 16.5, "purchaseId": items[lot_bo_may[0]]["pid"]})

out.append("COMMIT;")
print("\n".join(out))

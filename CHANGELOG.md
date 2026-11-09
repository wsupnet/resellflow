# Changelog

What's new in each ResellFlow version. The app shows the entries newer than the
last version you saw, once, the next time you sign in after an update.

Format: one `## <version> — <date>` heading per release (newest first), then
`- **Title**: description` bullets. The newest heading is the app's version, so
bump `package.json` to match when you add one.

## 0.3.0 — 2026-11-09

- **Product families**: group different products that are really the same thing, like the US and Japan releases of an album or the colours of a console. Each keeps its own barcode and profits; the family shows them side by side with combined totals ("sold 5 across US, Japan, Mexico"). Find them under **Inventory → By family**.
- **Family suggestions**: the app spots products with matching names (for example "New 3DS LL - Blue" and "NEW 3DS LL - Burgundy") and offers to group them. Accept, rename, or say **Not a family**.
- **Families in Insights**: switch Insights to **Families** to rank each family as one combined row.
- **Deal Checker uses family sales**: scan a version you've never sold, and if another version in its family has sold, you can use that as the benchmark for a verdict.

## 0.2.1 — 2026-11-09

- **Tidier Settings**: the long explanations are gone. Hover over or tap the **?** next to a setting to see what it does.

## 0.2.0 — 2026-11-09

- **Edit purchase details from the item page**: change an item's purchase date, best-guess flag, source, location and (for single buys) what you paid, right on its page. For an item from a lot, the change applies to the whole lot.
- **Pick which unit to edit**: if you have more than one of something, the item page lists every unit so you can pick the right one. Clicking a product in Inventory → By product opens a new product page listing every unit.
- **Timezone setting**: Settings now has a timezone, filled in from your browser. It decides what "today" is when you leave a date blank, and where days, months and years start in reports.
- **See what's behind a product's numbers**: on Analytics → Insights, click a product (its name or its bar) to see every sale behind it: what you paid, its share of a lot, each fee and expense, and how the net and ROI were worked out.
- **Settings, reorganised**: Settings is split into clear sections (fees, currency, preferences, privacy, data, account and more) with a menu down the side. Each section saves on its own.
- **Deal checker shows sold items only**: the search only lists products you've actually sold, so every result has real sale history behind it.
- **What's new**: this popup. After each update you'll see what changed, once.

## 0.1.0 — 2026-11-08

- **Inventory**: track single buys and lots, with photos, barcodes, conditions, and stock grouped by product.
- **Lots that split themselves**: a lot's cost is shared across its items in proportion to what each one sells for, so profit always rolls back to the lot it came from.
- **Sales and bundles**: record eBay, Mercari, Facebook and other sales, including bundles that mix items from different lots. Fees are worked out from your Settings.
- **Expenses**: log shipping supplies, import fees and other costs, attached to an item, lot or sale, or kept general.
- **Dashboard and reports**: profit, ROI, days to sell, best sources and locations, monthly trends, and CSV exports for your accountant.
- **Dollars and yen**: work in USD, yen or both, with rates locked at each purchase and sale.
- **Deal checker**: scan a barcode in the store and see whether the asking price is a good buy, based on your own sales.
- **Backups**: download everything (with photos) and restore it on another install.

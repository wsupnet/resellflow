# ResellFlow User Guide

A step-by-step walkthrough of everyday use: from your first login to buying,
selling, tracking expenses, checking deals in the store, and backing up your data.

New to ResellFlow? Read the [Overview](OVERVIEW.md) first for the big picture, or watch the
[90-second demo video](demo/resellflow-demo.mp4) to see the main tasks below being done.
Setting it up? See the [README](../README.md#quick-start) or [Hosting on a NAS](DEPLOY-NAS.md).

**Contents**

1. [First login](#1-first-login)
2. [Set up your fees and preferences](#2-set-up-your-fees-and-preferences)
3. [Add a single item](#3-add-a-single-item)
4. [Add a lot](#4-add-a-lot)
5. [Manage your inventory](#5-manage-your-inventory)
6. [Record a sale](#6-record-a-sale)
7. [Track expenses](#7-track-expenses)
8. [Read the dashboard](#8-read-the-dashboard)
9. [Use the Deal Checker in the store](#9-use-the-deal-checker-in-the-store)
10. [Back up and restore your data](#10-back-up-and-restore-your-data)
11. [Invite family and friends](#11-invite-family-and-friends)

---

## 1. First login

1. Open the app in your browser, for example `http://localhost:3939` or `http://<NAS-IP>:3939`.
2. Sign in with the `ADMIN_EMAIL` and `ADMIN_PASSWORD` from your `.env`. This account is
   created automatically the first time the app starts.
3. **Change your password right away:** **Settings → Account**. Enter your current password,
   then the new one twice (at least 12 characters). Changing it signs out any other devices.

> **Forgot your password?** You can't reset it from the app. Ask whoever runs the server, or
> run the reset script yourself. See
> [Passwords & lockout](DEPLOY-NAS.md#9-passwords--lockout).

**On your phone:** open the same address and use your browser's *Add to Home Screen*.
ResellFlow then opens like an app. The barcode camera needs **HTTPS** (or `localhost`); see the
HTTPS section of [Hosting on a NAS](DEPLOY-NAS.md).

---

## 2. Set up your fees and preferences

Do this once, before you record sales, so fees are calculated correctly.

1. Go to **Settings → Selling fees**.
2. Check each rate against what your platforms actually charge you:
   - **eBay final value fee (%)** and **eBay flat fee per order ($)**
   - **eBay ad fee (%)**, if you use promoted listings
   - **Mercari fee (%)**
   - **Default shipping ($)**
3. Pick your display options:
   - **Default display currency**: USD or yen. You can flip it any time with the **$ / ¥** toggle in the top bar.
   - **Yen conversion**: *Live* (today's rate) or *Historical* (the rate locked in on each purchase or sale)
   - **Theme**: Light, Off-white, Dark, or follow your device
4. Optional: **Auto-fill item name from scanned barcode** looks up retail, book and music
   barcodes online. It's off by default.
5. Click **Save settings**.

Changing fee rates later never rewrites past sales. Each sale keeps the fees it was recorded with.

**Sourcing locations (optional):** **Settings → Sourcing locations → Manage locations** lets
you keep a list of specific stores or sales (for example "Book Off Downtown") so you can later
see which places make you the most money. You can also create them on the fly while adding items.

---

## 3. Add a single item

For anything you bought on its own.

1. Go to **Inventory** (or **+ Add inventory** on the dashboard).
2. Make sure the **Single item** tab is selected.
3. Fill in:
   - **Item name**
   - **Barcode / SKU**: type it, or tap **Scan** to use your camera. Items with the same code are
     grouped as one product, so your "times sold" history stays accurate.
   - **Category** and **Source** (Book Off, thrift store, estate sale, and so on)
   - **Purchased** date and **Location** (optional)
   - **Cost**: enter **Yen cost (¥)** and the USD cost fills in from the live rate, or enter
     **USD cost ($)** directly. Add **Tax** if any.
   - **Est. resale value ($)** (optional, but it helps cost splitting and reports before the item sells)
   - **Notes**
4. Click **Add item**.

If the name looks like something you already have, ResellFlow asks whether it's the same thing.
Choose **Use that item** to link it to that product's history, or **No, it's different**.

**Something you already owned?** Tick **Personal belonging**. It has no purchase cost, counts toward
your profit, but is kept out of your ROI so it doesn't skew it.

---

## 4. Add a lot

For a box, bundle or haul bought for one price. ResellFlow splits the lot's cost across its
items automatically, weighted by what each one sells for (or is expected to).

### Option A: type a quick list

1. **Inventory → Lot (many items)**.
2. Enter the source, date, location and the **total cost** of the lot (plus tax, if any).
3. Optionally name the lot. If you leave it blank, it's named "‹source› lot · ‹date›".
4. Under **Items in this lot (one per line)**, type one item per line.
5. Optionally set a **Category (applies to all)**.
6. Click **Create lot**.

### Option B: scan items one at a time

Best when you're unpacking a haul with barcodes.

1. **Inventory → Lot (many items) → 📷 Scan items into a lot**.
2. Set the basics: source, date, location, **total cost** and tax.
3. For each item: scan or type the **Barcode**, check the **Name**, set **Category**, **Condition**,
   **Quantity** (same item several times? set a count instead of scanning again), an optional
   **Est. value**, and an optional photo.
4. Click **Add & scan next** after each one.
5. Things without barcodes? Switch to typing them in, one per line, then **← Scan more** to go back.
6. When you're finished, click **Done scanning — finish up →**, then **View the lot**.

### After the lot is created

Open it from **Inventory → Lots** to edit its name, cost, tax or location, add more items, or see how
the lot is doing overall. If you know one item's exact cost, set **This item's cost** (or the
**Cost override** on the item). The rest of the lot's cost is split across the other items.

---

## 5. Manage your inventory

**Inventory → Items** lists everything you own or have sold.

- **Filter by status:** All · In stock · Unlisted · Listed · Sold · Lost/damaged
- **Filters** button: narrow by category, condition, location, missing info, and more
- **By item / By product**: see each copy separately, or grouped by product with stock counts
- **Search** by name or SKU
- **Edit** on any row: change status, category, condition, barcode, estimated value, cost override or notes
- **Bulk edit**: tick several rows and change them all at once
- **Item page**: click an item's name to add **photos** and see its full **profit breakdown**

**When you list something** on eBay or Mercari, set its status to **Listed** so the dashboard knows
what's for sale. **Lost or broken?** Set **Lost (write-off)** or **Damaged (write-off)**. Its cost
still counts against your profit, which keeps the numbers honest.

---

## 6. Record a sale

1. Go to **Sales** (or **+ Record sale** on the dashboard).
2. Choose the **Platform** (eBay, Mercari, Facebook or Other) and the **Sold date**.
3. Choose whether you're entering amounts in USD or yen.
4. Under **Items in this sale**, tick the item(s) that sold. Use **Search items…** to find them.
   - **One item:** enter its price.
   - **A bundle:** price each item, or enter one **Total sale price** and let ResellFlow split it
     across the items by value. You can adjust any line afterwards.
5. Check the **fees**. They're calculated from your Settings for the chosen platform, and you can
   type over any of them (shipping, eBay fee, Mercari fee, ad fee). The form shows an
   **estimated net** before you save.
6. Add **Notes** if you like (order number, buyer username, and so on).
7. Click **Record sale**.

The items are marked **Sold**, and their profit flows into the item, its lot, the dashboard and
reports automatically. To fix a mistake, find the sale on the **Sales** page and edit or delete it.

---

## 7. Track expenses

For business costs that aren't the purchase price of an item: supplies, shipping materials,
subscriptions, mileage, import fees, customs, a partner's commission.

1. Go to **Ledger** (from **More** in the top bar).
2. Under **Add expense**:
   - **Category**: Commission, Import Fee, Customs/Duty, Supplies, Shipping, Subscription, Mileage or Other
   - **Date**
   - **Type**: **− Expense** for money out, or **+ Credit / income** for money back (a refund, say)
   - **Amount**, in JPY or USD
   - **Attach to** (optional): a specific lot, item or sale. Leave it as general for business-wide costs.
   - **Description**
3. Click **Add expense**.

Expenses reduce your net profit and count toward ROI, the same way fees do. Attached expenses also
show up in that item's or lot's own profit breakdown.

---

## 8. Read the dashboard

The **Dashboard** is your business at a glance. Pick a time frame at the top (**This month**,
**This quarter**, **This year**, **All time**). Your choice is remembered.

| Card | What it means |
|---|---|
| **Net profit (total)** | Everything you've earned minus everything you've spent: costs, fees and expenses |
| **Flip ROI** | Return on what you paid for items you've sold. Personal belongings are excluded. |
| **Gross sales** | Total sale prices before fees, with total fees and expenses shown underneath |
| **Realized net** | Profit on what has actually sold, ignoring the cost of unsold stock |
| **Items in stock** | Unlisted + listed items you still have |
| **Items sold / Lots & purchases / Sales recorded** | Counts for the selected period |

- **Click any card** (the **→**) to open an *audit* page listing exactly which items and sales make up that number.
- Hover the **?** on a card for a short explanation.
- **Tidy up your catalog**: chips for items missing a barcode, condition or photo. Click one to filter
  those items, then bulk-edit.
- **Aging inventory**: items unsold for 30, 60 or 90+ days. Worth a price drop, a relist, or bundling.
- **Charts**: net profit by month, and your top items by net profit.

For deeper analysis, open **Analytics**:
- **Reports**: profit & loss; breakdowns by location, platform, source and expense category
- **Insights**: what to buy more of, ranked by a blended score, total profit, ROI, how often it sells, or how fast
- **Trends**: which month each category sells best in

---

## 9. Use the Deal Checker in the store

Standing in a store wondering whether something is worth buying? Open **Deal Checker** on your phone.

1. **Find the product.** Tap scan and point the camera at the barcode, or search by name or SKU.
   If you've handled it before, you'll see your history: times sold, average sale price, and
   whether it's been selling above or below its usual price lately.
2. **Enter the asking price** in dollars or yen. The built-in **Currency converter** uses today's rate.
3. **Read the verdict**, which compares the asking price to what it usually sells for:

   | Verdict | You'd pay… |
   |---|---|
   | **Buy it 🔥** | 40% or less of what it sells for: strong margin |
   | **Buy it** | Up to 70%: a healthy margin after fees |
   | **Maybe** | Up to 100%: thin once fees come out |
   | **Rethink it** | More than it sells for: you'd likely lose money |

**Never sold one before?** There's no history to compare against yet. Look up recent sold prices
(eBay sold listings, 130point, and so on), then use **Set manual comp (sold price, $) → Save comp** on
that product. The Deal Checker uses your comp from then on.

**Scanned something new?** If no item has that barcode yet, add it in **Inventory** so its history
starts building.

---

## 10. Back up and restore your data

Back up regularly, and always before updating the app.

### From the app (easiest)

1. **Settings → Export & import → Full backup & restore**.
2. Click **Download .zip (with photos)** for everything, or **Download .json (data only)** for a smaller file.
3. Keep the file somewhere safe: another drive, cloud storage, and so on.

**To restore:** on the same screen, choose the backup file (`.zip` or `.json`) and click **Restore**.
Restoring **only adds missing records**. It never deletes or overwrites what's already there, so
it's safe to run on a live account.

### CSV export and import

- **Export CSV**: Inventory, Sales, Lots or Expenses, handy for spreadsheets or taxes.
- **Import CSV**: bulk-add inventory or sales. Click **Download template** next to each importer for
  the exact columns (with two example rows to overwrite). Imports are additive too.

### Server-level backups

For a full database dump and photo copy from the server itself (for example on a NAS schedule), see
[Backups & persistence](DEPLOY-NAS.md#7-backups--persistence).

---

## 11. Invite family and friends

Registration is invite-only, and each person's data is completely private to them.

1. Sign in as the admin and go to **Settings → Invites**.
2. Optionally **Lock to email** so only that address can use the code.
3. Click **Create invite**.
4. Share the link `https://<your-host>/register?code=<CODE>`. They create their own account and
   start with an empty inventory.

Invite codes can be used once. Delete any you no longer need from the same list.

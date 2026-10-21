// Scripted walkthrough of ResellFlow, captured as a frame-accurate screencast.
// Runs inside the recorder image against a throwaway demo stack (see README.md).
//
//   node record.mjs            → frames + timings in $OUT (default /out)
//   SHOTS=1 node record.mjs    → dry run: one screenshot per scene, no screencast
//
// The page gets a fake cursor and caption banner injected, since headless
// Chromium draws neither. Every click goes through the real UI.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://app:3000";
const EMAIL = process.env.DEMO_EMAIL || "demo@resellflow.test";
const PASSWORD = process.env.DEMO_PASSWORD || "demo-password-123";
const OUT = process.env.OUT || "/out";
const SHOTS = process.env.SHOTS === "1";
const W = 1280, H = 800, DPR = 1.5;

fs.mkdirSync(path.join(OUT, SHOTS ? "shots" : "frames"), { recursive: true });

// ───────────── overlay (cursor + captions), re-injected on every document ─────────────
const OVERLAY = () => {
  const ensure = () => {
    if (!document.body || document.getElementById("__demo_cursor")) return;
    const st = document.createElement("style");
    st.id = "__demo_style";
    st.textContent = `
      #__demo_cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;
        transition:transform .6s cubic-bezier(.45,.05,.25,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
      .__demo_ripple{position:fixed;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;z-index:2147483646;
        pointer-events:none;background:rgba(37,99,235,.35);animation:__demo_r .5s ease-out forwards}
      @keyframes __demo_r{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
      #__demo_cap{position:fixed;left:50%;bottom:28px;transform:translate(-50%,12px);z-index:2147483645;pointer-events:none;
        max-width:880px;padding:14px 24px;border-radius:14px;background:rgba(15,23,42,.92);color:#fff;text-align:center;
        font:600 21px/1.35 Inter,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25);opacity:0;
        transition:opacity .35s ease,transform .35s ease}
      #__demo_cap.on{opacity:1;transform:translate(-50%,0)}
      #__demo_cap small{display:block;margin-top:3px;font-weight:400;font-size:15px;color:#cbd5e1}
      html{scroll-behavior:smooth}`;
    document.head.appendChild(st);
    const c = document.createElement("div");
    c.id = "__demo_cursor";
    c.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 10.5-6.6 1.2 3.9 7.3-2.9 1.5-3.9-7.4L4 20z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    const p = JSON.parse(sessionStorage.getItem("__demo_pos") || "[640,400]");
    c.style.transition = "none";
    c.style.transform = `translate(${p[0]}px,${p[1]}px)`;
    // No cursor on the static title/end cards.
    if (/^\/__demo\/(title|end)/.test(location.pathname)) c.style.display = "none";
    document.body.appendChild(c);
    const cap = document.createElement("div");
    cap.id = "__demo_cap";
    document.body.appendChild(cap);
    const saved = sessionStorage.getItem("__demo_cap_html");
    if (saved) { cap.innerHTML = saved; cap.classList.add("on"); }
  };
  window.__demo = {
    move(x, y, ms = 600) {
      ensure();
      const c = document.getElementById("__demo_cursor");
      c.style.transition = `transform ${ms}ms cubic-bezier(.45,.05,.25,1)`;
      c.style.transform = `translate(${x}px,${y}px)`;
      sessionStorage.setItem("__demo_pos", JSON.stringify([x, y]));
    },
    ripple(x, y) {
      const r = document.createElement("div");
      r.className = "__demo_ripple";
      r.style.left = x + "px"; r.style.top = y + "px";
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 600);
    },
    caption(html) {
      ensure();
      const cap = document.getElementById("__demo_cap");
      if (!html) { cap.classList.remove("on"); sessionStorage.removeItem("__demo_cap_html"); return; }
      cap.innerHTML = html; cap.classList.add("on");
      sessionStorage.setItem("__demo_cap_html", html);
    }
  };
  // React can replace the body's children during hydration; keep the overlay alive.
  setInterval(ensure, 200);
  document.addEventListener("DOMContentLoaded", ensure);
};

// ───────────── helpers ─────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
let shot = 0;
const marks = [];

async function caption(title, sub) {
  await page.evaluate((h) => window.__demo.caption(h), title ? `${title}${sub ? `<small>${sub}</small>` : ""}` : "");
}

async function scene(name) {
  if (SHOTS) await page.screenshot({ path: path.join(OUT, "shots", `${String(++shot).padStart(2, "0")}-${name}.png`) });
  marks.push({ name, t: Date.now() / 1000 });
  console.log(`scene: ${name}`);
}

/** Smoothly scroll the element into view if it's not comfortably on screen. */
async function reveal(loc) {
  await loc.waitFor({ state: "visible" });
  const box = await loc.boundingBox();
  if (box && box.y > 90 && box.y + box.height < H - 130) return;
  await frameScroll(loc, "center");
}

/** Scroll only the element's own window (scrollIntoView would also scroll the
 *  phone frame's overflow-hidden wrapper around the iframe). */
async function frameScroll(loc, align = "start") {
  await loc.evaluate((el, align) => {
    const win = el.ownerDocument.defaultView;
    const r = el.getBoundingClientRect();
    const off = align === "center" ? win.innerHeight / 2 - r.height / 2 : 70;
    win.scrollBy({ top: r.top - off, behavior: "smooth" });
  }, align);
  await sleep(800);
}

async function pointAt(loc, ms = 480) {
  await reveal(loc);
  const b = await loc.boundingBox();
  const x = b.x + Math.min(b.width / 2, 40), y = b.y + b.height / 2;
  await page.evaluate(([x, y, ms]) => window.__demo.move(x, y, ms), [x, y, ms]);
  await sleep(ms + 80);
  return { x, y };
}

async function click(loc, after = 500) {
  const { x, y } = await pointAt(loc);
  await page.evaluate(([x, y]) => window.__demo.ripple(x, y), [x, y]);
  await loc.click();
  await sleep(after);
}

async function type(loc, text, delay = 40) {
  await click(loc, 150);
  await loc.pressSequentially(text, { delay });
  await sleep(300);
}

async function choose(loc, value, after = 400) {
  await pointAt(loc);
  await loc.selectOption(value);
  await sleep(after);
}

async function hover(loc, after = 1600) {
  await pointAt(loc);
  await loc.hover();
  await sleep(after);
}

async function scrollBy(dy, after = 900) {
  await page.evaluate((dy) => window.scrollBy({ top: dy, behavior: "smooth" }), dy);
  await sleep(after);
}

async function scrollTop(after = 600) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await sleep(after);
}

// ───────────── static title / end / phone pages, served on the app's origin ─────────────
const CARD_CSS = `
  *{box-sizing:border-box;margin:0}
  body{height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:18px;
    background:radial-gradient(1200px 600px at 30% 20%,#1e3a8a 0%,#0f172a 60%);color:#fff;font-family:Inter,system-ui,sans-serif}
  h1{font-size:72px;font-weight:800;letter-spacing:-2px}
  p{font-size:26px;color:#cbd5e1;max-width:900px;text-align:center;line-height:1.4}
  .tag{margin-top:10px;font-size:16px;color:#93c5fd;border:1px solid #334155;border-radius:999px;padding:6px 16px}
  ul{list-style:none;display:flex;gap:14px;flex-wrap:wrap;justify-content:center;margin-top:8px;padding:0}
  li{font-size:17px;color:#e2e8f0;background:#1e293b;border-radius:10px;padding:8px 14px}`;
const TITLE = `<!doctype html><title>ResellFlow</title><style>${CARD_CSS}</style>
  <h1>ResellFlow</h1><p>Inventory, lots and real profit &amp; loss for people who flip secondhand finds</p>
  <span class="tag">Demo · all data is made up</span>`;
const END = `<!doctype html><title>ResellFlow</title><style>${CARD_CSS}</style>
  <h1>ResellFlow</h1><p>Self-hosted with one <b>docker compose up</b>. Private, invite-only, your data stays yours.</p>
  <ul><li>Lot cost splitting</li><li>Cross-lot bundles</li><li>Real fees &amp; ROI</li><li>Deal Checker</li><li>Barcode scanning</li><li>CSV &amp; backups</li></ul>`;
const PHONE = `<!doctype html><title>ResellFlow</title><style>${CARD_CSS}
  body{flex-direction:row;gap:80px}
  .copy{max-width:420px}.copy h2{font-size:44px;font-weight:800;letter-spacing:-1px;margin-bottom:16px}
  .copy p{text-align:left;font-size:21px}
  .phone{width:360px;height:740px;border-radius:48px;background:#020617;padding:14px;box-shadow:0 30px 80px rgba(0,0,0,.5),0 0 0 2px #334155}
  .screen{width:332px;height:712px;border-radius:36px;overflow:hidden;background:#fff}
  iframe{width:390px;height:836px;border:0;transform:scale(.8513);transform-origin:0 0}</style>
  <div class="copy"><h2>Deal Checker</h2><p>Standing in the store? Search or scan the barcode, type the asking price in yen or dollars, and get a verdict from your own sales history.</p></div>
  <div class="phone"><div class="screen"><iframe id="app" src="/deal-checker"></iframe></div></div>`;

// ───────────── the walkthrough ─────────────
async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, locale: "en-US", timezoneId: "America/Los_Angeles" });
  const login = await context.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
  await context.addCookies([{ name: "dashPeriod", value: "all", url: BASE }]);
  await context.addInitScript(OVERLAY);
  for (const [p, body] of [["/__demo/title", TITLE], ["/__demo/end", END], ["/__demo/phone", PHONE]]) {
    await context.route(`${BASE}${p}`, (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body }));
  }

  page = await context.newPage();
  const frames = [];
  let cdp;
  if (!SHOTS) {
    cdp = await context.newCDPSession(page);
    let n = 0;
    cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
      const file = `f${String(n++).padStart(6, "0")}.jpg`;
      fs.writeFileSync(path.join(OUT, "frames", file), Buffer.from(data, "base64"));
      frames.push({ file, t: metadata.timestamp });
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
  }

  await page.goto(`${BASE}/__demo/title`);
  await sleep(300);
  if (cdp) await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: W * DPR, maxHeight: H * DPR });
  await sleep(3200);
  await scene("title");

  // 1 ─ Dashboard
  await page.goto(`${BASE}/`);
  await page.getByText("Net profit (total)").waitFor();
  await caption("Your whole reselling business at a glance", "Net profit, ROI, gross sales and stock — after every fee and expense");
  await sleep(1200);
  await hover(page.getByRole("button", { name: "What does this mean?" }).first(), 1900);
  await click(page.getByRole("button", { name: "This year" }), 1200);
  await scene("dashboard");
  await caption("Spot what needs attention", "Aging stock, missing barcodes or photos, and your top lots");
  await scrollBy(430, 1900);
  await scrollBy(420, 1600);
  await scene("dashboard-lower");

  // 2 ─ Add a lot
  await scrollTop(400);
  await click(page.locator("header nav").getByRole("link", { name: "Inventory" }), 1200);
  await page.getByRole("heading", { name: "Inventory" }).waitFor();
  await caption("Add a lot: one price for a whole haul", "ResellFlow splits the cost across the items automatically");
  await click(page.getByRole("button", { name: "Lot (many items)" }), 700);
  const lot = page.locator("form").filter({ has: page.getByRole("button", { name: "Create lot" }) });
  await type(lot.locator('input[name="title"]'), "Book Off haul · Oct");
  await choose(lot.locator('select[name="source"]'), "Book Off");
  await choose(lot.locator('select[name="category"]'), "Video Game");
  await lot.locator('input[name="purchasedAt"]').fill("2026-10-20");
  await type(lot.locator('input[name="location"]'), "Book Off Downtown", 25);
  await page.keyboard.press("Escape");
  await caption("Paid in yen? Type it in", "The dollar cost fills in at today's exchange rate");
  await type(lot.locator('input[name="costJpy"]'), "9800", 120);
  await sleep(900);
  await type(lot.locator('textarea[name="items"]'), "Mother 3 (GBA)\nKirby Super Star (Super Famicom)\nSeiken Densetsu 3 (Super Famicom)\nDragon Quest VI (Super Famicom)", 22);
  await scene("lot-form");
  await click(lot.getByRole("button", { name: "Create lot" }), 1800);
  await caption("Lot created", "Each item's share of the cost updates as things sell");
  await click(page.getByRole("link", { name: "Lots", exact: true }), 1400);
  await click(page.getByRole("link", { name: "Book Off haul · Oct" }).first(), 1800);
  await sleep(1200);
  await scene("lot-page");

  // 3 ─ Bundle sale across lots
  await scrollTop(300);
  await click(page.locator("header nav").getByRole("link", { name: "Sales" }), 1400);
  await caption("Record a sale — even a bundle from different lots", "Each item's profit still rolls back to the lot it came from");
  const saleForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Record sale" }) });
  await type(saleForm.getByPlaceholder("Search items…"), "kirby's");
  await click(saleForm.locator("label").filter({ hasText: "Kirby's Adventure (NES)" }).locator('input[type="checkbox"]'), 500);
  await saleForm.getByPlaceholder("Search items…").fill("");
  await type(saleForm.getByPlaceholder("Search items…"), "yellow");
  await click(saleForm.locator("label").filter({ hasText: "Pokemon Yellow (Game Boy)" }).locator('input[type="checkbox"]'), 500);
  await caption("Sold as a bundle for one price?", "Enter the total and it's split by each item's value");
  await click(saleForm.getByRole("button", { name: "One total (lot)" }), 400);
  await type(saleForm.getByPlaceholder("one price for all selected items"), "68", 140);
  await sleep(800);
  await caption("eBay, Mercari and ad fees are calculated for you", "Override any of them, and see the estimated net before saving");
  await pointAt(saleForm.getByText("Est. net (pre-cost)"));
  await sleep(2000);
  await scene("sale-form");
  await click(saleForm.getByRole("button", { name: "Record sale" }), 600);
  await caption("Saved", "Each item's share of the profit rolls back to the lot it came from");
  await scrollTop(400);
  await pointAt(page.getByText("Pokemon Yellow (Game Boy)").first());
  await sleep(1800);
  await scene("sale-recorded");

  // 4 ─ Item profit breakdown
  await click(page.locator("header nav").getByRole("link", { name: "Inventory" }), 1200);
  await caption("Every item gets its own profit breakdown");
  await click(page.getByRole("link", { name: "Sold", exact: true }), 1400);
  await click(page.getByRole("link", { name: "Pokemon Yellow (Game Boy)" }).first(), 1800);
  await sleep(800);
  await scene("item-page");
  await scrollBy(520, 3000);

  // 5 ─ Inventory quality-of-life
  await scrollTop(300);
  await click(page.locator("header nav").getByRole("link", { name: "Inventory" }), 1400);
  await caption("Filter, search and group your stock", "Status tabs, aging badges, and a by-product view with stock counts");
  await click(page.getByRole("link", { name: "In stock", exact: true }), 1600);
  await scene("in-stock");
  await click(page.getByRole("link", { name: "By product (stock)" }), 1800);
  await click(page.getByRole("link", { name: "By item" }), 1400);
  await caption("Bulk-edit many items at once");
  const boxes = page.locator('tbody input[type="checkbox"]');
  await click(boxes.nth(0), 300);
  await click(boxes.nth(1), 500);
  const bulk = page.locator("form").filter({ hasText: "selected" }).first();
  await choose(bulk.locator('select[name="status"]'), "LISTED", 600);
  await scene("bulk-edit");
  await click(bulk.getByRole("button", { name: "Apply" }), 1600);

  // 6 ─ Analytics
  await click(page.locator("header nav").getByRole("link", { name: "Analytics" }), 1600);
  await caption("Reports: profit & loss with breakdowns", "By platform, source, sourcing location and expense category");
  await sleep(1400);
  await scrollBy(450, 1900);
  await scene("reports");
  await scrollTop(300);
  await click(page.getByRole("link", { name: "Insights", exact: true }), 1600);
  await caption("Insights: what should you buy more of?", "Rank by a blended score, total profit, ROI, sell-through or speed");
  await sleep(1400);
  await click(page.getByRole("link", { name: "Total profit", exact: true }), 2200);
  await scene("insights");
  await click(page.getByRole("link", { name: "Trends", exact: true }), 1600);
  await caption("Trends: when each category sells best");
  await sleep(2000);
  await scene("trends");

  // 7 ─ Currency toggle
  await click(page.locator("header nav").getByRole("link", { name: "Dashboard" }), 1600);
  await caption("Buy in yen, sell in dollars?", "Flip every number in the app between $ and ¥ with one click");
  await click(page.locator("header").getByRole("button", { name: "¥", exact: true }), 2600);
  await scene("yen");
  await click(page.locator("header").getByRole("button", { name: "$", exact: true }), 1400);

  // 8 ─ Deal Checker on a phone
  await caption("");
  await page.goto(`${BASE}/__demo/phone`);
  const app = page.frameLocator("#app");
  await app.getByText("Is this a good deal?").waitFor();
  await sleep(1400);
  await frameScroll(app.getByText("Is this a good deal?"));
  const search = app.getByPlaceholder("e.g. 3ds, final fantasy, or a SKU…");
  await click(search, 200);
  await search.pressSequentially("emerald", { delay: 90 });
  await sleep(700);
  await click(app.getByRole("button", { name: /Pokemon Emerald/ }).first(), 1500);
  await scene("deal-history");
  await frameScroll(app.getByText("Asking price"));
  await choose(app.locator("select").filter({ hasText: "JPY" }).first(), "JPY", 500);
  await type(app.getByText("Asking price").locator("..").locator("input"), "3300", 140);
  await sleep(2600);
  await scene("deal-verdict");
  const ask = app.getByText("Asking price").locator("..").locator("input");
  await click(ask, 200);
  await ask.fill("");
  await ask.pressSequentially("15800", { delay: 140 });
  await sleep(2800);
  await scene("deal-maybe");

  // End card
  await page.goto(`${BASE}/__demo/end`);
  await sleep(4000);
  await scene("end");

  if (cdp) {
    await cdp.send("Page.stopScreencast");
    fs.writeFileSync(path.join(OUT, "frames.json"), JSON.stringify({ frames, marks, end: Date.now() / 1000 }, null, 1));
  }
  await browser.close();
}

run().catch((e) => { console.error(e); process.exit(1); });

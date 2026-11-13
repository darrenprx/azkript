/* Inventory every dropdown surface: native <select> vs. app-drawn menu.
 *
 * The report this answers: "there are still many drop down menu like this not write
 * as fluent". A `<select>` whose popup is drawn by the OS cannot be styled by CSS at
 * all, so it looks like a different product from the app's own menus. This probe
 * enumerates every select, in every view and dialog, and records:
 *   - whether the element can be styled at all (appearance), and
 *   - whether it is vertically aligned with the pill buttons beside it.
 *
 * Usage: node scripts/probe-dropdowns.cjs [--json]
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const asJson = process.argv.includes("--json");
const playwrightPath = path.join(root, "node_modules", "playwright-core");
if (!fs.existsSync(playwrightPath)) {
  console.error("SKIP: node_modules/playwright-core is not installed");
  process.exit(1);
}
const { chromium } = require(playwrightPath);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

const VIEWS = ["script", "sceneview", "navigator", "beatboard", "characters", "reports"];

/* For every visible select, also record its nearest preceding/following pill button in
 * the same row, so an alignment defect is measured in numbers, not eyeballed. */
const READ = () => {
  const rowsOf = (el) => {
    const box = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      id: el.id || "(anon)",
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === "string" ? el.className.trim() : "",
      x: Math.round(box.left),
      y: Math.round(box.top),
      w: Math.round(box.width),
      h: Math.round(box.height),
      midY: Math.round((box.top + box.bottom) / 2),
      appearance: cs.appearance,
      radius: cs.borderTopLeftRadius,
      font: `${cs.fontSize}/${cs.fontWeight}`,
      color: cs.color,
      bg: cs.backgroundColor,
      border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
      // Customizable-select opt-in is detectable through the pseudo-element support.
      picker: CSS.supports("selector(::picker(select))"),
    };
  };
  const out = [];
  for (const sel of document.querySelectorAll("select")) {
    const box = sel.getBoundingClientRect();
    if (!sel.offsetWidth || !sel.offsetHeight) continue;
    const row = rowsOf(sel);
    // Nearest button in the same horizontal band, to compare centre lines.
    let nearest = null;
    let best = Infinity;
    for (const btn of document.querySelectorAll("button")) {
      const b = btn.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      if (Math.abs((b.top + b.bottom) / 2 - (box.top + box.bottom) / 2) > 26) continue;
      const gap = Math.abs(b.left - box.right) < Math.abs(box.left - b.right)
        ? b.left - box.right
        : box.left - b.right;
      if (gap > 48) continue;
      const d = Math.abs((b.top + b.bottom) / 2 - (box.top + box.bottom) / 2);
      if (d < best) {
        best = d;
        nearest = {
          label: (btn.textContent || "").trim().slice(0, 22),
          h: Math.round(b.height),
          midY: Math.round((b.top + b.bottom) / 2),
          deltaMidY: Math.round((box.top + box.bottom) / 2 - (b.top + b.bottom) / 2),
          deltaH: Math.round(box.height - b.height),
          deltaTop: Math.round(box.top - b.top),
          deltaBottom: Math.round(box.bottom - b.bottom),
        };
      }
    }
    row.nearest = nearest;
    out.push(row);
  }
  return out;
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const all = [];
  const record = (list, context) => list.forEach((row) => all.push({ ...row, context }));
  try {
    for (const view of VIEWS) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(appUrl);
      await page.waitForTimeout(1500);
      await page.evaluate(() => document.getElementById("startCenter")?.close());
      await page.waitForTimeout(250);
      await page.evaluate((v) => document.querySelector(`.rail__item[data-view="${v}"]`)?.click(), view);
      await page.waitForTimeout(650);
      record(await page.evaluate(READ), `view:${view}`);
      await page.close();
    }
    // Sprint widget holds its own select.
    {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(appUrl);
      await page.waitForTimeout(1500);
      await page.evaluate(() => document.getElementById("startCenter")?.close());
      await page.evaluate(() => document.getElementById("sprintQuickButton")?.click());
      await page.waitForTimeout(600);
      record(await page.evaluate(READ), "sprint");
      await page.close();
    }
    // Read dock holds the two read selects.
    {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      /* This block opens the read dock, which calls speakCurrent(). */
      await require("./lib/silence-speech.cjs").silenceSpeech(page);
      await page.goto(appUrl);
      await page.waitForTimeout(1500);
      await page.evaluate(() => document.getElementById("startCenter")?.close());
      await page.evaluate(() => document.getElementById("readToggle")?.click());
      await page.waitForTimeout(700);
      record(await page.evaluate(READ), "read dock");
      await page.close();
    }
    // Dialogs reconstructed from the source markup.
    const dialogs = [
      ["#settingsButton", "settings"],
      ["#pageSetupButton", "page setup"],
      ["#elementSettingsButton", "element settings"],
    ];
    for (const [selector, label] of dialogs) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(appUrl);
      await page.waitForTimeout(1500);
      await page.evaluate(() => document.getElementById("startCenter")?.close());
      await page.evaluate((sel) => document.querySelector(sel)?.click(), selector);
      await page.waitForTimeout(800);
      record(await page.evaluate(READ), `dialog:${label}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }

  if (asJson) {
    console.log(JSON.stringify(all, null, 2));
    return;
  }
  console.log(`${all.length} dropdown instance(s) measured\n`);
  const ids = [...new Set(all.map((r) => r.id))].sort();
  console.log(`${ids.length} distinct select id(s): ${ids.join(", ")}\n`);
  const appearances = [...new Set(all.map((r) => r.appearance))];
  console.log(`appearance values: ${appearances.map((a) => JSON.stringify(a)).join(", ")}`);
  console.log(`::picker(select) supported: ${all.some((r) => r.picker)}`);
  console.log("\nalignment (select mid-line vs. nearest pill button):");
  const seen = new Set();
  for (const row of all) {
    const key = `${row.id}|${row.context}`;
    if (seen.has(key) || !row.nearest) continue;
    seen.add(key);
    const flag = Math.abs(row.nearest.deltaMidY) > 1 || Math.abs(row.nearest.deltaH) > 1 ? "  <-- MISALIGNED" : "";
    console.log(
      `  ${row.id.padEnd(24)} ${row.context.padEnd(18)} h=${String(row.h).padEnd(4)} midY=${String(row.midY).padEnd(4)} ` +
        `nearest="${row.nearest.label}" h=${row.nearest.h} ΔmidY=${row.nearest.deltaMidY} Δh=${row.nearest.deltaH} Δtop=${row.nearest.deltaTop}${flag}`
    );
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

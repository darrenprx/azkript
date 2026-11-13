/* Reproduce and measure the ribbon split control (main button + dropdown arrow).
 *
 * The user reported a "glitch" around a split button: an icon-only split whose
 * arrow area paints a blue (hover/active) slab that does not respect the
 * control's own rounded corner, and whose glyph sits off the optical centre.
 *
 * Usage:
 *   node scripts/probe-split-arrow.cjs            # geometry report
 *   node scripts/probe-split-arrow.cjs --shots    # also write zoomed PNGs
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const { chromium } = require(path.join(root, "node_modules", "playwright-core"));
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;
const outDir = path.join(root, "reports", "split-arrow");
const shots = process.argv.includes("--shots");

const TABS = ["home", "insert", "document", "production", "tools", "format"];

function row(tag, name, extra) {
  console.log(`  ${tag.padEnd(22)} ${String(name).padEnd(30)} ${extra}`);
}

(async () => {
  if (shots) fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const problems = [];
  try {
    for (const theme of ["dark", "light"]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 4 });
      await page.goto(appUrl);
      await page.waitForTimeout(1500);
      await page.evaluate((t) => {
        document.getElementById("startCenter")?.close();
        document.documentElement.dataset.theme = t;
        document.body.dataset.theme = t;
      }, theme);
      await page.waitForTimeout(300);
      for (const tab of TABS) {
        await page.evaluate((t) => document.querySelector(`[data-ribbon-tab="${t}"]`)?.click(), tab);
        await page.waitForTimeout(250);
        const report = await page.evaluate(() => {
          const out = [];
          for (const split of document.querySelectorAll(".rb-split")) {
            const r = split.getBoundingClientRect();
            if (!r.width) continue;
            const main = split.querySelector(".rb-btn");
            const arrow = split.querySelector(".rb-split__arrow");
            const mr = main.getBoundingClientRect();
            const ar = arrow.getBoundingClientRect();
            const svg = arrow.querySelector("svg");
            const sr = svg.getBoundingClientRect();
            const cs = getComputedStyle(split);
            const acs = getComputedStyle(arrow);
            const mcs = getComputedStyle(main);
            out.push({
              label: arrow.getAttribute("aria-label") || "",
              tab: document.querySelector(".ribbon-tabs .is-active")?.textContent?.trim() || "",
              split: [r.x, r.y, r.width, r.height].map((n) => +n.toFixed(2)),
              main: [mr.x, mr.y, mr.width, mr.height].map((n) => +n.toFixed(2)),
              arrow: [ar.x, ar.y, ar.width, ar.height].map((n) => +n.toFixed(2)),
              svg: [sr.x, sr.y, sr.width, sr.height].map((n) => +n.toFixed(2)),
              splitRadius: cs.borderRadius,
              splitOverflow: cs.overflow,
              splitBg: cs.backgroundColor,
              arrowRadius: acs.borderRadius,
              arrowBg: acs.backgroundColor,
              arrowBorder: `${acs.borderTopWidth} ${acs.borderTopStyle} ${acs.borderTopColor} / left ${acs.borderLeftWidth}`,
              mainRadius: mcs.borderRadius,
              mainBg: mcs.backgroundColor,
              mainBorder: mcs.borderTopWidth,
              // Does the arrow's painted box reach past the split's rounded corner?
              splitRight: +(r.x + r.width).toFixed(2),
              arrowRight: +(ar.x + ar.width).toFixed(2),
              // optical: glyph centre vs arrow box centre
              dx: +(sr.x + sr.width / 2 - (ar.x + ar.width / 2)).toFixed(2),
              dy: +(sr.y + sr.height / 2 - (ar.y + ar.height / 2)).toFixed(2),
              // vertical: is the arrow as tall as the split?
              hGapTop: +(ar.y - r.y).toFixed(2),
              hGapBottom: +(r.y + r.height - (ar.y + ar.height)).toFixed(2),
              // main button vs arrow seam
              seam: +(ar.x - (mr.x + mr.width)).toFixed(2),
            });
          }
          return out;
        });
        for (const item of report) {
          if (!item.split[2]) continue;
          const tags = [];
          if (Math.abs(item.dx) > 0.5 || Math.abs(item.dy) > 0.5) tags.push("GLYPH-OFF");
          if (item.seam !== 0) tags.push(`SEAM=${item.seam}`);
          if (item.hGapTop !== 0 || item.hGapBottom !== 0) tags.push(`HGAP=${item.hGapTop}/${item.hGapBottom}`);
          if (item.arrowBg !== "rgba(0, 0, 0, 0)") tags.push(`ARROW-BG=${item.arrowBg}`);
          if (item.splitRadius !== "0px" && item.splitOverflow === "visible") tags.push("RADIUS-NOT-CLIPPED");
          console.log(
            `${theme.padEnd(5)} ${item.tab.padEnd(10)} ${item.label.padEnd(26)} split ${item.split[2]}x${item.split[3]} ` +
              `main ${item.main[2]}x${item.main[3]} arrow ${item.arrow[2]}x${item.arrow[3]} svg ${item.svg[2]} ` +
              `dx=${item.dx} dy=${item.dy} seam=${item.seam} hgap=${item.hGapTop}/${item.hGapBottom} ` +
              `r=${item.splitRadius}/${item.arrowRadius} ${tags.join(" ")}`
          );
          if (tags.length) problems.push({ theme, ...item, tags });
        }
      }
      if (shots) {
        for (const tab of ["home", "document", "tools", "format"]) {
          await page.evaluate((t) => document.querySelector(`[data-ribbon-tab="${t}"]`)?.click(), tab);
          await page.waitForTimeout(250);
          for (const state of ["idle", "hover-arrow", "hover-main", "pressed"]) {
            const handles = await page.$$(".rb-split");
            let i = 0;
            for (const h of handles) {
              const box = await h.boundingBox();
              if (!box || box.width < 20) continue;
              if (state === "hover-arrow") {
                const a = await h.$(".rb-split__arrow");
                if (a) await a.hover();
              } else if (state === "hover-main") {
                const m = await h.$(".rb-btn");
                if (m) await m.hover();
              } else if (state === "pressed") {
                const m = await h.$(".rb-btn");
                if (m) await m.evaluate((el) => el.classList.add("is-active"));
              } else {
                await page.mouse.move(5, 300);
              }
              await page.waitForTimeout(120);
              const clip = { x: box.x - 6, y: box.y - 6, width: box.width + 12, height: box.height + 12 };
              const file = path.join(outDir, `${theme}-${tab}-${i}-${state}.png`);
              await page.screenshot({ path: file, clip });
              i += 1;
            }
            if (state === "pressed") {
              await page.evaluate(() => document.querySelectorAll(".rb-split .rb-btn.is-active").forEach((el) => el.classList.remove("is-active")));
            }
          }
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`\nsplit problems: ${problems.length}`);
  process.exitCode = problems.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

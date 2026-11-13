/* Render every <symbol> icon in the app's sprite to a PNG contact sheet.
 *
 * Keeps the real document so the <use href="#id"> references resolve, and
 * appends a sheet to it. Also prints each glyph's ink bounding box so glyphs
 * drawn off their own 24px viewBox centre are visible as numbers, not guesses.
 *
 * Usage: node scripts/shot-icon-sheet.cjs [outPath]
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const { chromium } = require(path.join(root, "node_modules", "playwright-core"));
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;
const outPath = path.resolve(process.argv[2] || path.join(root, "reports", "icon-sheet.png"));

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(appUrl);
    await page.waitForTimeout(1200);
    const result = await page.evaluate(() => {
      const ids = [...document.querySelectorAll("symbol[id]")].map((s) => s.id);
      const sheet = document.createElement("div");
      sheet.id = "iconSheetProbe";
      sheet.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:#2b2a28;display:flex;flex-wrap:wrap;align-content:flex-start;font:10px/1.3 Consolas,monospace;color:#bbb;overflow:auto";
      document.body.appendChild(sheet);
      const boxes = [];
      for (const id of ids) {
        const cell = document.createElement("div");
        cell.style.cssText = "width:80px;text-align:center;padding:6px 2px";
        cell.innerHTML = `<svg viewBox="0 0 24 24" width="40" height="40" style="fill:none;stroke:#e8e8e8;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round"><use href="#${id}"/></svg><div>${id.replace(/^i-/, "")}</div>`;
        sheet.appendChild(cell);
        const svg = cell.querySelector("svg");
        const g = svg.querySelector("use");
        // Measure the painted ink bbox in the 24-unit viewBox coordinate system.
        let box = null;
        try {
          box = g.getBBox();
        } catch {
          box = null;
        }
        if (box) {
          boxes.push({
            id: id.replace(/^i-/, ""),
            x: +box.x.toFixed(2),
            y: +box.y.toFixed(2),
            w: +box.width.toFixed(2),
            h: +box.height.toFixed(2),
            cx: +(box.x + box.width / 2).toFixed(2),
            cy: +(box.y + box.height / 2).toFixed(2),
            dx: +(box.x + box.width / 2 - 12).toFixed(2),
            dy: +(box.y + box.height / 2 - 12).toFixed(2),
          });
        }
      }
      return { ids, boxes };
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: outPath, fullPage: false });
    const off = result.boxes.filter((b) => Math.abs(b.dx) > 0.75 || Math.abs(b.dy) > 0.75);
    console.log(`wrote ${path.relative(root, outPath)} — ${result.ids.length} symbols, ${result.boxes.length} measured`);
    console.log(`glyphs with ink centre >0.75 units off (12,12): ${off.length}`);
    for (const b of off) console.log(`  ${b.id.padEnd(18)} ink ${b.w}x${b.h} at (${b.cx},${b.cy})  dx=${b.dx} dy=${b.dy}`);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

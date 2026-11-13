/* Screenshot each ribbon tab's group area so caption/control conflicts can be seen.
 *
 * Usage: node scripts/shot-ribbon-tabs.cjs [outDir]
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const outDir = path.resolve(process.argv[2] || path.join(root, "reports", "ribbon-tabs"));
const { chromium } = require(path.join(root, "node_modules", "playwright-core"));
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

const TABS = ["home", "insert", "document", "tools", "production", "format"];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    for (const [w, h] of [[1440, 900], [1100, 800], [900, 700]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      await page.goto(appUrl);
      await page.waitForTimeout(1600);
      await page.evaluate(() => document.getElementById("startCenter")?.close());
      await page.waitForTimeout(250);
      for (const tab of TABS) {
        const ok = await page.evaluate((t) => {
          const b = document.querySelector(`[data-ribbon-tab="${t}"]`);
          if (!b) return false;
          b.click();
          return true;
        }, tab);
        if (!ok) continue;
        await page.waitForTimeout(400);
        const clip = await page.evaluate(() => {
          const bar = document.getElementById("ribbonBar");
          const b = bar.getBoundingClientRect();
          return { x: 0, y: Math.max(0, b.y - 2), width: window.innerWidth, height: Math.min(b.height + 4, 140) };
        });
        const file = path.join(outDir, `${tab}-${w}.png`);
        await page.screenshot({ path: file, clip });
        console.log("wrote", path.relative(root, file));
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

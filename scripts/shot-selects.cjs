/* Screenshot every native <select> with its popup OPEN, in light and dark.
 *
 * This is the check for the user's report "there are still many drop down menu like
 * this not write as fluent": the closed control has been Fluent for a while, and what
 * looked foreign was the open list. Until now that list was drawn by the OS and could
 * not be captured or styled; with `appearance: base-select` it is app-drawn CSS, so it
 * can be both screenshotted and asserted.
 *
 * Usage: node scripts/shot-selects.cjs [outDir]
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const outDir = path.resolve(process.argv[2] || path.join(root, "reports", "selects"));
const { chromium } = require(path.join(root, "rea", "node_modules", "playwright-core"));
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

/* One representative select per surface, reached the way a user reaches it. */
const TARGETS = [
  { name: "beatboard-align", view: "beatboard", selector: "#beatAlignSelect" },
  { name: "navigator-cards-across", view: "navigator", selector: "#cardsAcrossSelect" },
];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    for (const dark of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
      await page.goto(appUrl);
      await page.waitForTimeout(1500);
      await page.evaluate(() => document.getElementById("startCenter")?.close());
      await page.waitForTimeout(200);
      if (dark) {
        for (let i = 0; i < 3; i += 1) {
          const theme = await page.evaluate(() => document.documentElement.dataset.theme);
          if (theme === "dark") break;
          await page.locator("#themeToggle").click();
          await page.waitForTimeout(420);
        }
      }
      for (const target of TARGETS) {
        await page.evaluate((v) => document.querySelector(`.rail__item[data-view="${v}"]`)?.click(), target.view);
        await page.waitForTimeout(600);
        const opened = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return "missing";
          try {
            el.showPicker();
            return "ok";
          } catch (error) {
            return String(error);
          }
        }, target.selector);
        await page.waitForTimeout(500);
        const box = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          const b = el.getBoundingClientRect();
          return {
            x: Math.max(0, b.x - 30),
            y: Math.max(0, b.y - 30),
            width: b.width + 320,
            height: 400,
          };
        }, target.selector);
        const file = path.join(outDir, `${target.name}-${dark ? "dark" : "light"}.png`);
        await page.screenshot({ path: file, clip: box });
        console.log(`wrote ${path.relative(root, file)} (showPicker: ${opened})`);
        // Close the picker before the next target.
        await page.keyboard.press("Escape");
        await page.waitForTimeout(250);
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

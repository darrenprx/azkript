/* Capture the view head of every view at a few widths, light and dark, so the
 * toolbar alignment can be reviewed as pixels and not only as numbers.
 *
 * Usage: node scripts/shot-heads.cjs [outDir]
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const outDir = path.resolve(process.argv[2] || path.join(root, "reports", "heads"));
const { chromium } = require(path.join(root, "rea", "node_modules", "playwright-core"));
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

const VIEWS = ["sceneview", "navigator", "beatboard", "characters", "reports"];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    for (const [width, height] of [[1440, 900], [1280, 800]]) {
      for (const dark of [false, true]) {
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
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
        for (const view of VIEWS) {
          await page.evaluate((v) => document.querySelector(`.rail__item[data-view="${v}"]`)?.click(), view);
          await page.waitForTimeout(520);
          const clip = await page.evaluate((v) => {
            const head = document.querySelector(`[data-view-panel="${v}"] .view-head`);
            const b = head.getBoundingClientRect();
            return { x: Math.max(0, b.x - 4), y: Math.max(0, b.y - 4), width: b.width + 8, height: b.height + 8 };
          }, view);
          const file = path.join(outDir, `${view}-${width}-${dark ? "dark" : "light"}.png`);
          await page.screenshot({ path: file, clip });
          console.log("wrote", path.relative(root, file));
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

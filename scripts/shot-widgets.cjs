/* Screenshot the two small surfaces that hold a select but are not view heads or
 * dialogs: the Writing Sprint widget and the Table Read dock.
 *
 * Usage: node scripts/shot-widgets.cjs [outDir]
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const outDir = path.resolve(process.argv[2] || path.join(root, "reports", "widgets"));
const { chromium } = require(path.join(root, "node_modules", "playwright-core"));
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    for (const dark of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
      /* Screenshots the read dock, which starts speech when it opens. */
      await require("./lib/silence-speech.cjs").silenceSpeech(page);
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
      const suffix = dark ? "dark" : "light";

      // Writing Sprint widget
      await page.evaluate(() => document.getElementById("sprintQuickButton")?.click());
      await page.waitForTimeout(700);
      const sprintClip = await page.evaluate(() => {
        const el = document.getElementById("sprintWidget");
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x - 12, y: b.y - 12, width: b.width + 24, height: b.height + 24 };
      });
      if (sprintClip) {
        const file = path.join(outDir, `sprint-${suffix}.png`);
        await page.screenshot({ path: file, clip: sprintClip });
        console.log("wrote", path.relative(root, file));
      }
      await page.evaluate(() => document.getElementById("sprintCloseBtn")?.click());
      await page.waitForTimeout(400);

      // Table Read dock
      await page.evaluate(() => document.getElementById("readToggle")?.click());
      await page.waitForTimeout(800);
      const readClip = await page.evaluate(() => {
        const el = document.getElementById("readDock");
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: Math.max(0, b.x - 12), y: Math.max(0, b.y - 12), width: b.width + 24, height: b.height + 24 };
      });
      if (readClip) {
        const file = path.join(outDir, `read-dock-${suffix}.png`);
        await page.screenshot({ path: file, clip: readClip });
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

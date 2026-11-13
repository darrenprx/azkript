/* Screenshot every select-bearing DIALOG with its selects closed, plus one dialog
 * with a picker open, so the dialog surface can be reviewed too.
 *
 * The view-head work covered the main workspace; dialogs are the other place a
 * `<select>` appears (settings, page setup, element settings, assign voices) and they
 * inherit the same global rules, so they need their own visual check.
 *
 * Usage: node scripts/shot-dialog-selects.cjs [outDir]
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const outDir = path.resolve(process.argv[2] || path.join(root, "reports", "dialogs-selects"));
const { chromium } = require(path.join(root, "node_modules", "playwright-core"));
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

const DIALOGS = [
  { name: "settings", open: "#settingsButton" },
  { name: "page-setup", open: "#pageSetupButton" },
  { name: "element-settings", open: "#elementSettingsButton" },
  { name: "assign-voices", open: "#charAssignVoicesBtn", view: "characters" },
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
      for (const dialog of DIALOGS) {
        if (dialog.view) {
          await page.evaluate((v) => document.querySelector(`.rail__item[data-view="${v}"]`)?.click(), dialog.view);
          await page.waitForTimeout(500);
        }
        const opened = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          el.click();
          return true;
        }, dialog.open);
        await page.waitForTimeout(800);
        if (!opened) {
          console.log(`skip ${dialog.name}: trigger ${dialog.open} not found`);
          continue;
        }
        const file = path.join(outDir, `${dialog.name}-${dark ? "dark" : "light"}.png`);
        await page.screenshot({ path: file });
        console.log("wrote", path.relative(root, file));
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
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

/* Screenshot every app view/surface for visual review, in light and dark.
 *
 * Written for the "this view uses a different style than the rest of the app" class of
 * report: an unstyled surface is invisible to unit tests and to the palette audit,
 * because the elements exist and are merely painted with user-agent defaults. The only
 * way to catch it is to look at each surface.
 *
 * Usage: node scripts/shot-views.cjs [outDir]
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const outDir = path.resolve(process.argv[2] || path.join(root, "reports", "views-2026-10-22"));
const playwrightPath = path.join(root, "node_modules", "playwright-core");
if (!fs.existsSync(playwrightPath)) {
  console.error("SKIP: node_modules/playwright-core is not installed");
  process.exit(1);
}
const { chromium } = require(playwrightPath);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

/* Each view is reached through the rail button the user clicks (`data-view` on
 * `.rail__item`), so the screenshot is of the same DOM state a person sees. */
const VIEWS = [
  { name: "01-script", view: "script" },
  { name: "02-sceneview", view: "sceneview" },
  { name: "03-navigator-cards", view: "navigator" },
  { name: "04-beatboard", view: "beatboard" },
  { name: "05-characters", view: "characters" },
  { name: "06-reports", view: "reports" },
];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    for (const dark of [false, true]) {
      const themeName = dark ? "dark" : "light";
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(appUrl);
      await page.waitForTimeout(1400);
      // Dismiss the Start Center so the workspace is visible.
      await page.evaluate(() => document.getElementById("startCenter")?.close());
      await page.waitForTimeout(300);

      if (dark) {
        for (let i = 0; i < 3; i += 1) {
          const theme = await page.evaluate(() => document.documentElement.dataset.theme);
          if (theme === "dark") break;
          await page.locator("#themeToggle").click();
          await page.waitForTimeout(420);
        }
      }

      for (const view of VIEWS) {
        const trigger = page.locator(`.rail__item[data-view="${view.view}"]`);
        if ((await trigger.count()) === 0) {
          console.log(`  skip ${view.name}: no rail item for view "${view.view}"`);
          continue;
        }
        await trigger.click();
        await page.waitForTimeout(650);
        const file = path.join(outDir, `${view.name}-${themeName}.png`);
        await page.screenshot({ path: file });
        console.log("wrote", path.relative(root, file));
      }
      if (errors.length) console.error(`page errors (${themeName}):`, errors.slice(0, 5));
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

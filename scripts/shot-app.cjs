/* Screenshot the running app shell for visual review of the brand mark.
 *
 * Usage:
 *   node scripts/shot-app.cjs <out.png> [--dark] [--start] [--full]
 *
 *   --dark   switch the app to its dark theme via the titlebar theme button
 *   --start  open the Start Center dialog and shoot that
 *   --full   shoot the whole window instead of the titlebar lockup
 *
 * Uses the same Chrome + playwright-core pair as the browser smoke test, so it
 * needs no extra dependency. This is a review tool, not a test: it asserts
 * nothing, it just produces the PNG a human needs to look at.
 *
 * Note: the shell sets `data-theme` on <html>, so the OS `colorScheme` emulation
 * alone does not flip it. The theme button drives the real code path.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const outArg = args.find((a) => !a.startsWith("--"));
const out = path.resolve(outArg || path.join(root, "app", "brand", "preview", "app-shot.png"));
const dark = args.includes("--dark");
const start = args.includes("--start");
const full = args.includes("--full");

const playwrightPath = path.join(root, "node_modules", "playwright-core");
if (!fs.existsSync(playwrightPath)) {
  console.error("SKIP: node_modules/playwright-core is not installed");
  process.exit(1);
}
const { chromium } = require(playwrightPath);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

(async () => {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await page.goto(appUrl);
    // Let the shell finish its load animation before shooting.
    await page.waitForTimeout(1100);

    if (dark) {
      // The theme control cycles light -> dark -> system; click until the
      // document reports the dark theme rather than assuming one click.
      const themeButton = page.locator("#themeToggle");
      for (let i = 0; i < 3; i += 1) {
        const theme = await page.evaluate(() => document.documentElement.dataset.theme);
        if (theme === "dark") break;
        await themeButton.click();
        await page.waitForTimeout(450);
      }
      const applied = await page.evaluate(() => document.documentElement.dataset.theme);
      if (applied !== "dark") {
        console.error(`warning: expected dark theme, document reports "${applied}"`);
      }
      await page.waitForTimeout(350);
    }

    if (start) {
      await page.locator("#brandButton").click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: out });
    } else if (full) {
      await page.screenshot({ path: out });
    } else {
      // Crop tight to the titlebar brand lockup so the mark can be judged at 2x.
      const box = await page.locator(".titlebar__brand").boundingBox();
      await page.screenshot({
        path: out,
        clip: {
          x: Math.max(0, box.x - 8),
          y: Math.max(0, box.y - 8),
          width: 320,
          height: box.height + 16,
        },
      });
    }

    if (errors.length) console.error("page errors:", errors);
    console.log("wrote", out);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

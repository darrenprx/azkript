/* Screenshot the dialogs and panels that contain text inputs, and report their styling.
 *
 * Several of the app's editable fields live inside dialogs rather than views, so a
 * view-by-view screenshot sweep never sees them. This opens each dialog through its real
 * ribbon command, captures it, and reports the computed style of any input inside — which
 * is how the Cast List's actor field was found to be painting as a native Windows bevel.
 *
 * Usage: node scripts/shot-dialogs.cjs [outDir]
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const outDir = path.resolve(process.argv[2] || path.join(root, "reports", "views-2026-10-22", "dialogs"));
const playwrightPath = path.join(root, "node_modules", "playwright-core");
const { chromium } = require(playwrightPath);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

/* [name, ribbon tab, command id] — each is the real control a user clicks. */
const DIALOGS = [
  ["cast-list", "format", "format-cast-list"],
  ["rename-character", "edit", "edit-rename-character"],
  ["non-speaking", "edit", "edit-nonspeaking"],
  ["go-to", "edit", "edit-goto"],
  ["emoji", "edit", "edit-emoji"],
  ["settings", "home", "file-settings"],
  ["page-setup", "document", "document-page-setup"],
  ["title-page", "document", "document-title-page"],
];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const findings = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(appUrl);
    await page.waitForTimeout(1400);
    await page.evaluate(() => document.getElementById("startCenter")?.close());
    await page.waitForTimeout(300);

    for (const [name, tab, command] of DIALOGS) {
      await page.locator(`#ribbonTab-${tab}`).click();
      await page.waitForTimeout(400);
      const trigger = page.locator(`[data-ribbon-command="${command}"]`);
      if ((await trigger.count()) === 0) {
        console.log(`${name.padEnd(18)} no command "${command}" on the ${tab} tab`);
        continue;
      }
      // Dispatch through the deck's delegated listener; the panel may not be painted.
      await trigger.first().evaluate((node) => node.click());
      await page.waitForTimeout(700);

      const style = await page.evaluate(() => {
        const dialog = document.querySelector("dialog[open]");
        if (!dialog) return { opened: false };
        const inputs = [...dialog.querySelectorAll("input, select, textarea")].map((el) => {
          const s = getComputedStyle(el);
          return {
            tag: el.tagName.toLowerCase(),
            classes: (el.className && typeof el.className === "string" ? el.className : "").slice(0, 50),
            appearance: s.appearance,
            border: `${s.borderTopWidth} ${s.borderTopStyle}`,
            radius: s.borderRadius,
            background: s.backgroundColor,
            uaLooking: /inset/.test(s.borderTopStyle),
          };
        });
        return { opened: true, inputs };
      });

      if (!style.opened) {
        console.log(`${name.padEnd(18)} did not open a dialog`);
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(300);
        continue;
      }
      const bad = style.inputs.filter((i) => i.uaLooking);
      console.log(
        `${name.padEnd(18)} inputs ${String(style.inputs.length).padStart(2)}   ` +
          `platform-styled ${bad.length}`
      );
      for (const item of bad) {
        findings.push({ name, ...item });
        console.log(`    ${item.tag}.${item.classes}  border ${item.border}  radius ${item.radius}`);
      }
      const file = path.join(outDir, `${name}.png`);
      await page.screenshot({ path: file });
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(350);
    }
  } finally {
    await browser.close();
  }

  console.log("");
  if (findings.length) {
    console.log(`FAIL: ${findings.length} dialog input(s) still render with the platform bevel.`);
    process.exitCode = 1;
  } else {
    console.log("PASS: every dialog input uses the app's styling.");
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/* Functional check for the Scene View after its CSS rewrite.
 *
 * A styling fix can quietly break behaviour: the inline editors for Scene Title and
 * Synopsis are real <input> elements, and their change handlers are attached in
 * renderSceneView(). Replacing the stylesheet is not supposed to touch that, but this
 * project has already shipped a "cosmetic" change that renamed classes and silently
 * unstyled a whole view, so the interaction is verified rather than assumed.
 *
 * It also checks the columns can be toggled, which changes the number of grid cells per
 * row and is the most likely thing to break when grid metrics change.
 *
 * Usage: node scripts/probe-sceneview-behaviour.cjs
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const playwrightPath = path.join(root, "rea", "node_modules", "playwright-core");
const { chromium } = require(playwrightPath);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const failures = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto(appUrl);
    await page.waitForTimeout(1400);
    await page.evaluate(() => document.getElementById("startCenter")?.close());
    await page.waitForTimeout(300);
    await page.locator('.rail__item[data-view="sceneview"]').click();
    await page.waitForTimeout(600);

    // 1. The inline editors exist and are editable.
    const titleInput = page.locator(".sv-inline-input[data-sv-title]").first();
    const count = await titleInput.count();
    if (!count) failures.push("no Scene Title inline editor rendered");
    else {
      const before = await titleInput.inputValue();
      await titleInput.click();
      await titleInput.fill("Smoke Test Title");
      await titleInput.press("Tab");
      await page.waitForTimeout(500);
      const after = await titleInput.inputValue().catch(() => "(element replaced)");
      const stored = await page.evaluate(() => {
        const el = document.querySelector(".sv-inline-input[data-sv-title]");
        return el ? el.value : null;
      });
      console.log(`title editor: "${before}" -> "${stored}"`);
      if (stored !== "Smoke Test Title") {
        failures.push(`editing the Scene Title did not persist (value is "${stored}")`);
      }
    }

    // 2. Column toggles still reflow the grid without breaking the header count.
    const headerCount = async () => page.locator(".sv-row--head > span").count();
    const full = await headerCount();
    await page.locator('#sceneViewColumnsToggle .segmented__item[data-sv-col="action"]').click();
    await page.waitForTimeout(400);
    const reduced = await headerCount();
    console.log(`header columns: ${full} with all toggles, ${reduced} after hiding Opening Action`);
    if (reduced !== full - 1) {
      failures.push(`hiding a column changed the header from ${full} to ${reduced} cells, expected ${full - 1}`);
    }
    // Restore.
    await page.locator('#sceneViewColumnsToggle .segmented__item[data-sv-col="action"]').click();
    await page.waitForTimeout(350);

    // 3. The row actions are present and enabled where they should be.
    const editButtons = await page.locator("[data-sv-edit]").count();
    console.log(`row edit buttons: ${editButtons}`);
    if (editButtons < 1) failures.push("no Scene View edit buttons rendered");
    const firstDisabled = await page
      .locator('.sv-row:not(.sv-row--head) [data-sv-move="-1"]')
      .first()
      .isDisabled();
    console.log(`first row's "move up" disabled: ${firstDisabled} (expected true)`);
    if (!firstDisabled) failures.push("the first scene's move-up button should be disabled");

    if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(" | ")}`);
  } finally {
    await browser.close();
  }

  console.log("");
  if (failures.length) {
    console.log("FAIL:");
    for (const line of failures) console.log(`  - ${line}`);
    process.exitCode = 1;
  } else {
    console.log("PASS: Scene View still edits, toggles columns and renders row actions.");
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

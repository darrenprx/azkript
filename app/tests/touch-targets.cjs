/* Touch-target and hit-area regression test.
 *
 * Why this exists: several controls are deliberately small so the ribbon and the
 * outline timeline keep their visual rhythm, but "small glyph" and "small hit
 * area" are different problems. A 14x14 button with no expanded target is a
 * pixel-hunt on a touch pointer, and an absolutely-positioned child with
 * `pointer-events: none` silently steals clicks from its parent.
 *
 * This asserts the properties that are easy to regress:
 *   1. the ribbon split-arrow expands its clickable area beyond its drawn box;
 *   2. outline timeline segments are at least 20 px tall;
 *   3. no control in the shell reports a zero-size box while visible.
 *
 * Requires Chrome + rea/node_modules/playwright-core, like the other browser
 * tests; skips cleanly when either is absent.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const playwrightPath = path.join(root, "rea", "node_modules", "playwright-core");
if (!fs.existsSync(playwrightPath)) {
  console.log("SKIP: rea/node_modules/playwright-core is not installed");
  process.exit(0);
}
const { chromium } = require(playwrightPath);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(appUrl);
    await page.waitForTimeout(1300);

    // 1. The split arrow's clickable area must exceed its painted box.
    const arrow = await page.evaluate(() => {
      const el = document.querySelector(".rb-split__arrow");
      if (!el) return null;
      const box = el.getBoundingClientRect();
      // Probe just outside the painted box on each side.
      const probes = {
        above: document.elementFromPoint(box.left + box.width / 2, box.top - 3),
        below: document.elementFromPoint(box.left + box.width / 2, box.bottom + 3),
        right: document.elementFromPoint(box.right + 3, box.top + box.height / 2),
      };
      const hits = (node) => node === el;
      return {
        width: Math.round(box.width),
        height: Math.round(box.height),
        above: hits(probes.above),
        below: hits(probes.below),
        right: hits(probes.right),
      };
    });
    assert.ok(arrow, "expected a .rb-split__arrow in the ribbon");
    assert.ok(
      arrow.above || arrow.below || arrow.right,
      `split arrow hit area was not expanded beyond its ${arrow.width}x${arrow.height} box — ` +
        "the transparent ::after overlay is missing (see .rb-split__arrow::after)"
    );

    // 2. Outline timeline segments must stay tappable.
    const outline = await page.evaluate(() => {
      const segment = document.querySelector(".outline-segment");
      if (!segment) return null;
      const box = segment.getBoundingClientRect();
      return { height: Math.round(box.height), width: Math.round(box.width) };
    });
    if (outline) {
      assert.ok(
        outline.height >= 20,
        `outline segment is ${outline.height}px tall; needs >= 20px to be tappable ` +
          "(see .outline-bar__track height)"
      );
    }

    // 3. No visible button should collapse to a zero-size box.
    //    Buttons inside a closed <dialog> are legitimately 0x0 — the dialog is
    //    display:none via the UA stylesheet — so exclude anything that is not
    //    rendered (checked with checkVisibility) rather than only style.display.
    const collapsed = await page.evaluate(() => {
      const bad = [];
      for (const button of document.querySelectorAll("button")) {
        if (typeof button.checkVisibility === "function" && !button.checkVisibility()) continue;
        const box = button.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) {
          bad.push(button.id || button.className || button.tagName);
        }
      }
      return bad;
    });
    assert.deepEqual(collapsed, [], `visible buttons collapsed to zero size: ${collapsed.join(", ")}`);

    assert.deepEqual(errors, []);
    console.log("PASS: touch target test");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

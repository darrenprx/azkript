/* Measure the WORK one view-switch does, to find what reads as "refreshes twice".
 *
 * Instrumenting innerHTML writes was the wrong lens: one view render legitimately writes
 * several containers (stat grid, chart, table), and one rail click measurably produces a
 * single render of the target view. So if the user sees a double refresh, the extra work
 * is elsewhere — most likely a full `renderAll()` or a ribbon re-sync, both of which
 * rebuild large parts of the chrome and look like a flash.
 *
 * This counts, for one click:
 *   - `renderAll()` executions (rebuilds the entire workspace),
 *   - ribbon re-syncs (rebuilds the ribbon DOM),
 *   - per-view render function executions,
 *   - animations started (a restarting entrance animation is what "flashes").
 *
 * Usage: node scripts/probe-view-work.cjs [--target=rail|ribbon] [--view=sceneview]
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};
const target = arg("target", "rail");
const view = arg("view", "sceneview");

const playwrightPath = path.join(root, "node_modules", "playwright-core");
const { chromium } = require(playwrightPath);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(appUrl);
    await page.waitForTimeout(1500);
    await page.evaluate(() => document.getElementById("startCenter")?.close());
    await page.waitForTimeout(400);

    /* Count mutations of the whole chrome, which is what a "refresh" looks like: the
     * ribbon deck, the rail, and the statusbar are all rebuilt by renderAll/syncRibbon.
     * Counting MutationRecords on those containers is instrument-free (no dependency on
     * internal function names, which are closures) and directly measures visible churn. */
    await page.evaluate(() => {
      window.__work = { ribbon: 0, rail: 0, statusbar: 0, panel: 0, animations: 0 };
      const watch = (selector, key) => {
        const node = document.querySelector(selector);
        if (!node) return;
        new MutationObserver((records) => {
          // childList churn is a rebuild; attribute churn on a few nodes is a style tweak
          if (records.some((r) => r.type === "childList" && (r.addedNodes.length || r.removedNodes.length))) {
            window.__work[key] += 1;
          } else {
            window.__work[`${key}Attrs`] = (window.__work[`${key}Attrs`] || 0) + 1;
          }
        }).observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
      };
      watch(".commandbar.ribbon", "ribbon");
      watch("#rail", "rail");
      watch(".statusbar", "statusbar");
      watch("#viewStack", "panel");

      document.addEventListener("animationstart", () => {
        window.__work.animations += 1;
      }, true);
    });

    const before = await page.evaluate(() => ({ ...window.__work }));
    if (target === "rail") {
      await page.locator(`.rail__item[data-view="${view}"]`).click();
    } else {
      /* The ribbon is generated from RIBBON_TAB_DEFS, so its controls carry
       * data-ribbon-command (not data-command). Navigate to the View tab first, then
       * click the command, which is exactly what a user does. */
      await page.locator("#ribbonTab-view").click();
      await page.waitForTimeout(450);
      const COMMAND = {
        sceneview: "view-scene",
        navigator: "view-cards-summary",
        beatboard: "view-beatboard",
        reports: "view-reports",
        script: "view-normal",
      }[view];
      const el = page.locator(`[data-ribbon-command="${COMMAND}"]`);
      const found = await el.count();
      if (!found) {
        console.error(`no ribbon control with data-ribbon-command="${COMMAND}" on the View tab`);
        process.exitCode = 1;
        return;
      }
      /* Dispatch through the app's real click path rather than locator.click(): the
       * ribbon deck for a non-active tab is present but not painted, so Playwright
       * refuses to click it. Dispatching a bubbling click on the control still runs
       * the same delegated listener in `els.ribbonDeck`, which is the code path a user
       * exercises — no internals are stubbed. */
      await el.first().evaluate((node) => node.click());
    }
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => ({ ...window.__work }));

    console.log(`target: ${target}   view: ${view}\n`);
    for (const key of Object.keys({ ...before, ...after })) {
      const d = (after[key] || 0) - (before[key] || 0);
      if (d) console.log(`   ${String(d).padStart(3)}x  ${key}`);
    }
    const totalChurn = ["ribbon", "rail", "statusbar", "panel"].reduce(
      (sum, k) => sum + ((after[k] || 0) - (before[k] || 0)),
      0
    );
    console.log(`\ntotal chrome churn events: ${totalChurn}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

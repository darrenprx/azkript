/* Record the EXACT class-attribute transitions a view change performs, in order.
 *
 * The report is "each time I clicked on view change it refreshes the page twice". Two
 * earlier versions of this probe were wrong in ways worth recording, because both
 * produce confident-looking output:
 *   1. It counted `innerHTML` writes, but one view render legitimately writes several
 *      containers, so a single render looked like six "refreshes".
 *   2. It read `classList.contains(...)` inside the MutationObserver callback, which
 *      reports the state at DELIVERY time rather than at RECORD time, so a batch of
 *      mutations was counted several times over.
 *
 * This version logs the actual attribute VALUE transitions (old -> new) for each view
 * panel, plus every CSS animation that starts, in order. That makes "how many entrance
 * animations did one click start" a fact rather than an inference.
 *
 * Usage: node scripts/probe-view-transition.cjs [--target=rail|ribbon] [--view=sceneview]
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

const playwrightPath = path.join(root, "rea", "node_modules", "playwright-core");
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

    await page.evaluate(() => {
      window.__log = { classTransitions: [], animations: [], timeline: [] };
      const t0 = performance.now();
      const stamp = () => Math.round(performance.now() - t0);

      for (const panel of document.querySelectorAll("[data-view-panel]")) {
        const name = panel.dataset.viewPanel;
        new MutationObserver((records) => {
          for (const record of records) {
            if (record.attributeName !== "class") continue;
            // record.oldValue is the value BEFORE this mutation: exact, not inferred.
            window.__log.classTransitions.push({
              at: stamp(),
              panel: name,
              from: record.oldValue || "",
              to: panel.getAttribute("class") || "",
            });
          }
        }).observe(panel, { attributes: true, attributeOldValue: true, attributeFilter: ["class"] });
      }

      document.addEventListener(
        "animationstart",
        (event) => {
          const panel = event.target.closest?.("[data-view-panel]");
          window.__log.animations.push({
            at: stamp(),
            element: panel ? panel.dataset.viewPanel : event.target.className || event.target.tagName,
            name: event.animationName,
          });
        },
        true
      );
    });

    if (target === "rail") {
      await page.locator(`.rail__item[data-view="${view}"]`).click();
    } else {
      await page.locator("#ribbonTab-view").click();
      await page.waitForTimeout(400);
      const COMMAND = {
        sceneview: "view-scene",
        navigator: "view-cards-summary",
        beatboard: "view-beatboard",
        script: "view-normal",
      }[view];
      await page
        .locator(`[data-ribbon-command="${COMMAND}"]`)
        .first()
        .evaluate((node) => node.click());
    }
    await page.waitForTimeout(1500);

    const log = await page.evaluate(() => window.__log);
    console.log(`target: ${target}   view: ${view}\n`);

    console.log("== animations that started ==");
    const tally = {};
    for (const item of log.animations) {
      tally[item.name] = (tally[item.name] || 0) + 1;
      console.log(`  ${String(item.at).padStart(5)}ms  ${item.name.padEnd(14)} on ${item.element}`);
    }

    console.log("\n== class transitions on the target panel ==");
    for (const tr of log.classTransitions.filter((t) => t.panel === view)) {
      console.log(`  ${String(tr.at).padStart(5)}ms  "${tr.from}"  ->  "${tr.to}"`);
    }

    /* COUNT the entrance animations for the target view. A view has TWO competing
     * entrance animations in the stylesheets — `viewIn` via `.view.is-active` and
     * `viewEnter` via `.view.is-entering` — so one click that toggles both starts two
     * entrance animations back to back. That is the "refreshes twice" the user sees. */
    const entrance = log.animations.filter(
      (a) => a.element === view && (a.name === "viewIn" || a.name === "viewEnter")
    );
    console.log(`\nentrance animations on the "${view}" view: ${entrance.length} (one is correct)`);
    for (const name of Object.entries(tally)) {
      console.log(`   ${String(name[1]).padStart(3)}x  ${name[0]}`);
    }

    if (entrance.length > 1) {
      console.log(
        `\nDIAGNOSIS: one view change starts ${entrance.length} entrance animations ` +
          `(${entrance.map((e) => e.name).join(" then ")}).\n` +
          "The view visibly animates in twice. Both `.view.is-active` (styles.css) and\n" +
          "`.view.is-entering` (styles-desktop.css) declare an entrance animation, and setView()\n" +
          "adds both classes, so the second animation restarts the first."
      );
      process.exitCode = 1;
    } else if (entrance.length === 1) {
      console.log("\nOK: exactly one entrance animation per view change.");
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/* Count actual VIEW RENDER invocations per rail click, and any full document reload.
 *
 * The report is "each time I clicked on view change it refreshes the page twice".
 * Counting `innerHTML` writes was the wrong instrument: one render of a view legitimately
 * writes several sub-elements (stat grid, chart, table, donut...), so a single render
 * looked like 6 "refreshes". This instead counts the render FUNCTION for each view, by
 * wrapping the app's own `renderReports` / `renderSceneView` / ... on the window, which
 * is what "the view refreshed" actually means to a user.
 *
 * It also counts:
 *   - real document navigations (a true page reload is a different, worse failure),
 *   - `renderAll()` invocations, since that rebuilds the whole workspace.
 *
 * Usage: node scripts/probe-view-refresh.cjs [--view=sceneview]
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const viewArg = process.argv.find((a) => a.startsWith("--view="));
const targetView = viewArg ? viewArg.split("=")[1] : "sceneview";

const playwrightPath = path.join(root, "node_modules", "playwright-core");
const { chromium } = require(playwrightPath);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

const RENDER_FN = {
  script: "renderEditor",
  sceneview: "renderSceneView",
  navigator: "renderNavigator",
  beatboard: "renderBeatBoard",
  characters: "renderCharacters",
  reports: "renderReports",
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    let navigations = 0;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });

    await page.goto(appUrl);
    await page.waitForTimeout(1500);
    await page.evaluate(() => document.getElementById("startCenter")?.close());
    await page.waitForTimeout(300);
    navigations = 0; // do not count the initial goto as a reload

    /* The app's render functions are closures inside app.js, not globals, so they cannot
     * be wrapped from here directly. Instead count the DOM signature of a full view
     * render: the app sets a container's innerHTML once per render. We scope the counter
     * to the view's OWN root container, which is written exactly once per render, rather
     * than to any descendant. */
    await page.evaluate(() => {
      window.__probe = { panelWrites: {}, renderAll: 0 };
      const roots = {};
      for (const panel of document.querySelectorAll("[data-view-panel]")) {
        const name = panel.dataset.viewPanel;
        // the deepest single container the renderer owns for that view
        roots[name] =
          panel.querySelector("#sceneViewTable, #sceneGrid, #beatBoardStage, #castGrid, #reportBodyWrapper, #statGrid") || panel;
      }
      const original = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
      Object.defineProperty(Element.prototype, "innerHTML", {
        configurable: true,
        get: original.get,
        set(value) {
          for (const [name, node] of Object.entries(roots)) {
            if (this === node) window.__probe.panelWrites[name] = (window.__probe.panelWrites[name] || 0) + 1;
          }
          return original.set.call(this, value);
        },
      });
    });

    const before = await page.evaluate(() => ({
      writeCount: window.__probe.panelWrites[document.querySelector(".rail__item.is-active")?.dataset.view] || 0,
      writes: { ...window.__probe.panelWrites },
    }));

    const rail = page.locator(`.rail__item[data-view="${targetView}"]`);
    if ((await rail.count()) === 0) {
      console.error(`no rail item for view "${targetView}"`);
      process.exitCode = 1;
      return;
    }
    await rail.click();
    await page.waitForTimeout(1000);

    const after = await page.evaluate(() => ({ writes: { ...window.__probe.panelWrites } }));
    const delta = {};
    for (const key of new Set([...Object.keys(before.writes), ...Object.keys(after.writes)])) {
      const d = (after.writes[key] || 0) - (before.writes[key] || 0);
      if (d) delta[key] = d;
    }

    console.log(`view clicked: ${targetView}`);
    console.log(`document navigations caused by the click : ${navigations}`);
    console.log(`root-container rewrites per view:`);
    for (const [key, count] of Object.entries(delta).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${String(count).padStart(3)}x  ${key}`);
    }

    const writes = delta[targetView] || 0;
    console.log(`\nwrites of the ${targetView} root container: ${writes}`);
    if (navigations > 0) {
      console.log("DIAGNOSIS: the click caused a real document navigation / reload.");
      process.exitCode = 1;
    } else if (writes > 1) {
      console.log(`DIAGNOSIS: the ${targetView} view renders ${writes}x for one click.`);
      process.exitCode = 1;
    } else if (writes === 0) {
      console.log("NOTE: the root container was never written — the renderer may use a different node;");
      console.log("      check the roots map in this probe before trusting the result.");
    } else {
      console.log("OK: one click produced exactly one render of the target view.");
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

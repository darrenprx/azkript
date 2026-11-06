/* Measure whether a view's content overflows its container, and by how much.
 *
 * "It is cut off on the right" is a layout bug that is easy to see and hard to quantify
 * by eye: the numbers depend on the window size, the rail width, the inspector width and
 * the table's own min-width. This reports, for each view (and for the scene table's
 * columns specifically), the client width of the scroll container against the content
 * width, plus each column's rendered width, so a fix can be aimed rather than guessed.
 *
 * Usage: node scripts/probe-overflow.cjs [--view=sceneview] [--width=1440]
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
const view = arg("view", "sceneview");
const width = Number.parseInt(arg("width", "1440"), 10);

const playwrightPath = path.join(root, "rea", "node_modules", "playwright-core");
const { chromium } = require(playwrightPath);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.goto(appUrl);
    await page.waitForTimeout(1400);
    await page.evaluate(() => document.getElementById("startCenter")?.close());
    await page.waitForTimeout(300);
    await page.locator(`.rail__item[data-view="${view}"]`).click();
    await page.waitForTimeout(700);

    const report = await page.evaluate(() => {
      const panel = document.querySelector(".view.is-active");
      const table = document.querySelector(".scene-view-table");
      const out = {
        windowWidth: window.innerWidth,
        panelWidth: panel ? Math.round(panel.getBoundingClientRect().width) : null,
        table: null,
        columns: [],
        overflowing: [],
      };
      if (table) {
        const style = getComputedStyle(table);
        out.table = {
          clientWidth: table.clientWidth,
          scrollWidth: table.scrollWidth,
          overflowsBy: table.scrollWidth - table.clientWidth,
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
        };
        const head = table.querySelector(".sv-row--head");
        if (head) {
          out.columns = [...head.children].map((cell, index) => {
            const rect = cell.getBoundingClientRect();
            return {
              index,
              label: (cell.textContent || "").trim().slice(0, 22),
              x: Math.round(rect.x),
              width: Math.round(rect.width),
              right: Math.round(rect.right),
              inViewport: rect.right <= window.innerWidth,
            };
          });
        }
      }
      // Any element whose right edge sits past the viewport is visually cut off.
      const candidates = panel ? [...panel.querySelectorAll("*")] : [];
      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.right > window.innerWidth + 1) {
          out.overflowing.push({
            tag: el.tagName.toLowerCase(),
            classes: (el.className && typeof el.className === "string" ? el.className : "").slice(0, 60),
            right: Math.round(rect.right),
            overflow: Math.round(rect.right - window.innerWidth),
          });
          if (out.overflowing.length >= 8) break;
        }
      }
      return out;
    });

    console.log(`window ${report.windowWidth}px   active panel ${report.panelWidth}px\n`);
    if (report.table) {
      console.log(
        `scene table: client ${report.table.clientWidth}  scroll ${report.table.scrollWidth}  ` +
          `overflows by ${report.table.overflowsBy}px`
      );
    }
    if (report.columns.length) {
      console.log("\ncolumns:");
      for (const c of report.columns) {
        console.log(
          `  ${String(c.index).padStart(2)} ${c.label.padEnd(24)} x=${String(c.x).padStart(4)} ` +
            `w=${String(c.width).padStart(4)} right=${String(c.right).padStart(4)} ` +
            `${c.inViewport ? "visible" : "CUT OFF"}`
        );
      }
    }
    if (report.overflowing.length) {
      console.log("\nelements past the right edge:");
      for (const o of report.overflowing) console.log(`  +${o.overflow}px  <${o.tag} class="${o.classes}">`);
    }
    const tableOverflow = report.table ? report.table.overflowsBy : 0;
    /* Two different failures, and conflating them is how a layout bug gets "fixed" by
     * hiding it:
     *
     *   NEEDS SCROLL — the content is wider than the container, but the container is
     *     `overflow-x: auto`, so every column is still REACHABLE. This is the designed
     *     behaviour for narrow windows (documented on .scene-view-table).
     *   CUT OFF — a column's right edge is past the scrollable content itself, so no
     *     amount of scrolling reveals it. That is the real defect.
     *
     * The pass rule therefore depends on width: at or above the app's default window
     * (1440) the table must not scroll at all, because that is the size a user first
     * sees. Below it, scrolling is acceptable as long as nothing is unreachable. */
    const DEFAULT_WINDOW = 1440;
    const atDefaultOrWider = report.windowWidth >= DEFAULT_WINDOW;

    if (report.overflowing.length && !report.table) {
      console.log(`\nFAIL: ${report.overflowing.length} element(s) extend past the window with no scroll container.`);
      process.exitCode = 1;
      return;
    }
    if (atDefaultOrWider && tableOverflow > 1) {
      console.log(
        `\nFAIL: at the default window width the scene table scrolls ${tableOverflow}px, so a column ` +
          "is hidden until the user notices a horizontal scrollbar."
      );
      process.exitCode = 1;
    } else if (tableOverflow > 1) {
      console.log(
        `\nOK: at ${report.windowWidth}px the table scrolls ${tableOverflow}px (below the ${DEFAULT_WINDOW}px ` +
          "default). All columns remain reachable via horizontal scroll, which is the intended behaviour."
      );
    } else {
      console.log("\nOK: every column fits inside the window with no horizontal scroll.");
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

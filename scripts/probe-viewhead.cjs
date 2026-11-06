/* Measure the view-head tool rows: are the pills laid out as a flex row, or are they
 * wrapping inline boxes with baseline alignment?
 *
 * Report: "this button also don't align with other on horizontal". The Beat Board head
 * shows New Beat / New Structure Point on one line, then the Align Beats select and Snap
 * Grid on the next, then Send to Script on a third — three ragged rows where the design
 * intends one row of equal-height controls.
 *
 * Usage: node scripts/probe-viewhead.cjs [--view=beatboard]
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

const VIEWS = ["script", "sceneview", "navigator", "beatboard", "characters", "reports"];

const READ = () => {
  const out = [];
  for (const tools of document.querySelectorAll(".view-head__tools")) {
    if (!tools.offsetWidth) continue;
    const cs = getComputedStyle(tools);
    const panel = tools.closest("[data-view-panel]");
    out.push({
      panel: panel ? panel.dataset.viewPanel : "?",
      display: cs.display,
      gap: cs.gap,
      wrap: cs.flexWrap,
      alignItems: cs.alignItems,
      justify: cs.justifyContent,
      width: Math.round(tools.getBoundingClientRect().width),
      height: Math.round(tools.getBoundingClientRect().height),
      children: [...tools.children].map((child) => {
        const b = child.getBoundingClientRect();
        const c = getComputedStyle(child);
        return {
          tag: child.tagName.toLowerCase(),
          cls: typeof child.className === "string" ? child.className.trim() : "",
          text: (child.textContent || "").trim().replace(/\s+/g, " ").slice(0, 26),
          x: Math.round(b.left),
          y: Math.round(b.top),
          w: Math.round(b.width),
          h: Math.round(b.height),
          display: c.display,
          // inline-level boxes with no shared row => ragged multi-line toolbar
        };
      }),
    });
  }
  return out;
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    for (const view of VIEWS) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(appUrl);
      await page.waitForTimeout(1500);
      await page.evaluate(() => document.getElementById("startCenter")?.close());
      await page.evaluate((v) => document.querySelector(`.rail__item[data-view="${v}"]`)?.click(), view);
      await page.waitForTimeout(650);
      const rows = (await page.evaluate(READ)).filter((r) => r.panel === view);
      for (const row of rows) {
        console.log(`\n== ${row.panel} ==  display=${row.display} gap=${row.gap} align=${row.alignItems}`);
        console.log(`   container ${row.width}x${row.height}`);
        const lines = new Set(row.children.map((c) => c.y));
        for (const c of row.children) {
          console.log(`   y=${String(c.y).padEnd(4)} x=${String(c.x).padEnd(4)} h=${String(c.h).padEnd(3)} ${c.display.padEnd(11)} "${c.text}"`);
        }
        console.log(`   rows: ${lines.size}${lines.size > 1 ? "  <-- RAGGED (not a single row)" : ""}`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

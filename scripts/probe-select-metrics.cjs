/* Measure select heights and vertical alignment across EVERY surface, including
 * dialogs and widgets, to catch metric drift the view-head work does not touch.
 *
 * The inventory flagged: assign-voices selects at 24px vs 36px elsewhere, and the
 * read-dock selects 4px taller than the buttons beside them. Those are the same class
 * of defect as the tool-row alignment ("this button also don't align with other on
 * horizontal") one level down, so they need numbers, not eyeballing.
 *
 * Usage: node scripts/probe-select-metrics.cjs
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const { chromium } = require(path.join(root, "rea", "node_modules", "playwright-core"));
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

const MEASURE = () => {
  const rows = [];
  for (const el of document.querySelectorAll("select")) {
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    const cs = getComputedStyle(el);
    // Find the closest visible sibling button, to compare centre lines.
    const parent = el.parentElement;
    let peer = null;
    if (parent) {
      for (const sib of parent.querySelectorAll("button")) {
        const sb = sib.getBoundingClientRect();
        if (!sb.width || !sb.height) continue;
        if (Math.abs((sb.top + sb.bottom) / 2 - (b.top + b.bottom) / 2) > 40) continue;
        peer = {
          label: (sib.textContent || "").trim().slice(0, 18) || sib.id || sib.className,
          h: Math.round(sb.height),
          deltaMidY: Math.round((b.top + b.bottom) / 2 - (sb.top + sb.bottom) / 2),
        };
        break;
      }
    }
    rows.push({
      id: el.id || "(anon)",
      context: (el.closest("dialog[open]") ? "dialog:" + (el.closest("dialog[open]").id || "?") : el.closest(".read-dock") ? "read-dock" : el.closest(".sprint-widget") ? "sprint" : el.closest("[data-view-panel]")?.dataset.viewPanel || "shell"),
      h: Math.round(b.height),
      radius: cs.borderRadius,
      font: `${cs.fontSize}/${cs.fontWeight}`,
      peer,
    });
  }
  return rows;
};

const DIALOGS = [
  ["#settingsButton", "settings"],
  ["#pageSetupButton", "page setup"],
  ["#charAssignVoicesBtn", "assign voices", "characters"],
];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const all = [];
  try {
    for (const [selector, label, view] of DIALOGS) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(appUrl);
      await page.waitForTimeout(1500);
      await page.evaluate(() => document.getElementById("startCenter")?.close());
      if (view) {
        await page.evaluate((v) => document.querySelector(`.rail__item[data-view="${v}"]`)?.click(), view);
        await page.waitForTimeout(400);
      }
      const opened = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        el.click();
        return true;
      }, selector);
      await page.waitForTimeout(800);
      if (opened) {
        for (const row of await page.evaluate(MEASURE)) all.push({ ...row, context: `dialog:${label}` });
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`${all.length} select instance(s) in dialogs\n`);
  const byContext = new Map();
  for (const row of all) {
    if (!byContext.has(row.context)) byContext.set(row.context, []);
    byContext.get(row.context).push(row);
  }
  for (const [context, rows] of byContext) {
    const heights = [...new Set(rows.map((r) => r.h))];
    console.log(`${context}: heights ${JSON.stringify(heights)} (${rows.length} controls)`);
    const seen = new Set();
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const align = row.peer
        ? `peer ${row.peer.h}px ΔmidY=${row.peer.deltaMidY}${Math.abs(row.peer.deltaMidY) > 1 ? "  <-- MISALIGNED" : ""}`
        : "no peer";
      console.log(`   ${row.id.padEnd(24)} h=${String(row.h).padEnd(3)} r=${row.radius.padEnd(5)} ${row.font.padEnd(12)} ${align}`);
    }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

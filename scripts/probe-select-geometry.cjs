/* Report computed geometry of the OPEN select popup and its option rows.
 *
 * The popup is app-drawn now, but the option rows came out horizontally centred
 * instead of left-aligned in a checkmark gutter. This measures what the option box
 * actually is so the rule that fixes it can be written against real values.
 *
 * Usage: node scripts/probe-select-geometry.cjs
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const { chromium } = require(path.join(root, "node_modules", "playwright-core"));
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(appUrl);
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.getElementById("startCenter")?.close());
  await page.evaluate(() => document.querySelector('.rail__item[data-view="beatboard"]')?.click());
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector("#beatAlignSelect")?.showPicker());
  await page.waitForTimeout(400);

  const report = await page.evaluate(() => {
    const sel = document.querySelector("#beatAlignSelect");
    const cs = getComputedStyle(sel);
    const out = {
      select: {
        appearance: cs.appearance,
        display: cs.display,
        width: Math.round(sel.getBoundingClientRect().width),
        height: Math.round(sel.getBoundingClientRect().height),
      },
      options: [],
    };
    for (const opt of sel.options) {
      const c = getComputedStyle(opt);
      const b = opt.getBoundingClientRect();
      out.options.push({
        label: opt.textContent,
        checked: opt.selected,
        display: c.display,
        justifyContent: c.justifyContent,
        textAlign: c.textAlign,
        paddingLeft: c.paddingLeft,
        gap: c.gap,
        width: Math.round(b.width),
        left: Math.round(b.left),
        // Where the first text run actually starts, which is what the eye sees.
        textLeft: (() => {
          const range = document.createRange();
          range.selectNodeContents(opt);
          const r = range.getBoundingClientRect();
          return Math.round(r.left);
        })(),
      });
    }
    return out;
  });
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

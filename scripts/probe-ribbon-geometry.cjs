/* Exact vertical geometry of the three ribbon groups whose content overflows into the
 * caption band: "Insert" (home), "Editing" (edit), "Tools" (tools).
 *
 * The outline of the fix depends on the real numbers: how tall each row item is, what
 * gap is in play, how much room the body actually has, and whether the group can simply
 * grow. This prints the whole chain per group.
 *
 * Usage: node scripts/probe-ribbon-geometry.cjs
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const { chromium } = require(path.join(root, "rea", "node_modules", "playwright-core"));
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

const TARGETS = [
  ["home", "Insert"],
  ["edit", "Editing"],
  ["tools", "Tools"],
  // A group that fits, for comparison.
  ["home", "Script Elements"],
];

const MEASURE = (groupName) => {
  const panel = document.querySelector(".ribbon-tab-panel.is-active");
  if (!panel) return { error: "no active panel" };
  let group = null;
  for (const g of panel.querySelectorAll(".ribbon-group")) {
    const lbl = g.querySelector(".ribbon-group__label");
    if ((lbl.textContent || "").trim() === groupName) group = g;
  }
  if (!group) return { error: `group "${groupName}" not found` };
  const gcs = getComputedStyle(group);
  const gbox = group.getBoundingClientRect();
  const body = group.querySelector(".ribbon-group__body");
  const bcs = getComputedStyle(body);
  const bbox = body.getBoundingClientRect();
  const label = group.querySelector(".ribbon-group__label");
  const lbox = label.getBoundingClientRect();
  const deck = group.closest(".ribbon-tab-panel");
  const bar = document.getElementById("ribbonBar");
  const barBox = bar.getBoundingClientRect();

  const rows = [...body.children].map((row) => {
    const rcs = getComputedStyle(row);
    const rbox = row.getBoundingClientRect();
    return {
      cls: row.className,
      top: Math.round(rbox.top),
      bottom: Math.round(rbox.bottom),
      h: Math.round(rbox.height),
      gap: rcs.gap,
      items: [...row.children].map((el) => {
        const ebox = el.getBoundingClientRect();
        const ecs = getComputedStyle(el);
        return {
          cls: el.className,
          h: Math.round(ebox.height),
          top: Math.round(ebox.top),
          bottom: Math.round(ebox.bottom),
          gap: ecs.gap,
          padding: ecs.padding,
          inner: [...el.querySelectorAll("button")].map((b) => {
            const bb = b.getBoundingClientRect();
            return { cls: b.className, h: Math.round(bb.height), text: (b.textContent || "").trim().slice(0, 16) };
          }),
        };
      }),
    };
  });

  return {
    group: groupName,
    ribbonBar: { top: Math.round(barBox.top), height: Math.round(barBox.height) },
    panelHeight: Math.round(deck.getBoundingClientRect().height),
    group: {
      height: Math.round(gbox.height),
      padding: gcs.padding,
      rowGap: gcs.rowGap,
      flexDirection: gcs.flexDirection,
      justifyContent: gcs.justifyContent,
    },
    body: {
      height: Math.round(bbox.height),
      scrollHeight: body.scrollHeight,
      gap: bcs.gap,
      flex: bcs.flex,
      minHeight: bcs.minHeight,
      overflow: bcs.overflow,
      justifyContent: bcs.justifyContent,
    },
    caption: { top: Math.round(lbox.top), bottom: Math.round(lbox.bottom), height: Math.round(lbox.height) },
    contentOverflow: body.scrollHeight - Math.round(bbox.height),
    rows,
  };
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(appUrl);
  await page.waitForTimeout(1600);
  await page.evaluate(() => document.getElementById("startCenter")?.close());
  await page.waitForTimeout(250);
  for (const [tab, group] of TARGETS) {
    await page.evaluate((t) => document.querySelector(`[data-ribbon-tab="${t}"]`)?.click(), tab);
    await page.waitForTimeout(400);
    const info = await page.evaluate(MEASURE, group);
    console.log(`\n===== tab:${tab} group:"${group}" =====`);
    console.log(JSON.stringify(info, null, 2));
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

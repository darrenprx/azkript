/* Measure the ribbon group body's CONTENT overflow, not just its box.
 *
 * The first version of this probe measured `.ribbon-group__body`'s own bounding box
 * and reported no overlap — wrong, because the body is a flex container with
 * `min-height: 0` and the content simply overflows past it. `getBoundingClientRect()`
 * returns the clipped box, so the probe passed while a caption sat on top of the
 * "Emoji" button in the screenshot. This measures the CONTROLS, which is what the eye
 * sees.
 *
 * Usage: node scripts/probe-ribbon-fit.cjs
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const { chromium } = require(path.join(root, "rea", "node_modules", "playwright-core"));
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

const TABS = ["home", "file", "edit", "view", "format", "insert", "document", "tools", "production", "help"];

const READ = () => {
  const out = [];
  const panel = document.querySelector(".ribbon-tab-panel.is-active");
  if (!panel) return out;
  for (const group of panel.querySelectorAll(".ribbon-group")) {
    const label = group.querySelector(".ribbon-group__label");
    const body = group.querySelector(".ribbon-group__body");
    const lbox = label.getBoundingClientRect();
    const bcs = getComputedStyle(body);
    // Every interactive control in the body, plus its real painted bottom.
    const controls = [...body.querySelectorAll("button, .rb-combo, .rb-swatch, .rb-sep")];
    const intruders = [];
    let deepest = -Infinity;
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      if (r.height === 0) continue;
      deepest = Math.max(deepest, r.bottom);
      if (r.bottom > lbox.top + 0.5) {
        intruders.push({
          label: (el.getAttribute("aria-label") || el.getAttribute("data-tooltip") || el.textContent || "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 22),
          bottom: Math.round(r.bottom),
          overBy: Math.round(r.bottom - lbox.top),
        });
      }
    }
    // Does the body's own scrollHeight exceed its client box? That is the overflow.
    const contentOverflow = body.scrollHeight - body.clientHeight;
    /* Clipped button LABELS.
     *
     * The first version of this probe only looked for caption/control overlap, and so
     * missed the largest defect in the ribbon: twelve two-line labels were cut
     * horizontally through their lower half because the 66px `.rb-btn--large` could
     * not hold icon + gap + two lines. A label is clipped when its own scrollHeight
     * exceeds its clientHeight (the -webkit-line-clamp box) or when its painted bottom
     * passes the button's content edge. Both are checked; either is a defect. */
    const clipped = [];
    for (const btn of group.querySelectorAll(".rb-btn--large, .rb-btn--small, .rb-combo")) {
      const label = btn.querySelector(".rb-btn__label, .rb-combo__value");
      if (!label) continue;
      const lcs = getComputedStyle(label);
      const bcs2 = getComputedStyle(btn);
      const lbox2 = label.getBoundingClientRect();
      const bbox2 = btn.getBoundingClientRect();
      const contentBottom =
        bbox2.bottom - (parseFloat(bcs2.paddingBottom) || 0) - (parseFloat(bcs2.borderBottomWidth) || 0);
      const verticalClip = label.scrollHeight > label.clientHeight + 1;
      const horizontalClip = label.scrollWidth > label.clientWidth + 1;
      const spillsOut = Math.round(lbox2.bottom - contentBottom);
      if (verticalClip || horizontalClip || spillsOut > 0) {
        clipped.push({
          text: (label.textContent || "").trim(),
          labelH: Math.round(lbox2.height),
          scrollH: label.scrollHeight,
          clientH: label.clientHeight,
          spillsOut,
          verticalClip,
          horizontalClip,
        });
      }
    }
    out.push({
      group: (label.textContent || "").trim(),
      h: Math.round(group.getBoundingClientRect().height),
      bodyBoxH: Math.round(body.getBoundingClientRect().height),
      bodyScrollH: body.scrollHeight,
      contentOverflow,
      overflowY: bcs.overflowY,
      deepestControlBottom: Number.isFinite(deepest) ? Math.round(deepest) : null,
      captionTop: Math.round(lbox.top),
      overlapPx: Number.isFinite(deepest) ? Math.round(deepest - lbox.top) : 0,
      intruders: intruders.slice(0, 6),
      clipped,
      truncated: [...group.querySelectorAll(".rb-btn__label, .rb-combo__value")]
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.textContent.trim()),
    });
  }
  return out;
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  let overlaps = 0;
  let truncations = 0;
  let clippedLabels = 0;
  try {
    for (const width of [1440, 1100, 900]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(appUrl);
      await page.waitForTimeout(1600);
      await page.evaluate(() => document.getElementById("startCenter")?.close());
      await page.waitForTimeout(250);
      console.log(`\n########## width ${width} ##########`);
      for (const tab of TABS) {
        const ok = await page.evaluate((t) => {
          const b = document.querySelector(`[data-ribbon-tab="${t}"]`);
          if (!b) return false;
          b.click();
          return true;
        }, tab);
        if (!ok) continue;
        await page.waitForTimeout(380);
        const rows = await page.evaluate(READ);
        const bad = rows.filter((r) => r.intruders.length);
        if (bad.length) {
          overlaps += bad.length;
          console.log(`  ${tab}: ${bad.length} group(s) with caption/control overlap`);
          for (const r of bad) {
            console.log(
              `     ${r.group.padEnd(16)} h=${r.h} body=${r.bodyBoxH} scrollH=${r.bodyScrollH} ` +
                `deepest=${r.deepestControlBottom} captionTop=${r.captionTop} OVER +${r.overlapPx}px`
            );
            for (const i of r.intruders) console.log(`        "${i.label}" bottom=${i.bottom} +${i.overBy}px`);
          }
        }
        // Clipped labels, reported even when the group does not overlap its caption.
        for (const r of rows) {
          for (const c of r.clipped) {
            clippedLabels += 1;
            console.log(
              `  ${tab}: ${r.group.padEnd(14)} label "${c.text}" CLIPPED ` +
                `labelH=${c.labelH} scrollH=${c.scrollH} clientH=${c.clientH} spillsOut=${c.spillsOut}` +
                `${c.horizontalClip ? " (horizontal)" : ""}`
            );
          }
        }
        const tr = rows.filter((r) => r.truncated.length);
        if (tr.length) {
          truncations += tr.length;
          for (const r of tr) console.log(`  ${tab}: ${r.group} truncated: ${r.truncated.join(", ")}`);
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(
    `\nTOTAL: ${overlaps} group(s) with caption overlap; ${clippedLabels} clipped label(s); ${truncations} with truncation`
  );
  process.exitCode = overlaps || clippedLabels ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

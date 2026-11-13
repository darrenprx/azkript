/* Guard the ribbon's LAYOUT FIT: no group caption may overlap a control, and no
 * button label may be clipped.
 *
 * Two separate user reports led here, and each needed a different assertion:
 *
 * 1. "small ui conflict still exist, consider widen" — with a screenshot of the Insert
 *    group where the "INSERT" caption sat on top of the Emoji icon. Cause: a
 *    `.ribbon-col` of four 23px buttons needs 98px but the group body only gets the
 *    81px left inside the ribbon's fixed 104px track, and the body has
 *    `overflow: visible`, so the content simply overflowed into the caption band.
 *
 * 2. A screenshot of the Document tab where "Target Script Length" was cut through the
 *    middle. Cause: `.rb-btn--large` was 66px tall, and icon (23) + gap (5) + a
 *    TWO-LINE label (2 x 14.16) needs 56.32px of content against the 52px available
 *    after `padding: 8px 6px 4px` and the border. Twelve labels were affected.
 *
 * Why this is a runtime test and not a static one: both defects are the product of
 * computed geometry — flex shrink, line-height, clamped line counts, absolute caption
 * positioning — and the earlier static CSS test could not see either. It also could not
 * have: the stylesheet was self-consistent, the content just did not fit.
 *
 * Requires Chrome + node_modules/playwright-core; skips cleanly when absent.
 *
 * Run: node app/tests/ribbon-fit.cjs
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const playwrightPath = path.join(root, "node_modules", "playwright-core");
if (!fs.existsSync(playwrightPath)) {
  console.log("SKIP: node_modules/playwright-core is not installed");
  process.exit(0);
}
const { chromium } = require(playwrightPath);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

const TABS = ["home", "file", "edit", "view", "format", "insert", "document", "tools", "production", "help"];

/* Measured inside the page so the geometry is the browser's own. */
const READ = () => {
  const out = [];
  const panel = document.querySelector(".ribbon-tab-panel.is-active");
  if (!panel) return out;
  for (const group of panel.querySelectorAll(".ribbon-group")) {
    const caption = group.querySelector(".ribbon-group__label");
    if (!caption) continue;
    const captionTop = caption.getBoundingClientRect().top;
    const captionText = (caption.textContent || "").trim();

    // 1. Does any control reach past the caption's top edge?
    let deepest = -Infinity;
    let deepestLabel = "";
    for (const el of group.querySelectorAll(".ribbon-group__body button, .ribbon-group__body .rb-combo")) {
      const box = el.getBoundingClientRect();
      if (!box.height) continue;
      if (box.bottom > deepest) {
        deepest = box.bottom;
        deepestLabel = (el.getAttribute("aria-label") || el.getAttribute("data-tooltip") || el.textContent || "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 26);
      }
    }

    // 2. Is any button LABEL clipped? Checked two ways, because a clamped
    //    -webkit-box reports a client height smaller than its scroll height, while a
    //    label overflowing its button may not clamp at all.
    const clipped = [];
    for (const btn of group.querySelectorAll(".rb-btn--large, .rb-btn--small, .rb-combo")) {
      const label = btn.querySelector(".rb-btn__label, .rb-combo__value");
      if (!label) continue;
      const btnStyle = getComputedStyle(btn);
      const labelBox = label.getBoundingClientRect();
      const btnBox = btn.getBoundingClientRect();
      const contentBottom =
        btnBox.bottom - (parseFloat(btnStyle.paddingBottom) || 0) - (parseFloat(btnStyle.borderBottomWidth) || 0);
      const vertical = label.scrollHeight > label.clientHeight + 1;
      const horizontal = label.scrollWidth > label.clientWidth + 1;
      const spills = labelBox.bottom - contentBottom > 0.5;
      if (vertical || horizontal || spills) {
        clipped.push({
          text: (label.textContent || "").trim(),
          vertical,
          horizontal,
          spills: Math.round(labelBox.bottom - contentBottom),
          labelH: Math.round(labelBox.height),
          scrollH: label.scrollHeight,
        });
      }
    }

    out.push({
      caption: captionText,
      deepestBottom: Number.isFinite(deepest) ? deepest : null,
      deepestLabel,
      captionTop,
      overlapPx: Number.isFinite(deepest) ? Math.round(deepest - captionTop) : 0,
      clipped,
    });
  }
  return out;
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const problems = [];
  let groupsChecked = 0;
  let labelsChecked = 0;
  try {
    for (const [width, height] of [[1600, 900], [1440, 900], [1100, 800]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(appUrl);
      await page.waitForTimeout(1500);
      await page.evaluate(() => document.getElementById("startCenter")?.close());
      await page.waitForTimeout(200);
      for (const tab of TABS) {
        const clicked = await page.evaluate((t) => {
          const button = document.querySelector(`[data-ribbon-tab="${t}"]`);
          if (!button) return false;
          button.click();
          return true;
        }, tab);
        if (!clicked) {
          problems.push(`ribbon tab "${tab}" does not exist, so it was never measured`);
          continue;
        }
        await page.waitForTimeout(340);
        const groups = await page.evaluate(READ);
        if (!groups.length) {
          problems.push(`ribbon tab "${tab}" exposed zero groups at ${width}px — nothing was measured`);
          continue;
        }
        for (const group of groups) {
          groupsChecked += 1;
          labelsChecked += 1;
          if (group.overlapPx > 1) {
            problems.push(
              `[${tab} @ ${width}px] group "${group.caption}": its content overlaps the caption by ` +
                `${group.overlapPx}px (deepest control is "${group.deepestLabel}"). ` +
                "The ribbon row is a fixed 104px, so the group must fit inside it, not overflow it."
            );
          }
          for (const c of group.clipped) {
            problems.push(
              `[${tab} @ ${width}px] group "${group.caption}": label "${c.text}" is clipped ` +
                `(labelH=${c.labelH}, scrollH=${c.scrollH}` +
                `${c.vertical ? ", vertical" : ""}${c.horizontal ? ", horizontal" : ""}` +
                `${c.spills > 0 ? `, spills ${c.spills}px past the button` : ""}). ` +
                "A button label must be fully readable; grow the control or shorten the label."
            );
          }
        }
        // The deck must not overflow its scroller at the app's design width.
        if (width === 1600) {
          const overflow = await page.evaluate(() => {
            const scroller = document.getElementById("ribbonScroller");
            return scroller.scrollWidth - scroller.clientWidth;
          });
          if (overflow > 8) {
            problems.push(
              `[${tab} @ 1600px] the ribbon deck overflows its scroller by ${overflow}px ` +
                "(budget is 8px). A fix for a fit defect elsewhere must not widen the deck."
            );
          }
        }
      }
      assert.deepEqual(errors, [], `page errors at ${width}px: ${errors.join(" | ")}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }

  /* Vacuous-pass guards. This repo has been bitten before by a check that reported
   * PASS after measuring nothing, so both zero cases are failures here. */
  assert.ok(
    groupsChecked >= TABS.length * 3 * 2,
    `measured only ${groupsChecked} ribbon group(s) across ${TABS.length} tabs x 3 widths; ` +
      "a green result on a handful of groups is not a green ribbon"
  );
  assert.ok(
    labelsChecked >= groupsChecked,
    `measured ${labelsChecked} label group(s) for ${groupsChecked} group(s); the label check never ran`
  );

  assert.deepEqual(problems, [], `ribbon layout defects:\n  ${problems.join("\n  ")}`);
  console.log(`PASS: ${TABS.length} tabs x 3 widths — ${groupsChecked} groups, no caption overlap, no clipped label`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

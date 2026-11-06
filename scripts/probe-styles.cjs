/* Dump computed styles for a view's elements, to find what is falling back to defaults.
 *
 * An element that renders with user-agent defaults is hard to spot by reading CSS: the
 * rule may be missing entirely, or it may exist but not match because the class was
 * renamed. This reports, per element, whether it looks styled (has a background,
 * border, padding or radius that differs from the UA default) and what its computed
 * font/box actually is.
 *
 * Usage: node scripts/probe-styles.cjs --view=sceneview [--dark] [--selector=.sv-cell]
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
const dark = process.argv.includes("--dark");
const only = arg("selector", null);

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
    await page.waitForTimeout(1400);
    await page.evaluate(() => document.getElementById("startCenter")?.close());
    await page.waitForTimeout(250);

    if (dark) {
      for (let i = 0; i < 3; i += 1) {
        const theme = await page.evaluate(() => document.documentElement.dataset.theme);
        if (theme === "dark") break;
        await page.locator("#themeToggle").click();
        await page.waitForTimeout(420);
      }
    }

    await page.locator(`.rail__item[data-view="${view}"]`).click();
    await page.waitForTimeout(700);

    const report = await page.evaluate((onlySelector) => {
      const panel = document.querySelector(`[data-view-panel="${document.querySelector('.rail__item.is-active')?.dataset.view}"]`);
      if (!panel) return { error: "active view panel not found" };
      const ua = (el) => {
        const s = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          classes: el.className && typeof el.className === "string" ? el.className : "",
          font: `${s.fontSize} / ${s.fontWeight} / ${s.lineHeight}`,
          color: s.color,
          background: s.backgroundColor,
          border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
          radius: s.borderRadius,
          padding: s.padding,
          width: Math.round(el.getBoundingClientRect().width),
          height: Math.round(el.getBoundingClientRect().height),
          // The tell for "unstyled": a background/border that is pure UA.
          appearance: s.appearance,
        };
      };

      const targets = onlySelector
        ? [...panel.querySelectorAll(onlySelector)]
        : [...panel.querySelectorAll("button, input, select, .sv-cell, .sv-row, .view-head__tools, .scene-view-card")];
      return {
        panel: panel.id || panel.dataset.viewPanel,
        count: targets.length,
        items: targets.slice(0, 40).map(ua),
      };
    }, only);

    if (report.error) {
      console.error(report.error);
      process.exitCode = 1;
      return;
    }
    console.log(`panel ${report.panel}: ${report.count} element(s)\n`);
    for (const item of report.items) {
      console.log(
        `<${item.tag} class="${item.classes}">\n` +
          `   font ${item.font}   color ${item.color}\n` +
          `   bg ${item.background}   border ${item.border}   radius ${item.radius}\n` +
          `   padding ${item.padding}   size ${item.width}x${item.height}   appearance ${item.appearance}`
      );
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

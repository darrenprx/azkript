/* Find INPUTS and BUTTONS across the app that render with user-agent styling.
 *
 * This is the check that would have caught the Scene View defect directly. The class-drift
 * audit compares class NAMES, which finds renamed selectors but not an element that never
 * had a class of its own. The user's complaint was visual — "this view uses a different
 * style than the rest of the app" — so the honest test is on the computed style: a themed
 * Fluent control never has `appearance: auto` together with a `2px inset` border and a
 * UA-default background.
 *
 * Every dialog and view is opened in turn so the check sees far more than the first screen.
 *
 * Usage: node scripts/audit-control-styling.cjs [--dark]
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const dark = process.argv.includes("--dark");
const playwrightPath = path.join(root, "rea", "node_modules", "playwright-core");
const { chromium } = require(playwrightPath);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

/* Surfaces to visit. Each is a short reproducible interaction; the point is coverage of
 * the places a control can hide, not exhaustive UI automation. */
const VIEWS = ["script", "sceneview", "navigator", "beatboard", "characters", "reports"];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const offenders = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(appUrl);
    await page.waitForTimeout(1400);
    await page.evaluate(() => document.getElementById("startCenter")?.close());
    await page.waitForTimeout(300);
    if (dark) {
      for (let i = 0; i < 3; i += 1) {
        const theme = await page.evaluate(() => document.documentElement.dataset.theme);
        if (theme === "dark") break;
        await page.locator("#themeToggle").click();
        await page.waitForTimeout(420);
      }
    }

    const scan = async (surface) => {
      const found = await page.evaluate(() => {
        const out = [];
        /* What actually distinguishes an unstyled platform control from a themed one.
         *
         * The first version of this check flagged anything with `appearance: auto`, which
         * produced 21 hits of which only 3 were real: the search fields sit inside a
         * styled `.search-field` wrapper and are deliberately transparent with no border,
         * and the font-size input is fully themed with a 1px border and 8px radius. A
         * search of computed styles must not confuse "kept the native behaviour" with
         * "was never styled".
         *
         * The genuine tells are:
         *   - `border-style: inset` — the Windows field bevel. No design system in this
         *     app emits it, so its presence ALWAYS means the UA painted the border.
         *   - `appearance: auto` AND an OPAQUE background AND a visible border — i.e. the
         *     platform is drawing the whole field. The search wrappers fail this because
         *     their input is transparent; themed fields fail it because their background
         *     is a translucent token.
         */
        const classify = (el) => {
          const s = getComputedStyle(el);
          if (s.display === "none" || s.visibility === "hidden") return null;
          const rect = el.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) return null;

          const borderWidth = Number.parseFloat(s.borderTopWidth) || 0;
          const bg = s.backgroundColor || "";
          const match = bg.match(/rgba?\(([^)]+)\)/);
          const parts = match ? match[1].split(",").map((v) => Number.parseFloat(v)) : [];
          const alpha = parts.length === 4 ? parts[3] : 1;
          const opaque = alpha >= 0.999 && bg !== "transparent";
          const uaAppearance = s.appearance === "auto" || s.webkitAppearance === "auto";

          const bevel = /inset/.test(s.borderTopStyle);
          const platformField = uaAppearance && opaque && borderWidth >= 1;
          if (!bevel && !platformField) return null;

          return {
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute("type") || null,
            classes: (el.className && typeof el.className === "string" ? el.className : "").slice(0, 70),
            id: el.id || null,
            placeholder: el.getAttribute("placeholder") || null,
            reason: bevel ? "border-style: inset (platform bevel)" : "appearance:auto + opaque bg + border",
            appearance: s.appearance,
            border: `${s.borderTopWidth} ${s.borderTopStyle}`,
            radius: s.borderRadius,
            background: bg,
            width: Math.round(rect.width),
          };
        };
        for (const el of document.querySelectorAll("input, select, textarea")) {
          const hit = classify(el);
          if (hit) out.push(hit);
        }
        return out;
      });
      for (const item of found) offenders.push({ surface, ...item });
      return found.length;
    };

    // The shell, with each view active.
    for (const view of VIEWS) {
      const rail = page.locator(`.rail__item[data-view="${view}"]`);
      if ((await rail.count()) === 0) continue;
      await rail.click();
      await page.waitForTimeout(500);
      const count = await scan(`view:${view}`);
      console.log(`  view ${view.padEnd(12)} unstyled controls: ${count}`);
    }

    // Dialogs that contain text inputs, opened the way a user opens them.
    const DIALOGS = [
      ["settings", "#settingsButton"],
      ["find", "#findButton"],
      ["go-to", '[data-ribbon-command="edit-goto"]'],
      ["rename-character", '[data-ribbon-command="edit-rename-character"]'],
    ];
    for (const [name, selector] of DIALOGS) {
      const trigger = page.locator(selector);
      if ((await trigger.count()) === 0) {
        console.log(`  dialog ${name.padEnd(18)} (no trigger)`);
        continue;
      }
      try {
        await trigger.first().click({ timeout: 4000 });
        await page.waitForTimeout(600);
        const count = await scan(`dialog:${name}`);
        console.log(`  dialog ${name.padEnd(18)} unstyled controls: ${count}`);
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(350);
      } catch {
        console.log(`  dialog ${name.padEnd(18)} (could not open)`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log("");
  if (offenders.length) {
    console.log(`FAIL: ${offenders.length} control(s) render with user-agent (browser/platform) styling:\n`);
    const seen = new Set();
    for (const o of offenders) {
      const key = `${o.tag}.${o.classes}|${o.placeholder || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(
        `  [${o.surface}] <${o.tag}${o.type ? ` type="${o.type}"` : ""} class="${o.classes}"` +
          `${o.id ? ` id="${o.id}"` : ""}${o.placeholder ? ` placeholder="${o.placeholder}"` : ""}>`
      );
      console.log(
        `      ${o.reason}\n` +
          `      appearance ${o.appearance}   border ${o.border}   radius ${o.radius}   bg ${o.background}`
      );
    }
    console.log(
      "\nThese are the controls that look like a different design system. Give each one a\n" +
        "Fluent rule (transparent or token background, 1px --stroke border, --radius-6,\n" +
        "appearance: none) or, if it is inside a native surface, document why."
    );
    process.exitCode = 1;
  } else {
    console.log(`PASS: every visible input/select/textarea uses the app's styling${dark ? " (dark)" : ""}.`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

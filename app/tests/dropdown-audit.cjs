/* Exhaustive dropdown audit across EVERY view and dialog.
 *
 * The earlier dropdown test only sampled the selects visible in the default
 * script view (3 of them), so it passed green while three other selects sat at
 * border-radius 0px — `#cardsAcrossSelect`, `#beatAlignSelect` and
 * `#sprintDurationSelect`. That is the exact regression this file exists to catch,
 * so it now walks every view and every dialog that contains a select and records
 * what it finds.
 *
 * SECOND ROUND, second report: "there are still many drop down menu like this not
 * write as fluent". The round above fixed the CLOSED box only — it asserted
 * `appearance !== "none"` and a background-image chevron, because at the time the
 * open option list was drawn by the OS and could not be reached. That assertion is
 * now inverted: `appearance: none` leaves the popup to the platform, so what this
 * file must require is `appearance: base-select`, the opt-in that makes the open
 * list a real, app-styled element tree. It also requires that `::picker(select)` is
 * a supported selector in the running browser, so the assertion cannot silently pass
 * on a runtime that ignores `base-select` and keeps the native list.
 *
 * Two assertions therefore have to hold together, and they fail in opposite ways:
 *   - `appearance` must be `base-select`  (native `auto`/`none` => OS-drawn popup)
 *   - the picker pseudo must be supported (older runtime => base-select ignored)
 * Both are reported with the control's id so a regression names the actual control.
 *
 * Usage: node app/tests/dropdown-audit.cjs            (audit report, exit 0)
 *        node app/tests/dropdown-audit.cjs --strict   (fail on any inconsistency)
 */
"use strict";

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
const strict = process.argv.includes("--strict");

/** Read every visible select's styling signature in the current DOM. */
const READ_SELECTS = () => {
  const rows = [];
  // Feature detection for the app-drawn popup, mirroring the CSS opt-in.
  const pickerSupported = CSS.supports("selector(::picker(select))");
  for (const el of document.querySelectorAll("select")) {
    const box = el.getBoundingClientRect();
    if (!el.offsetWidth || !el.offsetHeight) continue;
    const cs = getComputedStyle(el);
    const icon = getComputedStyle(el, "::picker-icon");
    rows.push({
      id: el.id || "(anonymous)",
      cls: (el.className || "").toString().trim(),
      radius: cs.borderTopLeftRadius,
      appearance: cs.appearance,
      // The arrow is a pseudo-element now, not a background-image; assert the one
      // the stylesheet actually draws.
      pickerIcon: (icon.content || "none") !== "none",
      pickerSupported,
      paddingRight: parseFloat(cs.paddingRight) || 0,
      visible: box.width > 0,
    });
  }
  return rows;
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const seen = new Map(); // id -> row
  const problems = [];

  const record = (rows, context) => {
    for (const row of rows) {
      const prev = seen.get(row.id);
      if (!prev) seen.set(row.id, { ...row, contexts: [context] });
      else prev.contexts.push(context);

      /* The app-drawn popup is the requirement. `none` is the OLD correct answer
       * (app box, OS list) and must now be reported as a defect, not a pass. */
      if (row.appearance !== "base-select") {
        problems.push(
          `${row.id} (${context}) does not opt into an app-drawn popup: appearance=${row.appearance} ` +
            "(expected base-select; with auto/none the OPEN option list is drawn by the OS)"
        );
      }
      if (!row.pickerSupported) {
        problems.push(
          `${row.id} (${context}) is running on a browser without ::picker(select) support, so ` +
            "appearance:base-select is ignored and the native list returns"
        );
      }
      const r = parseFloat(row.radius) || 0;
      if (r < 6) problems.push(`${row.id} (${context}) has a square corner: radius=${row.radius}`);
    }
  };

  const open = async (page) => {
    /* Test 1 opens the read dock, and `openReadDock()` calls `speakCurrent()`,
     * so without this stub the suite reads the screenplay out loud on the
     * developer's machine. Installed before goto() so it beats app.js. */
    await require("../../scripts/lib/silence-speech.cjs").silenceSpeech(page);
    await page.goto(appUrl);
    await page.waitForTimeout(1700);
  };

  try {
    // --- 1. Default script view + read dock -----------------------------
    {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await open(page);
      record(await page.evaluate(READ_SELECTS), "script view");
      await page.evaluate(() => document.querySelector("#readToggle")?.click());
      await page.waitForTimeout(700);
      record(await page.evaluate(READ_SELECTS), "read dock");
      await page.close();
    }

    // --- 2. Every workspace view ---------------------------------------
    // Names must match the real `data-view` values in the rail; a typo here
    // silently skips a whole view (and once skipped the Beat Board, which is
    // where #beatAlignSelect lives).
    const VIEWS = ["script", "sceneview", "navigator", "characters", "reports", "beatboard"];
    for (const view of VIEWS) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await open(page);
      const clicked = await page.evaluate((v) => {
        const button = document.querySelector(`.rail__item[data-view="${v}"]`);
        if (!button) return false;
        button.click();
        return true;
      }, view);
      if (!clicked) {
        problems.push(`rail view "${view}" does not exist — audit skipped it`);
      }
      await page.waitForTimeout(600);
      record(await page.evaluate(READ_SELECTS), `view:${view}`);
      await page.close();
    }

    // --- 3. The sprint widget (holds #sprintDurationSelect) -------------
    {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await open(page);
      await page.evaluate(() => document.querySelector("#sprintQuickButton")?.click());
      await page.waitForTimeout(600);
      record(await page.evaluate(READ_SELECTS), "sprint widget");
      await page.close();
    }

    // --- 4. Dialogs that contain selects -------------------------------
    const dialogs = [
      ["#settingsButton", "settings"],
      ["#charAssignVoicesBtn", "assign voices"],
      ["#pageSetupButton", "page setup"],
      ["#elementSettingsButton", "element settings"],
    ];
    for (const [selector, label] of dialogs) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await open(page);
      // Some triggers live in other views; try switching to characters first.
      await page.evaluate(() => document.querySelector('[data-view="characters"]')?.click());
      await page.waitForTimeout(300);
      const opened = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        el.click();
        return true;
      }, selector);
      await page.waitForTimeout(900);
      if (opened) record(await page.evaluate(READ_SELECTS), `dialog:${label}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }

  // ---- Report ----------------------------------------------------------
  const rows = [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
  console.log(`\n${rows.length} distinct select control(s) found across ${new Set(rows.flatMap((r) => r.contexts)).size} context(s)\n`);
  console.log("id".padEnd(26), "radius".padEnd(8), "appearance".padEnd(14), "picker-icon");
  console.log("-".repeat(68));
  for (const r of rows) {
    console.log(
      r.id.padEnd(26),
      String(r.radius).padEnd(8),
      String(r.appearance).padEnd(14),
      r.pickerIcon ? "app-drawn" : "NO"
    );
  }

  const signatures = [...new Set(rows.map((r) => `${r.radius}|${r.appearance}|${r.pickerIcon}`))];
  console.log(`\nsignatures: ${JSON.stringify(signatures)}`);
  console.log(`::picker(select) supported by this browser: ${rows.some((r) => r.pickerSupported)}`);

  const noIcon = rows.filter((r) => !r.pickerIcon);
  if (noIcon.length) {
    problems.push(
      `selects whose picker icon is not drawn by the app (the native arrow returns): ${noIcon.map((r) => r.id).join(", ")}`
    );
  }

  if (rows.length === 0) {
    /* The vacuous-pass guard: this file has previously reported PASS on a run that
     * measured nothing, because a renamed rail selector skipped every view. */
    problems.push("the audit measured ZERO selects, which cannot be a pass");
  }

  if (problems.length) {
    console.log(`\nFAIL: ${problems.length} problem(s)`);
    for (const p of [...new Set(problems)]) console.log("  - " + p);
    process.exitCode = 1;
  } else {
    console.log("\nPASS: every select has rounded corners, an app-drawn popup and an app-drawn arrow");
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

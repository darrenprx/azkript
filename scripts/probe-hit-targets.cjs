/* Is the Start Center close control really under-sized, or measured mid-animation?
 *
 * desktop/tests/electron-smoke.cjs asserts the close control is a >= 39px hit target,
 * and has been observed failing intermittently with
 *     "close control needs a real hit target"
 * after a global type-scale change, so it has to be established whether that is a
 * genuine size regression or a flaky measurement.
 *
 * Evidence that points at timing: the Start Center panel animates in with
 *     @keyframes startPanelIn { from { transform: translateY(22px) scale(0.97) }
 *                               to   { transform: translateY(0) scale(1) } }
 * over 420ms, and the control is a fixed 40x40. A 40px button inside a panel scaled
 * to 0.97 measures 38.8px — under the 39px threshold. So sampling during the
 * entrance produces exactly the observed failure with no size change at all.
 *
 * This runs in ELECTRON, not Chrome, because showStartCenter() is gated on
 * `isDesktop` (app/js/app.js): in a plain browser it shows a toast and never opens
 * the dialog, so a Chrome-based probe cannot see the control at all. An earlier
 * version of this script did exactly that and reported success on zero measurements.
 *
 * It measures three ways: immediately after opening (the smoke test's timing), after
 * the entrance has settled, and with animations disabled entirely. If the settled and
 * no-animation readings are >= 39px while the immediate one is not, the assertion is
 * flaky, the control is fine, and the test is what needs fixing.
 *
 * Usage: node scripts/probe-hit-targets.cjs [--runs=3]
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const runsArg = process.argv.find((a) => a.startsWith("--runs="));
const RUNS = runsArg ? Number.parseInt(runsArg.split("=")[1], 10) : 3;

const playwrightPath = path.join(root, "node_modules", "playwright-core");
const electronPath = path.join(root, "node_modules", "electron", "dist", "electron.exe");
for (const required of [playwrightPath, electronPath]) {
  if (!fs.existsSync(required)) {
    console.error(`SKIP: missing ${required}`);
    process.exit(1);
  }
}

const { _electron } = require(playwrightPath);
const MIN_TARGET = 39;
const SETTLE_MS = 900; // the entrance is 420ms; 900 clears it with margin

async function measure({ disableAnimations }) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "azkript-hittest-"));
  /* ELECTRON_RUN_AS_NODE must be cleared or Electron boots as a plain Node process
   * and Playwright's driver never sees a debugging line — it reports the opaque and
   * misleading "Process failed to launch!". This shell exports it (some tooling sets
   * it globally), and desktop/tests/electron-smoke.cjs deletes it for the same reason. */
  const env = { ...process.env, AZKRIPT_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [".", `--user-data-dir=${profile}`],
    cwd: root,
    env,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);

    // The dialog is opened on first launch for a fresh profile; make sure of it.
    const alreadyOpen = await page.evaluate(() => document.querySelector("#startCenter")?.open ?? false);
    if (!alreadyOpen) {
      await page.locator("#brandButton").click();
    }
    if (disableAnimations) {
      await page.addStyleTag({
        content: `*, *::before, *::after { animation: none !important; transition: none !important; }`,
      });
    }

    const read = async () => {
      const box = await page.locator("#startCenterClose").boundingBox();
      return box ? { w: +box.width.toFixed(2), h: +box.height.toFixed(2) } : null;
    };

    const immediate = await read();
    await page.waitForTimeout(SETTLE_MS);
    const settled = await read();
    const state = await page.evaluate(() => ({
      open: document.querySelector("#startCenter")?.open ?? null,
      ready: document.querySelector("#startCenter")?.classList.contains("is-ready") ?? null,
      // The scale the panel is actually painting at, which explains a shrunken box.
      panelTransform: (() => {
        const panel = document.querySelector(".start-center");
        return panel ? getComputedStyle(panel).transform : null;
      })(),
    }));
    return { immediate, settled, state };
  } finally {
    await app.close().catch(() => {});
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      /* disposable */
    }
  }
}

(async () => {
  const animated = [];
  const still = [];
  for (let run = 1; run <= RUNS; run += 1) {
    const a = await measure({ disableAnimations: false });
    const s = await measure({ disableAnimations: true });
    animated.push(a);
    still.push(s);
    console.log(
      `run ${run}: animated immediate ${a.immediate ? `${a.immediate.w}x${a.immediate.h}` : "MISSING"}` +
        `  settled ${a.settled ? `${a.settled.w}x${a.settled.h}` : "MISSING"}` +
        `  open=${a.state.open} ready=${a.state.ready}` +
        `  transform=${a.state.panelTransform}   |  no-animation ${s.settled ? `${s.settled.w}x${s.settled.h}` : "MISSING"}`
    );
  }

  /* A missing measurement is a FAILURE. An earlier revision of this script reduced
   * over an empty list and printed PASS with no data at all — the same vacuous
   * assertion that let this project's earlier defects through, so it is called out
   * here rather than quietly fixed. */
  const failures = [];
  if (animated.some((r) => !r.settled)) failures.push("an animated run produced no measurement");
  if (still.some((r) => !r.settled)) failures.push("a no-animation run produced no measurement");
  if (animated.some((r) => r.state.open !== true)) failures.push("the Start Center did not open in a run");

  const minOf = (list) => {
    const values = list.filter(Boolean).map((b) => Math.min(b.w, b.h));
    return values.length ? Math.min(...values) : NaN;
  };
  const immediateMin = minOf(animated.map((r) => r.immediate));
  const settledMinAnimated = minOf(animated.map((r) => r.settled));
  const settledMinStill = minOf(still.map((r) => r.settled));

  console.log("\n=== verdict ===");
  console.log(`runs                                   : ${RUNS}`);
  console.log(`immediate sample, smallest             : ${Number.isFinite(immediateMin) ? immediateMin.toFixed(2) : "n/a"}px`);
  console.log(`settled with the entrance animation     : ${Number.isFinite(settledMinAnimated) ? settledMinAnimated.toFixed(2) : "n/a"}px`);
  console.log(`settled with animations disabled        : ${Number.isFinite(settledMinStill) ? settledMinStill.toFixed(2) : "n/a"}px`);
  console.log(`threshold                               : ${MIN_TARGET}px`);

  if (Number.isFinite(settledMinStill) && settledMinStill < MIN_TARGET) {
    failures.push(
      `with animations disabled the control is ${settledMinStill.toFixed(2)}px, below ${MIN_TARGET}px: ` +
        "this is a genuine hit-target regression, not a timing artefact"
    );
  }
  if (Number.isFinite(settledMinAnimated) && settledMinAnimated < MIN_TARGET) {
    failures.push(`even after settling the animated panel leaves the control at ${settledMinAnimated.toFixed(2)}px`);
  }

  const timingArtefact =
    Number.isFinite(immediateMin) &&
    immediateMin < MIN_TARGET &&
    Number.isFinite(settledMinStill) &&
    settledMinStill >= MIN_TARGET;
  if (timingArtefact) {
    console.log(
      "\nDIAGNOSIS: the control is correctly sized once the entrance finishes. The sub-threshold\n" +
        `reading only happens while the panel is mid-animation (scale 0.97 of a 40px box = ${(40 * 0.97).toFixed(2)}px).\n` +
        "=> desktop/tests/electron-smoke.cjs measures it during the entrance: the TEST is flaky,\n" +
        "   the control is fine. It should wait for .start-center to reach is-ready before measuring."
    );
  }

  if (failures.length) {
    console.log("\nFAIL:");
    for (const line of failures) console.log(`  - ${line}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nPASS: the close control settles at or above the hit-target minimum in every run.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

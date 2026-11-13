/* Replicate the desktop smoke test's Start Center sequence and log what it measures.
 *
 * `desktop/tests/electron-smoke.cjs` intermittently fails with
 *     "close control needs a real hit target"
 * The control itself is a fixed 40x40 (proven stable by probe-hit-targets.cjs), so
 * either the measurement is taken before the panel has painted, or the element is not
 * visible at that instant and boundingBox() returns null.
 *
 * This runs the SAME sequence the test does, N times, and records for each iteration:
 *   - whether the dialog reports open
 *   - whether is-open / is-ready have been applied
 *   - the panel's computed transform (the entrance animates scale 0.97 -> 1)
 *   - the raw boundingBox, which is what the assertion consumes
 * so the difference between "test timing" and "real regression" is data, not opinion.
 *
 * Usage: node scripts/probe-close-sequence.cjs [--runs=6]
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const runsArg = process.argv.find((a) => a.startsWith("--runs="));
const RUNS = runsArg ? Number.parseInt(runsArg.split("=")[1], 10) : 6;

const playwrightPath = path.join(root, "node_modules", "playwright-core");
const electronPath = path.join(root, "node_modules", "electron", "dist", "electron.exe");
const { _electron } = require(playwrightPath);

async function oneRun(index) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "azkript-closeseq-"));
  // See probe-hit-targets.cjs: this shell exports ELECTRON_RUN_AS_NODE, which makes
  // Electron boot as plain Node and the driver report "Process failed to launch!".
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
    // Exactly the smoke test's wait chain, including its swallowing of timeouts.
    await page
      .waitForFunction(() => document.getElementById("startCenter")?.open === true, null, { timeout: 15000 })
      .catch(() => {});
    await page
      .waitForFunction(() => document.querySelector(".start-center")?.getBoundingClientRect().width > 100, null, {
        timeout: 5000,
      })
      .catch(() => {});

    const snapshot = await page.evaluate(() => {
      const dialog = document.getElementById("startCenter");
      const panel = document.querySelector(".start-center");
      const close = document.getElementById("startCenterClose");
      const rect = close ? close.getBoundingClientRect() : null;
      return {
        open: dialog ? dialog.open : null,
        isOpen: dialog ? dialog.classList.contains("is-open") : null,
        isReady: dialog ? dialog.classList.contains("is-ready") : null,
        panelWidth: panel ? panel.getBoundingClientRect().width : null,
        panelTransform: panel ? getComputedStyle(panel).transform : null,
        closeRect: rect ? { w: +rect.width.toFixed(3), h: +rect.height.toFixed(3) } : null,
        closeComputed: close
          ? {
              w: getComputedStyle(close).width,
              h: getComputedStyle(close).height,
              display: getComputedStyle(close).display,
              visibility: getComputedStyle(close).visibility,
              opacity: getComputedStyle(close).opacity,
            }
          : null,
      };
    });

    const box = await page.locator("#startCenterClose").boundingBox();
    return { index, snapshot, boundingBox: box ? { w: +box.width.toFixed(3), h: +box.height.toFixed(3) } : null };
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
  const results = [];
  for (let i = 1; i <= RUNS; i += 1) {
    const r = await oneRun(i);
    results.push(r);
    const s = r.snapshot;
    const fails = !r.boundingBox || r.boundingBox.w < 39 || r.boundingBox.h < 39;
    console.log(
      `run ${i}: ${fails ? "WOULD FAIL" : "pass"}` +
        `  open=${s.open} is-open=${s.isOpen} is-ready=${s.isReady}` +
        `  panel=${s.panelWidth === null ? "n/a" : s.panelWidth.toFixed(1)}` +
        `  transform=${s.panelTransform}` +
        `  rect=${s.closeRect ? `${s.closeRect.w}x${s.closeRect.h}` : "null"}` +
        `  bbox=${r.boundingBox ? `${r.boundingBox.w}x${r.boundingBox.h}` : "null"}`
    );
  }

  const failing = results.filter(
    (r) => !r.boundingBox || r.boundingBox.w < 39 || r.boundingBox.h < 39
  );
  console.log(`\n=== summary ===\niterations: ${RUNS}   would-fail: ${failing.length}`);
  if (failing.length) {
    console.log("\nThe failing snapshots, in full:");
    for (const r of failing) console.log(JSON.stringify(r, null, 2));
    console.log(
      "\nIf is-ready is false and/or the transform is not identity in these snapshots, the\n" +
        "sequence measures the control before the entrance animation finishes: the assertion\n" +
        "is racing the animation, not detecting a shrunken hit target."
    );
    process.exitCode = 1;
  } else {
    console.log(
      "No failure reproduced in this sample. The control measured correctly every time;\n" +
        "any observed failure is intermittent, which is consistent with a timing race."
    );
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

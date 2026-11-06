/* Negative control for the desktop smoke test's hit-target assertion.
 *
 * The assertion is only worth having if it FAILS when the control is genuinely
 * undersized. This shrinks `.start-center__top .icon-btn` from 40px to 26px in
 * app/styles-desktop.css, runs the desktop smoke test, restores the file, and reports
 * whether the test caught the regression.
 *
 * Usage: node scripts/verify-hit-target-guard.cjs
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const target = path.join(root, "app", "styles-desktop.css");
const original = fs.readFileSync(target, "utf8");

const BLOCK = /(\.start-center__top \.icon-btn \{)([\s\S]*?)(\})/;
const match = original.match(BLOCK);
if (!match) {
  console.error("could not find the .start-center__top .icon-btn rule in styles-desktop.css");
  process.exit(2);
}
if (!/width:\s*40px/.test(match[2]) || !/height:\s*40px/.test(match[2])) {
  console.error("expected the close control to be 40x40; the rule has changed shape:");
  console.error(match[2]);
  process.exit(2);
}

// Shrink it well below the 39px minimum: a real regression, not a borderline value.
const mutatedBlock =
  match[1] + match[2].replace(/width:\s*40px/, "width: 26px").replace(/height:\s*40px/, "height: 26px") + match[3];
fs.writeFileSync(target, original.replace(BLOCK, mutatedBlock));
console.log("mutated .start-center__top .icon-btn to 26x26");

let caught = false;
let output = "";
try {
  output = execFileSync("npm", ["run", "test:desktop"], {
    cwd: root,
    encoding: "utf8",
    shell: true,
    stdio: "pipe",
  });
} catch (error) {
  caught = true;
  output = `${error.stdout || ""}${error.stderr || ""}`;
} finally {
  fs.writeFileSync(target, original);
  console.log("restored styles-desktop.css");
}

const mentionsHitTarget = /real hit target|paints smaller than its layout box/i.test(output);
console.log("\n=== result ===");
console.log(`desktop smoke test failed on the mutation : ${caught}`);
console.log(`failure names the hit-target assertion    : ${mentionsHitTarget}`);
if (caught && mentionsHitTarget) {
  console.log("PASS: the guard catches a genuinely undersized close control.");
  process.exit(0);
}
console.log("FAIL: the guard did not catch a 26x26 close control — it is not protecting anything.");
if (output) console.log(`\n--- test output ---\n${output.slice(-2500)}`);
process.exit(1);

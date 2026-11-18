/* Negative controls for the two audits added in this session.
 *
 *   1. scripts/audit-class-drift.cjs — reintroduce the exact Scene View rename that caused
 *      the reported defect: emit `.sv-cell--heading` but style `.sv-heading`. The audit
 *      must fail.
 *   2. scripts/audit-control-styling.cjs — remove the `.sv-inline-input` rule so the fields
 *      fall back to the platform bevel. The audit must fail.
 *
 * Each audit runs against a temporary app copy.
 *
 * Usage: node scripts/verify-style-audits.cjs
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { withAppCopy } = require("./lib/with-app-copy.cjs");

const root = path.resolve(__dirname, "..");
const cssPath = path.join(root, "app", "styles.css");
const original = fs.readFileSync(cssPath, "utf8");

function run(script, mutated, failure) {
  return withAppCopy(root, [script, "node_modules/playwright-core"], copy => {
    fs.writeFileSync(path.join(copy, "app", "styles.css"), mutated);
    try {
      execFileSync(process.execPath, [script], { cwd: copy, encoding: "utf8", stdio: "pipe" });
      return { caught: false, evidence: "The mutation passed the audit." };
    } catch (error) {
      const output = `${error.stdout || ""}${error.stderr || ""}`;
      const evidence = output.match(failure)?.[0];
      return { caught: Boolean(evidence), evidence: evidence || output.slice(-1200) };
    }
  });
}

const results = [];

/* Control 1: rename the styled class so the audit sees an unstyled element.
 *
 * Done on the CSS side (rename `.sv-cell--heading`'s rule to `.sv-heading`) rather than on
 * the JS side, because the audit reads both files and either half of the mismatch is the
 * same defect. A comment-stripped scan locates the rule so prose cannot be hit.
 */
{
  const stripped = original.replace(/\/\*[\s\S]*?\*\//g, (chunk) => " ".repeat(chunk.length));
  const at = stripped.indexOf(".sv-cell--heading {");
  if (at === -1) {
    console.error("could not find the .sv-cell--heading rule; aborting");
    process.exit(2);
  }
  const mutated = original.slice(0, at) + ".sv-heading {" + original.slice(at + ".sv-cell--heading {".length);
  results.push({
    name: "Scene View class rename (.sv-cell--heading rule renamed to .sv-heading)",
    ...run("scripts/audit-class-drift.cjs", mutated, /^\s*FAIL \.sv-cell--heading\b[^\r\n]*/m),
  });
}

/* Control 2: remove the inline-input rule. */
{
  const stripped = original.replace(/\/\*[\s\S]*?\*\//g, (chunk) => " ".repeat(chunk.length));
  const start = stripped.indexOf(".sv-inline-input {");
  const end = stripped.indexOf(".sv-cell--action {");
  if (start === -1 || end === -1 || end < start) {
    console.error("could not locate the .sv-inline-input block; aborting");
    process.exit(2);
  }
  results.push({
    name: ".sv-inline-input rule removed (fields fall back to the platform bevel)",
    ...run("scripts/audit-control-styling.cjs", original.slice(0, start) + original.slice(end), /FAIL: \d+ control\(s\)[\s\S]*?sv-inline-input/),
  });
}

console.log("");
let ok = true;
for (const result of results) {
  console.log(`${result.caught ? "PASS" : "FAIL"}  ${result.name}`);
  if (result.evidence) {
    for (const line of result.evidence.split("\n").slice(0, 3)) console.log(`        ${line.trim()}`);
  }
  if (!result.caught) ok = false;
}
if (!ok) {
  console.error("FAIL: at least one audit did not catch its defect.");
  process.exit(1);
}
console.log("PASS: both audits identify their expected defects in temporary app copies.");

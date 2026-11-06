/* Negative controls for the style-consistency guard.
 *
 * Each mutation reintroduces one of the two reported defects and asserts that
 * app/tests/style-consistency.test.cjs FAILS. A guard that cannot fail is worthless, and
 * this session has already produced two assertions that passed vacuously.
 *
 *   1. Put an entrance animation back on `.view.is-active`, alongside the one on
 *      `.view.is-entering`. That is the double-refresh: one view change animates twice.
 *   2. Remove the `.sv-inline-input` rule. That is the Scene View defect: the fields fall
 *      back to native Windows styling.
 *
 * Usage: node scripts/verify-style-guards.cjs
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const cssPath = path.join(root, "app", "styles.css");
const original = fs.readFileSync(cssPath, "utf8");

function runGuard() {
  try {
    const out = execFileSync(
      process.execPath,
      ["--test", "app/tests/style-consistency.test.cjs"],
      { cwd: root, encoding: "utf8", stdio: "pipe" }
    );
    return { failed: false, output: out };
  } catch (error) {
    return { failed: true, output: `${error.stdout || ""}${error.stderr || ""}` };
  }
}

const results = [];

/* Mutation 1: two entrance animations. Written against a COMMENT-STRIPPED copy, because
 * the stylesheet documents the removed `.view.is-active { animation: viewIn ... }` rule in
 * prose; a naive regex matches that comment instead of the real rule and reports the rule
 * as missing. (This is the same comment-vs-code trap that made an earlier version of this
 * mutation silently apply nothing at all.) */
{
  const rule = /(\.view\.is-active\s*\{)([^}]*)(\})/;
  const strippedIndex = original.replace(/\/\*[\s\S]*?\*\//g, (chunk) => " ".repeat(chunk.length));
  const match = rule.exec(strippedIndex);
  if (!match) {
    console.error("could not find a real `.view.is-active {` rule (outside comments); aborting");
    process.exit(2);
  }
  const bodyStart = match.index + match[1].length;
  const bodyEnd = bodyStart + match[2].length;
  const realBody = original.slice(bodyStart, bodyEnd);
  if (!/animation:\s*none\s*;/.test(realBody)) {
    console.error(`the real .view.is-active rule has no "animation: none": ${JSON.stringify(realBody)}`);
    process.exit(2);
  }
  const mutatedBody = realBody.replace(/animation:\s*none\s*;/, "animation: viewIn 320ms both;");
  const mutated = original.slice(0, bodyStart) + mutatedBody + original.slice(bodyEnd);
  fs.writeFileSync(cssPath, mutated);
  const { failed, output } = runGuard();
  fs.writeFileSync(cssPath, original);
  results.push({
    name: "entrance animation re-added to .view.is-active (double refresh)",
    caught: failed,
    evidence: failed ? (output.match(/a view must have exactly one ENTRANCE[\s\S]{0,220}/) || [""])[0] : "",
  });
}

/* Mutation 2: no rule for the inline editors. */
{
  const start = original.indexOf(".sv-inline-input {");
  const end = original.indexOf(".sv-cell--action {");
  if (start === -1 || end === -1 || end < start) {
    console.error("could not locate the .sv-inline-input block; aborting");
    process.exit(2);
  }
  fs.writeFileSync(cssPath, original.slice(0, start) + original.slice(end));
  const { failed, output } = runGuard();
  fs.writeFileSync(cssPath, original);
  results.push({
    name: ".sv-inline-input rule removed (Scene View renders as native fields)",
    caught: failed,
    evidence: failed ? (output.match(/these Scene View selectors are missing[\s\S]{0,160}/) || [""])[0] : "",
  });
}

console.log("");
let ok = true;
for (const result of results) {
  console.log(`${result.caught ? "PASS" : "FAIL"}  ${result.name}`);
  if (result.evidence) {
    for (const line of result.evidence.split("\n").slice(0, 4)) console.log(`        ${line.trim()}`);
  }
  if (!result.caught) ok = false;
}

console.log(`\nrestored app/styles.css (${fs.readFileSync(cssPath, "utf8").length} bytes)`);
if (!ok) {
  console.error("FAIL: at least one guard did not catch its defect.");
  process.exit(1);
}
console.log("PASS: both style guards fail when their defect is reintroduced.");

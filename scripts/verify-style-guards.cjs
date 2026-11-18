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
const { withAppCopy } = require("./lib/with-app-copy.cjs");

const root = path.resolve(__dirname, "..");
const cssPath = path.join(root, "app", "styles.css");
const original = fs.readFileSync(cssPath, "utf8");

function runGuard(mutated, failure) {
  return withAppCopy(root, [], copy => {
    fs.writeFileSync(path.join(copy, "app", "styles.css"), mutated);
    try {
      execFileSync(process.execPath, ["--test", "app/tests/style-consistency.test.cjs"], {
        cwd: copy, encoding: "utf8", stdio: "pipe",
      });
      return { caught: false, evidence: "The mutation passed the guard." };
    } catch (error) {
      const output = `${error.stdout || ""}${error.stderr || ""}`;
      const evidence = output.match(failure)?.[0];
      return { caught: Boolean(evidence), evidence: evidence || output.slice(-1200) };
    }
  });
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
  results.push({
    name: "entrance animation re-added to .view.is-active (double refresh)",
    ...runGuard(mutated, /\.view\.is-active declares "animation: viewIn[^\n]*/),
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
  results.push({
    name: ".sv-inline-input rule removed (Scene View renders as native fields)",
    ...runGuard(original.slice(0, start) + original.slice(end), /these Scene View selectors are missing[^\n]*\.sv-inline-input/),
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

if (!ok) {
  console.error("FAIL: at least one guard did not catch its defect.");
  process.exit(1);
}
console.log("PASS: both style guards fail when their defect is reintroduced.");

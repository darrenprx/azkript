/* Check the stylesheets for structural damage introduced by scripted edits.
 *
 * The mutation-testing scripts in this repo rewrite app/styles.css and restore it. A
 * partial write, or a replacement that drops an opening brace, leaves a file that still
 * PARSES as text but silently swallows every rule after the damage. That is exactly the
 * class of failure this session is about, so the sheets get a structural check.
 *
 * Reports the first few places where the brace depth goes negative or ends non-zero, with
 * line numbers, and separately verifies the file still ends inside no open block.
 *
 * Usage: node scripts/check-css-structure.cjs
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const SHEETS = ["app/styles.css", "app/styles-desktop.css", "app/styles-ribbon.css", "app/styles-workspace.css", "app/styles-story.css"];

/** Strip comments while preserving newlines, so line numbers stay accurate. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
}

/** Remove quoted strings so braces inside `content: "{"` are not counted. */
function stripStrings(src) {
  return src.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (match) =>
    match.replace(/[^\n]/g, " ")
  );
}

let failed = false;
for (const rel of SHEETS) {
  const raw = fs.readFileSync(path.join(root, rel), "utf8");
  const src = stripStrings(stripComments(raw));
  const lines = src.split("\n");
  let depth = 0;
  const problems = [];
  for (let index = 0; index < lines.length; index += 1) {
    for (const ch of lines[index]) {
      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth < 0) {
          problems.push(`line ${index + 1}: closing brace with no matching opening brace`);
          depth = 0;
        }
      }
    }
  }
  const opens = (src.match(/\{/g) || []).length;
  const closes = (src.match(/\}/g) || []).length;
  const status = depth === 0 && problems.length === 0 ? "ok  " : "FAIL";
  console.log(
    `${status} ${rel.padEnd(28)} ${String(raw.length).padStart(7)} bytes  ` +
      `{ ${opens}  } ${closes}  final depth ${depth}`
  );
  for (const problem of problems.slice(0, 5)) console.log(`       ${problem}`);
  if (depth !== 0) console.log(`       the file ends inside ${depth} unclosed block(s)`);
  if (depth !== 0 || problems.length) failed = true;
}

if (failed) {
  console.error(
    "\nFAIL: a stylesheet is structurally unbalanced. Rules after the damage are silently\n" +
      "ignored by the browser, which looks exactly like an element that was never styled."
  );
  process.exitCode = 1;
} else {
  console.log("\nPASS: every stylesheet is brace-balanced.");
}

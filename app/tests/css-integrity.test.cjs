/* Stylesheet structural integrity.
 *
 * Why this exists: app/styles.css carried THREE defects that all made its brace
 * depth negative — a selector-less declaration block left behind by an edit, and a
 * @media whose opening rule had been lost, leaving 40 lines of flow-mode rules
 * stranded at top level with a floating closing brace. Browsers recover silently
 * from these, so nothing looked broken; but the file's depth drifted to -2, which
 * means a future structural check can no longer tell real breakage from the
 * accumulated noise, and an unbalanced sheet is one edit away from swallowing
 * rules wholesale.
 *
 * This asserts every stylesheet is balanced and that no declaration block appears
 * outside a rule or at-rule.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const SHEETS = ["app/styles.css", "app/styles-desktop.css", "app/styles-ribbon.css"];

/** Strip comments and string literals so braces inside them are not counted. */
function clean(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

for (const rel of SHEETS) {
  test(`${rel} has balanced braces`, () => {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    const body = clean(src);

    let depth = 0;
    let minDepth = 0;
    for (const ch of body) {
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth < minDepth) minDepth = depth;
      }
    }

    assert.equal(
      minDepth,
      0,
      `${rel} closes more braces than it opens somewhere (minDepth ${minDepth}); ` +
        "there is a stray '}' or a rule missing its opening brace"
    );
    assert.equal(
      depth,
      0,
      `${rel} ends with depth ${depth}; ` +
        (depth > 0 ? "an opening brace is never closed" : "there are extra closing braces")
    );
  });
}

test("no declaration block appears outside a rule", () => {
  for (const rel of SHEETS) {
    const lines = fs.readFileSync(path.join(root, rel), "utf8").split("\n");
    const body = clean(lines.join("\n")).split("\n");

    let depth = 0;
    body.forEach((line, i) => {
      const trimmed = line.trim();
      const startDepth = depth;
      for (const ch of line) {
        if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
      }

      // A line like "  margin: 0;" at depth 0 is a stranded declaration: it has
      // no selector to attach to. Ignore at-rule preludes and closing braces.
      const looksLikeDeclaration = /^[a-z-]+\s*:\s*[^;]+;$/i.test(trimmed);
      if (startDepth === 0 && depth === 0 && looksLikeDeclaration) {
        assert.fail(
          `${rel}:${i + 1} has a declaration outside any rule: "${trimmed}" ` +
            "(orphaned property block — its selector was lost)"
        );
      }
    });
  }
});

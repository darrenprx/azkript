/* Element shortcut coverage.
 *
 * Regression cover for the bug where the Alt-element guard was hard-coded to
 * /^[0-7]$/ while the element table advertised fourteen shortcuts. Six of them —
 * 8, 9, E, S, O, L (Act break, End of Act, General, Summary, Outline 1,
 * Outline 2) — were documented in the element combo and on the reports screen but
 * did nothing when pressed.
 *
 * This asserts the guard accepts exactly the shortcuts the model declares, so the
 * two can never drift apart again.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const model = require("../js/model.js");
const appSource = fs.readFileSync(path.join(root, "app", "js", "renderer", "events.js"), "utf8");

/** Every element shortcut the model declares. */
function declaredShortcuts() {
  const shortcuts = [];
  for (const spec of Object.values(model.ELEMENTS || {})) {
    if (spec && spec.shortcut) shortcuts.push(String(spec.shortcut).toUpperCase());
  }
  return [...new Set(shortcuts)].sort();
}

test("the element table still declares fourteen shortcuts", () => {
  const shortcuts = declaredShortcuts();
  assert.equal(shortcuts.length, 14, `expected 14 declared shortcuts, got ${shortcuts.join(",")}`);
  // The six that used to be unreachable.
  for (const key of ["8", "9", "E", "S", "O", "L"]) {
    assert.ok(shortcuts.includes(key), `element table should declare the Alt+${key} shortcut`);
  }
});

/**
 * Expand a regex character class body ("0-9ESOL") into the set of characters it
 * matches. Handle ranges (a-z, 0-9) rather than splitting on every character,
 * which would break "0-9" into "0", "-", "9".
 */
function expandCharClass(body) {
  const out = new Set();
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    const isRange = body[i + 1] === "-" && i + 2 < body.length;
    if (isRange) {
      const from = ch.charCodeAt(0);
      const to = body.charCodeAt(i + 2);
      for (let c = from; c <= to; c += 1) out.add(String.fromCharCode(c));
      i += 2;
      continue;
    }
    out.add(ch);
  }
  return out;
}

test("the Alt-element guard accepts every declared shortcut", () => {
  // Pull the character class out of the guard so the assertion is about the real code.
  const guard = appSource.match(/event\.altKey[^\n]*?\/\^\[([^\]]+)\]\$\/\.test\(/);
  assert.ok(guard, "could not locate the Alt-element shortcut guard in the input controller");

  const allowed = expandCharClass(guard[1]);
  const missing = declaredShortcuts().filter((key) => !allowed.has(key));
  assert.deepEqual(
    missing,
    [],
    `the Alt guard rejects declared shortcuts: ${missing.join(", ")} — ` +
      `guard allows only {${[...allowed].join(",")}}`
  );
});

test("the guard still rejects keys that are not element shortcuts", () => {
  const guard = appSource.match(/event\.altKey[^\n]*?\/\^\[([^\]]+)\]\$\/\.test\(/);
  assert.ok(guard, "could not locate the Alt-element shortcut guard");
  const allowed = expandCharClass(guard[1]);

  // Arrow keys, Tab and Escape are handled elsewhere and must not fall in here.
  for (const key of ["A", "Z", "Q", " ", "-"]) {
    assert.equal(allowed.has(key), false, `guard must not accept "${key}" as an element shortcut`);
  }
});

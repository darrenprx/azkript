/* Sanity-check package.json after scripted edits.
 *
 * A JSON object silently accepts a duplicate key (the last one wins), so a bad partial
 * edit to the "scripts" block can drop an entry without any error. This parses the raw
 * text for top-level script keys and reports duplicates, then asserts the npm scripts the
 * test suite and the release gate actually depend on are present.
 *
 * Usage: node scripts/check-package-scripts.cjs
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "package.json"), "utf8");
const pkg = JSON.parse(raw);

/* Duplicate detection has to look ONLY inside the "scripts" block. A naive scan of every
 * `"key":` line reports the electron-builder "build" config, which legitimately repeats
 * `target`, `arch`, `artifactName` and `name` inside different objects. The first version
 * of this check did exactly that and reported nine false duplicates. */
const scriptsBlock = raw.slice(raw.indexOf('"scripts"'), raw.indexOf('"devDependencies"'));
const keys = [...scriptsBlock.matchAll(/^\s{4}"([^"]+)":/gm)].map((m) => m[1]);
const seen = new Set();
const duplicates = [];
for (const key of keys) {
  if (seen.has(key)) duplicates.push(key);
  seen.add(key);
}

const REQUIRED = [
  // core suites
  "test",
  "test:all",
  "test:ui",
  "test:features",
  "test:ribbon",
  "test:audit",
  "test:touch",
  "test:dropdowns",
  "test:desktop",
  "test:story",
  "test:public",
  "test:security",
  "test:workspace",
  // brand + icon pipeline
  "brand:build",
  "brand:sync",
  "brand:check",
  "brand:icons",
  "test:icon",
  "test:fold",
  "brand:corners",
  // style consistency (added for the Scene View / type-scale work)
  "test:style",
  "test:style:guards",
  "test:view-transition",
  "test:sceneview",
  // release gate
  "verify:release",
  "verify:packaged",
  // packaging
  "package:win",
  "package:dir",
];

const missing = REQUIRED.filter((name) => !(name in pkg.scripts));

console.log(`scripts defined: ${Object.keys(pkg.scripts).length}`);
console.log(`duplicate keys : ${duplicates.length ? duplicates.join(", ") : "none"}`);
console.log(`missing        : ${missing.length ? missing.join(", ") : "none"}`);

const testAll = pkg.scripts["test:all"] || "";
const mustRunInTestAll = [
  ["fold-corner guard", "check-fold-vertex.py"],
  ["icon probe", "probe-exe-icon.py"],
  ["class-drift audit", "audit-class-drift.cjs"],
  ["control-styling audit", "audit-control-styling.cjs"],
  ["workspace integration", "test:workspace"],
  ["security integration", "test:security"],
];
const notInAll = mustRunInTestAll.filter(([, needle]) => !testAll.includes(needle)).map(([name]) => name);

let failed = false;
if (duplicates.length) {
  console.error(`\nFAIL: duplicate keys in package.json: ${duplicates.join(", ")}`);
  failed = true;
}
if (missing.length) {
  console.error(`\nFAIL: required npm scripts are missing: ${missing.join(", ")}`);
  failed = true;
}
if (notInAll.length) {
  console.error(`\nFAIL: test:all does not run: ${notInAll.join(", ")}`);
  failed = true;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("\nPASS: package.json is well formed and every required check is wired in.");
}

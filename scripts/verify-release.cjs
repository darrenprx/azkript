/* Release gate: prove the ARTIFACT matches the SOURCE before it is shipped.
 *
 * This exists because of a defect that every other check in this repo passed:
 * the type-scale rebalance landed in `app/styles*.css`, the source-level screenshot
 * looked right, all unit tests were green — and `dist/` still contained a build made
 * BEFORE that work. Installing it would have shown the user the old, too-small chrome
 * with no indication anything was wrong. The same class of bug was reported by the
 * user as "the app exe didn't use this icon".
 *
 * So this compares the packaged archive against the working tree, byte for byte, and
 * fails if anything that ships is stale. It also runs the behavioural checks that read
 * the packaged app rather than the source:
 *   - `scripts/shot-packaged.cjs` launches the packaged asar and asserts the chrome
 *     typography, the screenplay body size and the generated brand sprite;
 *   - `scripts/probe-packaged-selects.js` loads the packaged asar and asserts every
 *     `<select>` computes `appearance: base-select` and that the open popup is
 *     app-styled — the artifact-level check for the dropdown conversion;
 *   - `scripts/probe-exe-icon.py` proves every packaged exe carries (and the shell
 *     renders) the current icon.
 *
 * Run it after packaging and before handing the build to anyone:
 *     npm run package:dir && npm run verify:release
 *
 * Usage: node scripts/verify-release.cjs [--allow-missing-dist]
 */
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const allowMissing = process.argv.includes("--allow-missing-dist");

const ASAR = path.join(root, "dist", "win-unpacked", "resources", "app.asar");
const WIN_UNPACKED = path.join(root, "dist", "win-unpacked", "Azkript.exe");

/* Everything electron-builder copies into app.asar, per the "files" globs in
 * package.json. Only files that both ship and can go stale are listed: tests and
 * docs are excluded from the package on purpose, so comparing them would be noise.
 * package.json is deliberately NOT here — electron-builder rewrites it into a
 * trimmed metadata form (name/productName/version/main/...), so a byte comparison
 * would always fail; `main` and the version are checked semantically below. */
const PACKAGED = [
  "app/index.html",
  "app/styles.css",
  "app/styles-desktop.css",
  "app/styles-ribbon.css",
  "app/js/app.js",
  "app/js/model.js",
  "app/js/fdx.js",
  "app/js/pagination.js",
  "app/js/core-writing.js",
  "app/js/writing-tools.js",
  "app/js/search-worker.js",
  "app/js/pagination-worker.js",
  "app/js/pagination-worker-source.js",
  "app/brand/azkript-mark.svg",
  "app/brand/azkript-mark-small.svg",
  "app/brand/palettes.json",
  "desktop/main.js",
  "desktop/preload.js",
  "desktop/menu.js",
  "desktop/profile-migration.js",
  "desktop/document-safety.js",
  "desktop/installer.nsh",
  "desktop/assets/icon.png",
  "desktop/assets/icon-512.png",
  "desktop/assets/icon.ico",
];

const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

function fail(lines) {
  console.error("\nFAIL: the release artifacts do not match the source tree.");
  for (const line of lines) console.error(`  - ${line}`);
  console.error("\nRebuild before shipping: npm run package:win");
  process.exit(1);
}

function main() {
  if (!fs.existsSync(ASAR)) {
    const message = `missing ${path.relative(root, ASAR)} — run npm run package:dir first`;
    if (allowMissing) {
      console.log(`SKIP: ${message}`);
      return;
    }
    fail([message]);
  }

  console.log("== 1. packaged archive vs working tree ==");
  const work = fs.mkdtempSync(path.join(process.env.TEMP || ".", "azkript-release-"));
  const stale = [];
  try {
    require(path.join(root, "node_modules", "@electron", "asar")).extractAll(ASAR, work);
    for (const rel of PACKAGED) {
      const packed = path.join(work, rel);
      const source = path.join(root, rel);
      if (!fs.existsSync(packed)) {
        stale.push(`${rel}: MISSING from the packaged archive`);
        continue;
      }
      if (!fs.existsSync(source)) {
        stale.push(`${rel}: packaged but absent from the source tree`);
        continue;
      }
      const a = fs.readFileSync(packed);
      const b = fs.readFileSync(source);
      const same = a.equals(b);
      console.log(`  ${same ? "ok  " : "STALE"} ${rel.padEnd(38)} ${a.length} bytes`);
      if (!same) {
        stale.push(
          `${rel}: packaged ${sha(a).slice(0, 12)} (${a.length} B) != source ` +
            `${sha(b).slice(0, 12)} (${b.length} B)`
        );
      }
    }

    /* electron-builder rewrites package.json into a trimmed metadata object, so compare
     * the fields that actually affect the shipped program instead of the file bytes. A
     * packaged `main` pointing somewhere else is the failure that matters. */
    const packedPkgPath = path.join(work, "package.json");
    if (!fs.existsSync(packedPkgPath)) {
      stale.push("package.json: MISSING from the packaged archive");
    } else {
      const packed = JSON.parse(fs.readFileSync(packedPkgPath, "utf8"));
      const source = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
      for (const key of ["name", "productName", "version", "main"]) {
        const ok = packed[key] === source[key];
        console.log(`  ${ok ? "ok  " : "STALE"} package.json#${key.padEnd(28)} ${JSON.stringify(packed[key])}`);
        if (!ok) {
          stale.push(
            `package.json#${key}: packaged ${JSON.stringify(packed[key])} != source ${JSON.stringify(source[key])}`
          );
        }
      }
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  if (stale.length) fail(stale);

  console.log("\n== 2. the packaged app renders what it claims ==");
  if (!fs.existsSync(WIN_UNPACKED)) {
    const message = "dist/win-unpacked/Azkript.exe is missing — run npm run package:dir";
    if (allowMissing) {
      console.log(`SKIP: ${message}`);
      return;
    }
    fail([message]);
  }
  try {
    const output = execFileSync(process.execPath, ["scripts/shot-packaged.cjs"], {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    });
    for (const line of output.trim().split("\n")) console.log(`  ${line}`);
  } catch (error) {
    fail([`the packaged app failed its render check:\n${error.stdout || ""}${error.stderr || ""}`]);
  }

  console.log("\n== 3. every packaged exe carries the current icon ==");
  try {
    const output = execFileSync("python", ["scripts/probe-exe-icon.py", "--require-exe"], {
      cwd: root,
      encoding: "utf8",
    });
    for (const line of output.trim().split("\n").slice(-6)) console.log(`  ${line}`);
  } catch (error) {
    fail([`the icon probe failed:\n${error.stdout || ""}${error.stderr || ""}`]);
  }

  console.log("\n== 4. the packaged asar draws its dropdowns in-app ==");
  /* Same reasoning as step 2, one layer deeper. Every other visual check screenshots
   * `app/index.html`, so a `dist/` built before the select conversion would still pass
   * them all while showing users the old OS-drawn lists. This reads the artifact.
   * Electron is invoked directly (not the packaged exe): the exe runs desktop/main.js,
   * so it cannot execute a probe script. */
  const electronBin = path.join(root, "node_modules", "electron", "dist", "electron.exe");
  if (!fs.existsSync(electronBin)) {
    fail([`cannot check the packaged dropdowns: ${path.relative(root, electronBin)} is missing`]);
  }
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const output = execFileSync(electronBin, ["scripts/probe-packaged-selects.js"], {
      cwd: root,
      encoding: "utf8",
      env,
    });
    const lines = output.trim().split("\n");
    console.log(`  ${lines[lines.length - 1]}`);
  } catch (error) {
    fail([`the packaged dropdown check failed:\n${error.stdout || ""}${error.stderr || ""}`]);
  }

  console.log("\nPASS: the artifacts match the source, render the rebalanced typography,");
  console.log("      and carry the current brand icon. Safe to ship.");
}

main();

/* Guard the icon's corner rounding at every shipped size.
 *
 * The user reported: "The icon still lives with not rounded corner." They were right,
 * and the reason it survived review twice is that the SOURCE was correct — the artwork
 * declared a corner radius on the 48-unit grid — while the RENDERED result was square.
 * At 16 px a 4/48 radius is 1.33 device pixels, and 1.3 px of rounding reads as a hard
 * corner. The 1024 px master looked perfect; the taskbar frames did not.
 *
 * So this test does not inspect the SVG. It rasterises and measures the shipped PNG/ICO
 * pixels, which is the only place the defect is visible. See
 * scripts/measure-icon-corners.py for the measurement method and its calibration.
 *
 * Run: node --test app/tests/icon-corners.test.cjs
 */
"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const assets = path.join(root, "desktop", "assets");
const measureScript = path.join(root, "scripts", "measure-icon-corners.py");

function havePythonPillow() {
  try {
    execFileSync("python", ["-c", "import PIL; print(PIL.__version__)"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

test("every shipped icon size has corners that read as rounded", (t) => {
  if (!havePythonPillow()) {
    t.skip("python + Pillow unavailable");
    return;
  }
  const icoPath = path.join(assets, "icon.ico");
  assert.ok(fs.existsSync(icoPath), "desktop/assets/icon.ico is missing");

  let stdout;
  try {
    stdout = execFileSync("python", [measureScript], { cwd: root, encoding: "utf8" });
  } catch (error) {
    // The script exits 1 precisely when a size reads square; surface its report.
    assert.fail(
      `icon corner check failed:\n${error.stdout || ""}${error.stderr || ""}`
    );
  }
  assert.match(stdout, /PASS: every shipped size/, "the corner check should pass");
});

test("the small-size radius is large enough to survive downscaling", () => {
  // The optical-size variant needs a proportionally LARGER radius than the master,
  // because the same fraction of the canvas is fewer device pixels at 16 px. Getting
  // this wrong is what produced square corners in the first place, so the relationship
  // is asserted directly rather than left to the raster check alone.
  const source = fs.readFileSync(path.join(root, "scripts", "lib", "brand-mark.cjs"), "utf8");

  const masterBlock = source.match(/const MASTER = \{[\s\S]*?sheet: \{([\s\S]*?)\}/);
  const smallBlock = source.match(/const SMALL = \{[\s\S]*?sheet: \{([\s\S]*?)\}/);
  assert.ok(masterBlock, "expected a MASTER geometry block");
  assert.ok(smallBlock, "expected a SMALL geometry block");

  const radiusOf = (block, label) => {
    const m = block[1].match(/\bradius:\s*([\d.]+)/);
    assert.ok(m, `${label}: no sheet radius found`);
    return Number(m[1]);
  };
  const masterRadius = radiusOf(masterBlock, "MASTER");
  const smallRadius = radiusOf(smallBlock, "SMALL");

  // As a fraction of the 48-unit grid the small variant must be at least 1.5x the
  // master's. Measured calibration: 4.0 units gives arc depth 1 at 20 px (square) and
  // 9.0 gives depth 3 (rounded), so anything near parity is too tight.
  assert.ok(
    smallRadius >= masterRadius * 1.5,
    `the small variant's radius (${smallRadius}) must be at least 1.5x the master's ` +
      `(${masterRadius}) — at 16-24 px the same fraction is too few device pixels to read as rounded`
  );

  // And the smallest frame must still get a visible arc: radius * 16/48 >= 2.5 px.
  const smallestFrameArc = (smallRadius / 48) * 16;
  assert.ok(
    smallestFrameArc >= 2.5,
    `the 16 px frame only gets ${smallestFrameArc.toFixed(2)} px of corner radius; ` +
      "it will read as a square corner (need >= 2.5 px)"
  );
});

test("make-icon.py keeps the alpha-clean floor the corner measurement depends on", () => {
  // measure-icon-corners.py sets its silhouette threshold at the same value the build
  // uses to snap near-transparent pixels away. If one moves without the other, the
  // measurement silently starts probing the wrong thing.
  const source = fs.readFileSync(path.join(root, "scripts", "make-icon.py"), "utf8");
  const m = source.match(/ALPHA_CLEAN_THRESHOLD\s*=\s*(\d+)/);
  assert.ok(m, "make-icon.py should define ALPHA_CLEAN_THRESHOLD");
  assert.equal(Number(m[1]), 8, "ALPHA_CLEAN_THRESHOLD changed; update measure-icon-corners.py to match");
});

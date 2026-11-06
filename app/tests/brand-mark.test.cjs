/* Guard the single-source brand rule.
 *
 * The user's complaint was that the app icon and the in-app mark were two
 * different drawings. scripts/sync-brand.cjs generates the in-app sprite symbols
 * from app/brand/*.svg, and scripts/make-icon.py rasterises the icon set from the
 * same files — but only if nobody hand-edits the generated block. This test
 * fails the moment app/index.html drifts from the master SVG, and also checks the
 * icon files exist and look like the size the build expects.
 *
 * Run: node --test app/tests/brand-mark.test.cjs
 */
"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const htmlPath = path.join(root, "app", "index.html");
const masterPath = path.join(root, "app", "brand", "azkript-mark.svg");
const smallPath = path.join(root, "app", "brand", "azkript-mark-small.svg");
const assets = path.join(root, "desktop", "assets");

const readIfPresent = (file) => (fs.existsSync(file) ? fs.readFileSync(file) : null);

test("the master and optical-size marks both exist and share one viewBox", () => {
  const master = readIfPresent(masterPath);
  const small = readIfPresent(smallPath);
  assert.ok(master, "app/brand/azkript-mark.svg is missing");
  assert.ok(small, "app/brand/azkript-mark-small.svg is missing");

  for (const [name, buf] of [["master", master], ["small", small]]) {
    const viewBox = (buf.toString("utf8").match(/viewBox="([^"]+)"/) || [])[1];
    assert.equal(viewBox, "0 0 48 48", `${name} mark must use the shared 48x48 grid`);
  }
});

test("app/index.html is in sync with the master mark", () => {
  // The generator doubles as the check: --check exits non-zero when stale.
  const out = execFileSync(process.execPath, [path.join(root, "scripts", "sync-brand.cjs"), "--check"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.match(out, /already in sync/);
});

test("both mark symbols are present in the app document", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /<symbol id="i-app-mark" viewBox="0 0 48 48">/);
  assert.match(html, /<symbol id="i-app-mark-small" viewBox="0 0 48 48">/);

  // The small variant re-declares the master's gradient ids, so they must be
  // namespaced or the two definitions collide in one document.
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], [], "duplicate element ids in app/index.html");
});

test("both the titlebar and the Start Center use the shared glyph", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const uses = [...html.matchAll(/<use href="#i-app-mark(-small)?"><\/use>/g)];
  assert.ok(uses.length >= 3, `expected the mark to be used in 3+ lockups, found ${uses.length}`);

  // No hand-drawn geometry may survive alongside the generated symbol: the old
  // mark was styled through these classes, and any hit means a second drawing.
  assert.equal(html.includes("app-mark__page"), false, "found the old hand-drawn page geometry");
  assert.equal(html.includes("app-mark__rule"), false, "found the old hand-drawn rule geometry");
  assert.equal(html.includes("app-mark__fold"), false, "found the old hand-drawn fold geometry");
});

test("the desktop icon set is present and non-trivial", () => {
  for (const name of ["icon.png", "icon-512.png", "icon.ico"]) {
    const file = path.join(assets, name);
    assert.ok(fs.existsSync(file), `desktop/assets/${name} is missing`);
    const { size } = fs.statSync(file);
    assert.ok(size > 2000, `desktop/assets/${name} looks empty (${size} bytes)`);
  }
});

test("the ICO is a real multi-size icon container", () => {
  const ico = fs.readFileSync(path.join(assets, "icon.ico"));
  // ICONDIR: reserved(2)=0, type(2)=1, count(2).
  assert.equal(ico.readUInt16LE(0), 0, "ICO reserved field must be 0");
  assert.equal(ico.readUInt16LE(2), 1, "ICO type field must be 1 (icon)");
  const count = ico.readUInt16LE(4);
  assert.ok(count >= 6, `expected a multi-size ICO, found ${count} entries`);

  // Sizes come from ICONDIRENTRY; a stored 0 means 256.
  const sizes = [];
  for (let i = 0; i < count; i += 1) {
    const offset = 6 + i * 16;
    const width = ico[offset] === 0 ? 256 : ico[offset];
    sizes.push(width);
  }
  for (const expected of [16, 32, 48, 256]) {
    assert.ok(sizes.includes(expected), `ICO should embed a ${expected}px frame, has [${sizes}]`);
  }
});

test("the packaged app points at the generated icon", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.build.win.icon, "desktop/assets/icon.ico");
});

/* Regression: the sprite's global `svg { fill: none; stroke: currentColor }` rule
 * is what makes the 24 px UI icons line drawings. It also inherited into the
 * brand mark, whose geometry is painted with fills, so every plane of the glyph
 * picked up a 1.6 px outline and the icon rendered as a scribble at 42 px. The
 * mark has to opt out of that inherited paint explicitly. This is a cheap static
 * check; the visual proof is in app/brand/preview/mark-large-4x.png. */
test("the mark opts out of the global icon stroke", () => {
  const css = fs.readFileSync(path.join(root, "app", "styles.css"), "utf8");

  const spriteRule = css.match(/^\s*svg\s*\{[^}]*\}/m);
  assert.ok(spriteRule, "expected the global `svg` icon rule in styles.css");
  assert.match(spriteRule[0], /stroke:\s*currentColor/, "sprite rule should stroke UI icons");

  const glyphRule = css.match(/\.app-mark__glyph\s*\{[^}]*\}/);
  assert.ok(glyphRule, "expected an .app-mark__glyph rule in styles.css");
  assert.match(
    glyphRule[0],
    /stroke:\s*none/,
    ".app-mark__glyph must reset the inherited stroke, or the mark renders outlined"
  );
  assert.match(
    glyphRule[0],
    /fill:\s*initial/,
    ".app-mark__glyph must reset the inherited fill: none"
  );
});

/* Regression: the Start Center lockup lost its glyph class during the move to the
 * shared symbol, so the 42 px mark collapsed to 0x0 inside the dialog. Every
 * .app-mark must contain an svg that actually carries the sizing class. */
test("every app-mark lockup carries a sized glyph", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const marks = [...html.matchAll(/<span class="app-mark[^"]*"[^>]*>([\s\S]*?)<\/span>/g)];
  assert.ok(marks.length >= 2, `expected 2+ app-mark lockups, found ${marks.length}`);

  for (const [, inner] of marks) {
    const glyphSvgs = [...inner.matchAll(/<svg[^>]*class="([^"]*)"/g)];
    assert.ok(glyphSvgs.length > 0, "an .app-mark has no svg with a glyph class (sizes to 0x0)");
    for (const [, classes] of glyphSvgs) {
      assert.match(
        classes,
        /app-mark__glyph/,
        `mark svg is missing app-mark__glyph (classes: "${classes}")`
      );
    }
  }
});

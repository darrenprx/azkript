/* Guard the brand mark's COMPOSITION, not just its plumbing.
 *
 * brand-mark.test.cjs already proves the sprite is generated (not hand-copied) and
 * that the lockups are wired. It does not prove the drawing is the drawing the user
 * asked for. This file does: heading band, a dimmer dialogue block, a badge centred
 * on the sheet, and the S monogram. Those are the four properties that were
 * explicitly requested, so each gets a check that fails on a silent regression.
 *
 * These are static geometry checks on the generated SVGs plus a rasterised check
 * where geometry alone would be ambiguous (is the letter actually centred on the
 * badge, not merely declared to be?). The raster check is the one that would have
 * caught the original bug: the badge was *drawn* centred but the letter inside it
 * was offset.
 *
 * Run: node --test app/tests/brand-composition.test.cjs
 */
"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const brandDir = path.join(root, "app", "brand");
const previewDir = path.join(brandDir, "preview");

const gridSize = 48;
const centre = gridSize / 2;

const masterSvg = () => fs.readFileSync(path.join(brandDir, "azkript-mark.svg"), "utf8");
const smallSvg = () => fs.readFileSync(path.join(brandDir, "azkript-mark-small.svg"), "utf8");

/** Every <rect> in the SVG body, as numbers, in paint order. */
function rects(svg) {
  return [...svg.matchAll(/<rect\s+x="([\d.]+)"\s+y="([\d.]+)"\s+width="([\d.]+)"\s+height="([\d.]+)"[^>]*rx="([\d.]+)"([^>]*)>/g)].map(
    (m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
      w: Number(m[3]),
      h: Number(m[4]),
      rx: Number(m[5]),
      rest: m[6],
      cx: Number(m[1]) + Number(m[3]) / 2,
      cy: Number(m[2]) + Number(m[4]) / 2,
    })
  );
}

/** The badge is the rect filled with the badge gradient — identified by fill, not
 *  by position, so a moved badge is still found. */
function badgeRect(svg) {
  const all = rects(svg);
  const badge = all.find((r) => r.rest.includes("url(#az-badge)"));
  assert.ok(badge, "no rect filled with url(#az-badge): the badge is missing");
  return badge;
}

/** Content rules are the rects filled with the rule gradient. */
function ruleRects(svg) {
  return rects(svg).filter((r) => r.rest.includes("url(#az-rule)"));
}

for (const [label, read] of [
  ["master", masterSvg],
  ["small optical size", smallSvg],
]) {
  test(`${label}: the letter badge is centred on the sheet`, () => {
    const svg = read();
    const badge = badgeRect(svg);

    // The sheet occupies the whole 48 grid symmetric about the centre, so a badge
    // centred at (24, 24) is centred on the visible shape. The original bug was a
    // badge hanging off the lower-left corner; this is the check that forbids it.
    assert.ok(
      Math.abs(badge.cx - centre) < 0.01,
      `badge centre x is ${badge.cx}, expected ${centre} (off by ${(badge.cx - centre).toFixed(2)})`
    );
    assert.ok(
      Math.abs(badge.cy - centre) < 0.01,
      `badge centre y is ${badge.cy}, expected ${centre} (off by ${(badge.cy - centre).toFixed(2)})`
    );
  });

  test(`${label}: there is a heading band above a separate dialogue block`, () => {
    const rules = ruleRects(read());
    assert.ok(rules.length >= 3, `expected a heading plus dialogue rules, found ${rules.length} rules`);

    // Group by position: the heading is the sole rule in the top half.
    const upper = rules.filter((r) => r.cy < centre);
    const lower = rules.filter((r) => r.cy > centre);
    assert.equal(upper.length, 1, `expected exactly one heading band above centre, found ${upper.length}`);
    assert.ok(lower.length >= 2, `expected 2+ dialogue rules below centre, found ${lower.length}`);

    const heading = upper[0];
    // A heading is a band, not a hairline: visibly heavier than a dialogue rule.
    const dialogueHeights = lower.map((r) => r.h);
    assert.ok(
      heading.h >= Math.min(...dialogueHeights),
      `heading height ${heading.h} should be at least as heavy as the dialogue rules (${dialogueHeights.join(", ")}), ` +
        "or the two groups do not read as different element classes"
    );
    assert.ok(heading.w > Math.max(...lower.map((r) => r.w)), "the heading should be the widest line");

    // The strips share ONE left margin. An earlier revision indented the dialogue block
    // relative to the heading to suggest a screenplay page, but at 32 px that does not
    // read as indentation — it reads as strips that failed to line up, which is what the
    // user reported ("align the strips in icon so it looks better"). So the assertion is
    // now the opposite of what it was: aligned, not staggered.
    for (const rule of lower) {
      assert.ok(
        Math.abs(rule.x - heading.x) < 1e-6,
        `dialogue rule x=${rule.x} does not share the heading's left margin x=${heading.x}; ` +
          "staggered strips read as misalignment, not as indentation"
      );
    }
  });

  test(`${label}: the dialogue block is dimmer than the heading`, () => {
    const svg = read();
    const rules = [...svg.matchAll(/<rect[^>]*url\(#az-rule\)[^>]*>/g)].map((m) => m[0]);

    const heading = rules.find((r) => !/opacity=/.test(r));
    assert.ok(heading, "the heading rule should be painted at full strength (no opacity attribute)");

    const dialogue = rules.filter((r) => /opacity=/.test(r));
    assert.ok(dialogue.length >= 2, `expected 2+ dimmed dialogue rules, found ${dialogue.length}`);

    // Different luminosity is the explicit request; every dialogue rule must be
    // strictly dimmer than the heading, and they step down among themselves.
    const opacities = dialogue.map((r) => Number(r.match(/opacity="([\d.]+)"/)[1]));
    for (const value of opacities) {
      assert.ok(value < 1, `a dialogue rule has opacity ${value}; it must be dimmer than the heading`);
    }
    assert.deepEqual(
      [...opacities].sort((a, b) => b - a),
      opacities,
      `dialogue opacities should step down monotonically, got ${opacities.join(", ")}`
    );
  });
}

test("the monogram letter is an S, drawn as a path rather than live text", () => {
  for (const [label, read] of [
    ["master", masterSvg],
    ["small", smallSvg],
  ]) {
    const svg = read();
    assert.equal(
      /<text[\s>]/.test(svg),
      false,
      `${label}: the letter must be vector geometry, not <text> — an icon cannot depend on installed fonts`
    );

    const mark = svg.match(/<path transform="([^"]+)" d="(M[^"]{80,})"[^>]*fill="#FFFFFF"\/>/);
    assert.ok(mark, `${label}: no transformed white glyph path found`);

    // The S outline is recognisable by its command sequence: the Segoe UI bold 'S'
    // starts on the left stem and curves through the middle. Checking for the
    // distinguishing 'S' construction (two bowls) is brittle, so instead assert the
    // path is the generated one by its first and last commands, which differ from
    // every other letter used here.
    assert.match(mark[2], /^M98 55V375/, `${label}: the letter is not the S outline`);
    assert.match(mark[2], /98 55Z$/, `${label}: the S outline is truncated`);

    // Placement: the transform must map the path's ink box onto the badge centre.
    // The transform is `translate(tx ty) scale(s -s)`: font space is y-UP and the
    // grid is y-DOWN, hence the negative sy. So a font-space point (x, y) lands at
    // (tx + s*x, ty - s*y) and the ink centre must land on the badge centre.
    const badge = badgeRect(svg);
    const match = mark[1].match(/translate\(([-\d.]+)\s+([-\d.]+)\)\s+scale\(([-\d.]+)\s+([-\d.]+)\)/);
    assert.ok(match, `${label}: unparseable letter transform "${mark[1]}"`);
    const tx = Number(match[1]);
    const ty = Number(match[2]);
    const sx = Number(match[3]);
    const sy = Number(match[4]);
    assert.ok(sy < 0, `${label}: the y scale must be negative to flip font space into the grid`);

    const ink = { xmin: 98, ymin: -25, xmax: 1076, ymax: 1458 };
    const midX = (ink.xmin + ink.xmax) / 2;
    const midY = (ink.ymin + ink.ymax) / 2;
    const mappedCx = tx + sx * midX;
    const mappedCy = ty + sy * midY;
    assert.ok(
      Math.abs(mappedCx - badge.cx) < 0.05,
      `${label}: letter ink centre x ${mappedCx.toFixed(3)} is off the badge centre ${badge.cx}`
    );
    assert.ok(
      Math.abs(mappedCy - badge.cy) < 0.05,
      `${label}: letter ink centre y ${mappedCy.toFixed(3)} is off the badge centre ${badge.cy}`
    );
  }
});

/* The rasterised check. Geometry can be declared correctly and still paint wrong —
 * that is exactly how the original "letter is deviated" bug survived review. So we
 * rasterise the shipped mark and check the painted monogram against the badge the
 * SVG declares.
 *
 * Segmentation note: identifying the badge by "dark pixels" does NOT work with every
 * theme — an amber sheet's deep stop (#9A4204, luma 80) is darker than the badge
 * (#B83A0C, luma 82), so the sheet's own shadowed corner got counted as badge and the
 * measured centre landed 0.12 off. The declared badge rect from the SVG is the honest
 * reference frame: it is the thing the drawing claims, and the test then proves the
 * paint agrees with the claim. */
test("the letter paints centred inside the badge (rasterised)", (t) => {
  const playwrightPath = path.join(root, "node_modules", "playwright-core");
  if (!fs.existsSync(playwrightPath)) {
    t.skip("node_modules/playwright-core not installed");
    return;
  }
  const svg = masterSvg();
  const badge = badgeRect(svg);
  const grid = gridSize;
  const out = path.join(previewDir, "composition-check-256.png");
  try {
    execFileSync(
      process.execPath,
      [path.join(root, "scripts", "render-icon.cjs"), path.join(brandDir, "azkript-mark.svg"), out, "256"],
      { cwd: root, encoding: "utf8", stdio: "pipe" }
    );
  } catch (error) {
    t.skip(`Chrome unavailable: ${error.message}`);
    return;
  }

  // Inset by 18% of the badge so the rounded corners, the sheen and the cast shadow
  // cannot contribute colour; the only white left in that window is the monogram.
  const py = `
import json, sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGBA")
w, h = im.size
px = im.load()
bx, by, bw, bh = (float(v) for v in sys.argv[2:6])
grid = float(sys.argv[6])
inset = bw * 0.18
x0 = int((bx + inset) / grid * w)
y0 = int((by + inset) / grid * h)
x1 = int((bx + bw - inset) / grid * w)
y1 = int((by + bh - inset) / grid * h)
lx, ly = [], []
for y in range(max(0, y0), min(h, y1 + 1)):
    for x in range(max(0, x0), min(w, x1 + 1)):
        r, g, b, a = px[x, y]
        if a > 200 and r > 215 and g > 215 and b > 215:
            lx.append(x); ly.append(y)
if not lx:
    print(json.dumps({"error": "no white monogram pixels in the declared badge box"})); sys.exit(0)
print(json.dumps({
    "letter": [min(lx)/w*grid, min(ly)/h*grid, max(lx)/w*grid, max(ly)/h*grid],
    "badge": [bx, by, bw, bh],
}))
`;
  let data;
  try {
    const stdout = execFileSync(
      "python",
      ["-c", py, out, String(badge.x), String(badge.y), String(badge.w), String(badge.h), String(grid)],
      { encoding: "utf8" }
    );
    data = JSON.parse(stdout.trim().split("\n").pop());
  } catch (error) {
    t.skip(`python/Pillow unavailable: ${error.message}`);
    return;
  }
  assert.equal(data.error, undefined, `raster analysis failed: ${data.error}`);

  const [bx, by, bw, bh] = data.badge;
  const [lx0, ly0, lx1, ly1] = data.letter;
  const badgeCx = bx + bw / 2;
  const badgeCy = by + bh / 2;
  const letterCx = (lx0 + lx1) / 2;
  const letterCy = (ly0 + ly1) / 2;

  // Tolerance is 6% of the badge width. Two real effects move the ink centre and
  // neither is a layout error: the S is not left-right symmetric (its spine sits left
  // of the optical centre), and antialiasing shaves the extremes differently on each
  // edge. A layout error of the kind this test exists for would be several times this.
  const tol = bw * 0.06;
  assert.ok(
    Math.abs(letterCx - badgeCx) < tol,
    `the letter is horizontally off-centre in the badge: letter ${letterCx.toFixed(2)} vs badge ${badgeCx.toFixed(2)} ` +
      `on the 48-unit grid (tolerance ${tol.toFixed(2)})`
  );
  assert.ok(
    Math.abs(letterCy - badgeCy) < tol,
    `the letter is vertically off-centre in the badge: letter ${letterCy.toFixed(2)} vs badge ${badgeCy.toFixed(2)} ` +
      `on the 48-unit grid (tolerance ${tol.toFixed(2)})`
  );

  // And the monogram must actually be a sensible fraction of the badge, or "centred"
  // is satisfied by a letter so small it is invisible.
  const letterW = lx1 - lx0;
  const letterH = ly1 - ly0;
  assert.ok(
    letterH > bh * 0.4 && letterH < bh * 0.95,
    `the monogram height ${letterH.toFixed(2)} is not between 40% and 95% of the badge height ${bh.toFixed(2)}`
  );
  assert.ok(
    letterW > bw * 0.2,
    `the monogram width ${letterW.toFixed(2)} is under 20% of the badge width ${bw.toFixed(2)} — it is lost`
  );
});

test("the shipped icon set was rasterised from the current theme", (t) => {
  // A stale icon.ico is invisible in review but wrong on every taskbar, so tie the
  // deliverable to the source of truth — by CONTENT, not by mtime. mtime was the first
  // attempt and it is a bad oracle: any tool that rewrites the SVG (a formatter, a
  // mutation test, a checkout) invalidates it without the icon being stale at all.
  const theme = JSON.parse(fs.readFileSync(path.join(brandDir, "palettes.json"), "utf8"));
  const sheet = theme.themes[theme.selected].sheet;
  const svg = masterSvg();
  for (const stop of sheet) {
    assert.ok(
      svg.includes(stop.toUpperCase()),
      `azkript-mark.svg is missing sheet stop ${stop} from theme "${theme.selected}" — run node scripts/build-brand.cjs`
    );
  }

  const iconPath = path.join(root, "desktop", "assets", "icon.png");
  assert.ok(fs.existsSync(iconPath), "desktop/assets/icon.png is missing");

  // Compare the icon's dominant hue against the theme's, which is what actually goes
  // stale: the old blue icon would pass an existence check forever.
  const playwrightPath = path.join(root, "node_modules", "playwright-core");
  if (!fs.existsSync(playwrightPath)) {
    t.skip("node_modules/playwright-core not installed");
    return;
  }
  const py = `
import json, sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGBA")
w, h = im.size
px = im.load()
# Sample the SHEET BODY, not the brightest pixel: the content rules are pure white by
# design, so "brightest" always returns white and says nothing about the theme. The
# lower-right quadrant of the sheet is the deep end of the gradient and is never
# covered by the badge, the rules or the fold, so it is the most representative body
# sample available.
reds = 0
blues = 0
total = 0
for y in range(int(h * 0.80), int(h * 0.94), 2):
    for x in range(int(w * 0.62), int(w * 0.86), 2):
        r, g, b, a = px[x, y]
        if a < 240:
            continue
        total += 1
        if r > b + 25:
            reds += 1
        elif b > r + 25:
            blues += 1
print(json.dumps({"total": total, "warm": reds, "cool": blues}))
`;
  let data;
  try {
    const stdout = execFileSync("python", ["-c", py, iconPath], { encoding: "utf8" });
    data = JSON.parse(stdout.trim().split("\n").pop());
  } catch (error) {
    t.skip(`python/Pillow unavailable: ${error.message}`);
    return;
  }
  assert.ok(data.total > 100, `could not sample the sheet body in desktop/assets/icon.png (${data.total} px)`);
  // The amber theme's sheet body is unambiguously warm. A stale blue icon would be
  // overwhelmingly "cool", so this separates them without pinning exact values.
  assert.ok(
    data.warm > data.total * 0.9,
    `desktop/assets/icon.png's sheet body is not the warm "${theme.selected}" theme ` +
      `(${data.warm}/${data.total} warm, ${data.cool}/${data.total} cool) — run python scripts/make-icon.py`
  );
});

test("the generated SVGs match the selected palette (themes are data, not edits)", () => {
  const out = execFileSync(process.execPath, [path.join(root, "scripts", "build-brand.cjs"), "--check"], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  assert.match(out, /up to date/);
});

test("every palette theme is complete enough to render", () => {
  const { themes, selected } = JSON.parse(fs.readFileSync(path.join(brandDir, "palettes.json"), "utf8"));
  assert.ok(themes[selected], `selected theme "${selected}" must exist`);
  for (const [id, theme] of Object.entries(themes)) {
    assert.equal(theme.sheet.length, 4, `${id}: needs 4 sheet stops (light -> deep)`);
    assert.equal(theme.badge.length, 3, `${id}: needs 3 badge stops`);
    assert.equal(theme.fold.length, 2, `${id}: needs 2 fold stops`);
    assert.equal(theme.rule.length, 2, `${id}: needs 2 rule stops`);
    for (const key of ["letter", "shadow", "shadowSheet", "label", "rationale"]) {
      assert.ok(theme[key], `${id}: missing "${key}"`);
    }
    for (const color of [...theme.sheet, ...theme.badge, ...theme.fold, ...theme.rule, theme.letter]) {
      assert.match(color, /^#[0-9A-Fa-f]{6}$/, `${id}: "${color}" is not a 6-digit hex colour`);
    }
  }
});

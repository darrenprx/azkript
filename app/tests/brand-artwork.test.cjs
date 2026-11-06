/* Guard the two artwork defects the user reported on the brand mark.
 *
 * 1. "The folded part's corner is not rounded" — the turned-corner cut met the sheet's
 *    right edge at an acute 45-degree point, which renders as a visible SPIKE at every
 *    size. Rounding the fold's own path could not fix it, because the sheet's silhouette
 *    came to the same point: if only one of the two shapes is rounded, the other's
 *    corner still pokes through. So the fillet has to live on the sheet outline and the
 *    fold must be clipped to that outline.
 *
 *    Follow-up, same user: "you only fix one corner of the fold last time". Correct — the
 *    first fix filleted the OUTER vertex only and this file used to assert just that one.
 *    Both ends of the cut are convex 135-degree corners and both are now filleted, and
 *    the crease (the upper end) is the softer of the two.
 *
 * 2. "Align the strips in icon so it looks better" — the content strips were sized by
 *    independent hand-computed x/width pairs, so the left margins staggered and the
 *    right ends disagreed (heading ended at 30.6, first dialogue rule at 30.2; in the
 *    small optical size a dialogue rule OVERSHOT the heading by 3.2 units). Strips now
 *    derive from one shared left edge and one shared right edge.
 *
 * Both checks read the GENERATED SVG, because that is the artefact that ships, and both
 * are structural: they assert the invariant rather than a snapshot of coordinates, so a
 * legitimate layout change does not fail them but a regression to the old geometry does.
 *
 * Run: node --test app/tests/brand-artwork.test.cjs
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const brandDir = path.join(root, "app", "brand");

const marks = [
  ["master", path.join(brandDir, "azkript-mark.svg")],
  ["small optical size", path.join(brandDir, "azkript-mark-small.svg")],
];

const read = (file) => fs.readFileSync(file, "utf8");

/** Every <rect> painted with the rule gradient, as numbers. */
function stripRects(svg) {
  return [
    ...svg.matchAll(
      /<rect\s+x="([\d.]+)"\s+y="([\d.]+)"\s+width="([\d.]+)"\s+height="([\d.]+)"[^>]*url\(#az-rule\)[^>]*>/g
    ),
  ].map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));
}

for (const [label, file] of marks) {
  test(`${label}: every content strip shares one left margin`, () => {
    const strips = stripRects(read(file));
    assert.ok(strips.length >= 3, `expected 3+ strips, found ${strips.length}`);
    const lefts = strips.map((s) => s.x);
    const unique = [...new Set(lefts.map((v) => v.toFixed(3)))];
    assert.equal(
      unique.length,
      1,
      `strips have staggered left edges [${lefts.join(", ")}]; they must share one margin, ` +
        "or the ladder reads as strips that failed to line up"
    );
  });

  test(`${label}: strips shorten from a shared right edge, never overshoot`, () => {
    const strips = stripRects(read(file));
    const rights = strips.map((s) => s.x + s.w);
    const longest = Math.max(...rights);
    // The longest strip defines the block's right edge; every other strip must end at or
    // before it, and no strip may poke past it (the small variant did, by 3.2 units).
    for (const right of rights) {
      assert.ok(
        right <= longest + 1e-6,
        `a strip ends at ${right.toFixed(2)}, past the block's right edge ${longest.toFixed(2)}`
      );
    }
    // At least one strip must reach the edge, otherwise the "shared right edge" is not
    // actually being used and the alignment is coincidental.
    assert.ok(
      rights.filter((r) => Math.abs(r - longest) < 1e-6).length >= 1,
      "no strip reaches the block's right edge"
    );
  });

  test(`${label}: BOTH ends of the turned-corner cut are filleted, not just one`, () => {
    const svg = read(file);
    const sheet = svg.match(/<path d="([^"]+)" fill="url\(#az-page\)"\/>/);
    assert.ok(sheet, "no sheet path found");
    const d = sheet[1];

    // Tokenise the path into commands with their absolute endpoints. Only the commands
    // the generator emits are handled, which keeps this readable and is enough to assert
    // the geometric property that matters.
    const tokens = d.match(/[MHVLAZ]|-?[\d.]+/g) || [];
    const points = [];
    let i = 0;
    let cur = { x: 0, y: 0 };
    while (i < tokens.length) {
      const cmd = tokens[i++];
      if (cmd === "M" || cmd === "L") {
        cur = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
        points.push({ cmd, ...cur });
      } else if (cmd === "H") {
        cur = { x: Number(tokens[i++]), y: cur.y };
        points.push({ cmd, ...cur });
      } else if (cmd === "V") {
        cur = { x: cur.x, y: Number(tokens[i++]) };
        points.push({ cmd, ...cur });
      } else if (cmd === "A") {
        const radius = Number(tokens[i]);
        i += 5; // rx ry rot large sweep
        cur = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
        points.push({ cmd, ...cur, radius });
      }
    }

    // Find the diagonal: a line whose dx and dy are both materially non-zero.
    const diagIndex = points.findIndex((p, index) => {
      if (p.cmd !== "L" || index === 0) return false;
      const dx = p.x - points[index - 1].x;
      const dy = p.y - points[index - 1].y;
      return Math.abs(dx) > 1 && Math.abs(dy) > 1 && Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.5;
    });
    assert.ok(diagIndex !== -1, `expected a 45-degree diagonal L segment in the sheet outline: ${d}`);

    /* THE DEFECT THIS TEST EXISTS FOR, SECOND TIME ROUND.
     *
     * The cut has TWO 135-degree ends:
     *   - the CREASE, where the top edge turns onto the diagonal (before the diagonal);
     *   - the OUTER vertex, where the diagonal meets the right edge (after it).
     * The first fix filleted only the outer one and argued in a long comment that the
     * crease should stay sharp "by design". The user looked at it and said the icon was
     * still only half fixed, which was correct: one sharp end and one round end reads as
     * an unfinished corner, not as a deliberate crease.
     *
     * So both neighbours of the diagonal must be arcs, and BOTH must clear the pull
     * threshold. Asserting "an arc exists somewhere" is what let the original spike ship
     * twice, because a shallow fillet emits a real arc and still moves the silhouette by
     * 0.08 * radius — invisible. Assert the MAGNITUDE. */
    const PULL_RATIO = 1 / Math.sin((67.5 * Math.PI) / 180) - 1; // 0.0824
    const before = points[diagIndex - 1];
    const after = points[diagIndex + 1];
    const pull = (arc) => arc.radius * PULL_RATIO;

    for (const [where, arc] of [
      ["crease (where the top edge turns onto the diagonal)", before],
      ["outer vertex (where the diagonal meets the right edge)", after],
    ]) {
      assert.ok(
        arc && arc.cmd === "A" && Number.isFinite(arc.radius),
        `the ${where} is still a sharp 45-degree point: no arc fillets it. ` +
          `Both ends of the cut must be rounded, or the corner reads as half finished. Sheet path: ${d}`
      );
      assert.ok(
        pull(arc) >= 0.8,
        `the ${where} fillet has radius ${arc.radius.toFixed(2)}, which pulls the silhouette in by only ` +
          `${pull(arc).toFixed(2)} units — under a device pixel at icon sizes, so it still reads as an ` +
          "acute point. A radius of about 10+ units is needed (pull = 0.0824 * radius)"
      );
    }

    // The straight run between the two fillets must survive, or the fold stops reading as
    // a turned corner and the top-right becomes a generic rounded rectangle — which is the
    // failure mode the old comment was worried about, and it is a real one.
    const straight = Math.hypot(points[diagIndex].x - before.x, points[diagIndex].y - before.y);
    assert.ok(
      straight > 2,
      `only ${straight.toFixed(2)} units of straight diagonal remain between the two fillets; ` +
        "the fold no longer reads as a fold"
    );
    // And the two fillets must not overlap each other along the diagonal.
    const consumed = (before.radius + after.radius) * Math.tan(Math.PI / 8);
    const diagonal = straight + consumed;
    assert.ok(
      consumed < diagonal,
      `the two fillets consume ${consumed.toFixed(2)} units of a ${diagonal.toFixed(2)}-unit diagonal`
    );
  });

  test(`${label}: the fold is clipped to the sheet silhouette`, () => {
    const svg = read(file);
    // The fold must inherit the sheet's rounded cut rather than rounding itself, so it
    // has to be drawn inside the sheet clip. Without this, the sheet's fillet and the
    // fold's own edge can disagree and leave a sliver of sheet visible in the notch.
    assert.match(
      svg,
      /<clipPath id="az-sheet-clip">/,
      "expected an az-sheet-clip so the fold inherits the sheet's rounded cut"
    );
    assert.match(
      svg,
      /<g clip-path="url\(#az-sheet-clip\)">[\s\S]*?url\(#az-fold\)/,
      "the fold path is not inside the sheet clip"
    );
  });
}

test("both optical sizes fillet the cut and share strip margins", () => {
  // The defect existed in master and small independently, so prove the two agree in
  // KIND (not in numbers — the small variant is deliberately different in scale).
  for (const [label, file] of marks) {
    const svg = read(file);
    assert.match(svg, /<clipPath id="az-sheet-clip">/, `${label}: missing sheet clip`);
    const strips = stripRects(svg);
    const lefts = new Set(strips.map((s) => s.x.toFixed(3)));
    assert.equal(lefts.size, 1, `${label}: strips do not share a left margin`);
  }
});

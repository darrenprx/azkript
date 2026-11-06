/* Shared mark geometry + palette application for the brand SVG pipeline.
 *
 * The mark is ONE drawing rendered into two optical sizes and N colour themes.
 * Its shape lives here, once; the colour lives in app/brand/palettes.json.
 * `scripts/build-brand.cjs` bakes the selected theme into
 * app/brand/azkript-mark.svg + azkript-mark-small.svg, which are in turn the
 * source for the in-app sprite (scripts/sync-brand.cjs) and the desktop icon set
 * (scripts/make-icon.py). `scripts/brand-lab.cjs` renders every theme
 * side by side for comparison.
 *
 * Why a generator at all: the previous layout put the letter badge in the
 * lower-left corner, hanging off the sheet, and stacked four undifferentiated
 * content rules. The requested layout is a centred monogram with the screenplay
 * ladder split into a heading band and a dimmer dialogue block. Exploring that
 * layout by hand-editing two SVG files per colour candidate is how icon sets
 * drift; generating both sizes and every candidate from one geometry is not.
 */
"use strict";

/* ---- The consonant that belongs on the badge -------------------------------
 * "S" for Screenplay / Script. It is a real outline, not <text>: an icon must not
 * depend on the installed font set, and a live text node picked up subpixel colour
 * fringing when Chrome rasterised it.
 *
 * Extracted once from Segoe UI BOLD (not Semibold) with scripts/extract-letter.py.
 * The Office icon family draws its monogram letters at a heavier weight than body
 * text — at badge size a Semibold S reads thin and fragile, and its stroke
 * contrast collapses to a wobble once the badge is resampled to 16 px. The bold
 * outline keeps even stroke width at small sizes. */
const S_OUTLINE =
  "M98 55V375Q185 302 287 266Q389 229 493 229Q554 229 600 240Q645 251 676 270" +
  "Q706 290 721 316Q736 343 736 374Q736 416 712 449Q688 482 646 510Q605 538 548 564" +
  "Q491 590 425 617Q257 687 174 788Q92 889 92 1032Q92 1144 137 1224Q182 1305 260 1357" +
  "Q337 1409 439 1434Q541 1458 655 1458Q767 1458 854 1444Q940 1431 1013 1403V1104" +
  "Q977 1129 934 1148Q892 1167 847 1180Q802 1192 758 1198Q713 1204 673 1204" +
  "Q618 1204 573 1194Q528 1183 497 1164Q466 1145 449 1118Q432 1092 432 1059" +
  "Q432 1023 451 994Q470 966 505 940Q540 915 590 890Q640 866 703 840Q789 804 858 764" +
  "Q926 723 975 672Q1024 621 1050 556Q1076 490 1076 403Q1076 283 1030 202" +
  "Q985 120 907 70Q829 19 726 -3Q622 -25 507 -25Q389 -25 282 -5Q176 15 98 55Z";

/* Ink box of the outline above, in font units (y-up). BoundsPen reports these for
 * Segoe UI Bold 'S' at unitsPerEm 2048. Needed to place the glyph by its ink rather
 * than by its advance width, which is what makes optical centring work. */
const S_INK = { xmin: 92, ymin: -25, xmax: 1076, ymax: 1458 };
const S_INK_W = S_INK.xmax - S_INK.xmin;
const S_INK_H = S_INK.ymax - S_INK.ymin;

/** Transform that scales the S ink box to `box` tall and centres it on (cx, cy). */
function letterTransform(cx, cy, box) {
  const s = box / S_INK_H;
  const midX = (S_INK.xmin + S_INK.xmax) / 2;
  const midY = (S_INK.ymin + S_INK.ymax) / 2;
  const tx = cx - midX * s;
  const ty = cy + midY * s; // y flips: font space is y-up, the grid is y-down
  return {
    s,
    tx,
    ty,
    // Written as an SVG transform so the outline can stay in its native units.
    value: `translate(${fmt(tx)} ${fmt(ty)}) scale(${fmt(s)} ${fmt(-s)})`,
    placedWidth: S_INK_W * s,
  };
}

function fmt(n, decimals = 4) {
  const text = n.toFixed(decimals);
  return text.replace(/\.?0+$/, "") || "0";
}

/* ---- Geometry --------------------------------------------------------------
 *
 * One vertical rhythm, shared by both optical sizes: a heading band at the top, the
 * monogram badge dead centre, then the dialogue block in the lower third. The
 * dialogue rules are indented relative to the heading, because that is what makes
 * the two groups read as a screenplay page (a slugline, then indented speech)
 * rather than as generic "content lines".
 *
 * The badge is centred on the SHEET, not on the ink: (24, 24) of the 48 grid. An
 * earlier revision hung it off the lower-left corner, which is the deviation this
 * layout fixes.
 *
 * Luminosity is the second signal that these are two different element classes:
 * the heading is drawn at full strength, the dialogue steps down. Both use the same
 * rule gradient, so the difference is opacity only — no second colour to keep in
 * sync per theme.
 */
const TAN_22_5 = Math.tan(Math.PI / 8); // 0.414214

/**
 * Fillet ONE end of the turned-corner cut.
 *
 * Both ends of the cut are convex 135-degree corners, so both take the same
 * construction: tangent length `t = radius * tan(22.5deg)` measured back along the
 * incoming edge and forward along the outgoing edge, with the arc replacing the
 * point entirely. The caller supplies the two unit edge directions, which is what
 * lets the crease and the outer vertex share one implementation.
 *
 * Why the radius has to be generous: the silhouette only moves inward by
 * `radius * (1/sin 67.5deg - 1) = 0.082 * radius` at a corner this shallow, so a
 * small radius emits a real arc that is invisible in pixels. The previous revision
 * used 4.2 units here and shipped a spike twice for exactly that reason.
 *
 * Both ends turn CLOCKWISE in the 48-unit grid (y down), so both arcs use SVG
 * sweep-flag 1.
 */
function cutoffFillet(vertex, dIn, dOut, radius) {
  const t = radius * TAN_22_5;
  const p0 = { x: vertex.x - dIn.x * t, y: vertex.y - dIn.y * t };
  const p1 = { x: vertex.x + dOut.x * t, y: vertex.y + dOut.y * t };
  return {
    p0,
    p1,
    t,
    arc: `A${fmt(radius)} ${fmt(radius)} 0 0 1 ${fmt(p1.x)} ${fmt(p1.y)}`,
  };
}

const SQRT1_2 = 1 / Math.SQRT2;
const DIR_EAST = { x: 1, y: 0 };
const DIR_SOUTH = { x: 0, y: 1 };
const DIR_SE = { x: SQRT1_2, y: SQRT1_2 }; // along the diagonal, toward the outer vertex

/* The turned-corner cut, as the sheet's silhouette sees it.
 *
 * Exported so the verification tools measure the SAME numbers the drawing uses
 * instead of re-deriving the geometry (and drifting from it). */
function cutGeometry(g) {
  const { right: R, top: T, fold: f } = g.sheet;
  const crease = { x: R - f, y: T };   // top edge turns onto the diagonal
  const outer = { x: R, y: T + f };    // diagonal meets the right edge
  const creaseFillet = cutoffFillet(crease, DIR_EAST, DIR_SE, g.sheet.creaseRadius);
  const outerFillet = cutoffFillet(outer, DIR_SE, DIR_SOUTH, g.sheet.cutRadius);
  // How much straight diagonal is left between the two fillets. The fold stops
  // reading as a fold if this closes up, so the generator asserts it is positive.
  const diagonal = f * Math.SQRT2;
  const straight = diagonal - creaseFillet.t - outerFillet.t;
  if (!(straight > 0.5)) {
    throw new Error(
      `fold geometry collapsed: the two corner fillets consume ${fmt(
        creaseFillet.t + outerFillet.t
      )} units of the ${fmt(diagonal)}-unit diagonal, leaving ${fmt(straight)}. ` +
        `creaseRadius=${g.sheet.creaseRadius} cutRadius=${g.sheet.cutRadius} fold=${f} ` +
        `(creaseRadius * tan22.5 + cutRadius * tan22.5 must stay below fold * sqrt(2) - 0.5)`
    );
  }
  return { crease, outer, creaseFillet, outerFillet, diagonal, straight };
}

function sheetPath(g) {
  const { left: L, right: R, bottom: B, top: T, radius: r } = g.sheet;
  const { creaseFillet, outerFillet } = cutGeometry(g);

  return [
    `M${fmt(L + r)} ${fmt(T)}`,
    // Top edge, stopped where the crease fillet begins.
    `H${fmt(creaseFillet.p0.x)}`,
    creaseFillet.arc,
    // Straight run down the diagonal between the two fillets.
    `L${fmt(outerFillet.p0.x)} ${fmt(outerFillet.p0.y)}`,
    outerFillet.arc,
    `V${fmt(B - r)}`,
    `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(R - r)} ${fmt(B)}`,
    `H${fmt(L + r)}`,
    `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(L)} ${fmt(B - r)}`,
    `V${fmt(T + r)}`,
    `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(L + r)} ${fmt(T)}`,
    "Z",
  ].join(" ");
}

const MASTER = {
  size: 48,
  sheet: {
    left: 5.2,
    right: 42.8,
    top: 3.6,
    bottom: 44.4,
    // 5.2/48 = 10.8% of the width. The previous 3.6 (7.5%) measured 3.3 units in the
    // raster and read as a barely-rounded square next to Office, whose sheets sit
    // around 10-12%. Measured on the shipped 1024 px PNG.
    radius: 5.2,
    fold: 12.8,
    /* Radius of the fillet at the OUTER vertex of the turned-corner cut.
     *
     * This was 4.2 and it did not work, twice. The geometry was right — an arc really was
     * emitted, and the 1024 px master looked rounded on a zoomed crop — but a fillet on a
     * 135-degree corner only pulls the silhouette inward by
     *     r * (1/sin 67.5deg - 1) = 0.082 * r
     * At 4.2 units that is 0.35 units: less than one device pixel at every size a user
     * actually looks at, so the corner still read as the acute 45-degree point it was.
     *
     * The lesson generalises and is worth keeping: for a SHALLOW corner the radius has to
     * be several times larger than intuition suggests, because the arc is nearly tangent
     * to both edges and removes almost no area. 13.0 units gives a 1.07-unit pull — a
     * full device pixel at 48 px — which scripts/fold-lab.cjs shows reading as rounded,
     * and which is close to how Office rounds this same corner. */
    cutRadius: 13.0,
    /* Radius at the CREASE: the upper end, where the top edge turns onto the diagonal.
     *
     * The previous revision left this one sharp and argued in this comment that rounding
     * it would turn the top-right into a generic rounded rectangle. That argument was
     * wrong, and the user said so: a sharp point at ONE end of the cut and a fillet at the
     * other reads as a half-finished corner, not as a deliberate crease.
     *
     * The correct rule, measured from the shell's own document icons (imageres.dll
     * #2/#14, and Office's sheet forms): BOTH ends of the cut are softened, and the crease
     * is the SOFTER of the two because it is the end a reader's eye follows first.
     *
     * It is deliberately larger than cutRadius: 0.082 * 17.5 = 1.44 units of inward pull
     * (half a device pixel at 32 px, 1.4 px at 48 px), which is what makes the junction
     * read as a fold rather than a notch. The two tangent lengths must still leave a
     * straight diagonal between them, which they do: 12.8 * sqrt(2) = 18.1 units of
     * diagonal against 17.5 * tan(22.5) + 13.0 * tan(22.5) = 12.6 units consumed.
     * scripts/fold-lab.cjs measures both pulls at real pixel sizes and fails if either
     * drops below 0.8 units. */
    creaseRadius: 17.5,
  },
  badge: { size: 15.6, radius: 4.4, letter: 9.2 },
  /* Content strips share BOTH a left margin and a right margin, and are never sized by
   * independent x/width pairs.
   *
   * That was a real defect twice over. First, the strips had hand-computed widths that
   * did not agree: the heading ended at 30.6 while the first dialogue rule ended at
   * 30.2, and in the small optical size the dialogue rule OVERSHOT the heading by 3.2
   * units — differences too small to look deliberate and too large to look like a
   * mistake, which is the worst of both. Second, an earlier revision indented the
   * dialogue block relative to the heading to suggest a screenplay page; at 32 px that
   * does not read as indentation, it reads as strips that failed to line up. The
   * original mark had every strip flush to one left margin, and that is what restored.
   *
   * So: one left edge for all strips, one right edge, and each strip's length expressed
   * as a right inset from that shared edge. Alignment is structural, not arithmetic. */
  strips: { left: 10.2, right: 30.6 },
  heading: { y: 8.3, h: 4.2, radius: 2.1, rightInset: 0 },
  dialogue: [
    { y: 33.8, h: 2.85, radius: 1.42, opacity: 0.72, rightInset: 1.8 },
    { y: 38.3, h: 2.85, radius: 1.42, opacity: 0.54, rightInset: 5.2 },
  ],
  hasShadow: true,
  hasGloss: true,
};

/* Small optical size, 16-24 px.
 *
 * The radius here is the important difference and it is NOT the same fraction as the
 * master's. Measured on the shipped ICO, a 4.0-unit radius (8.3% of the width) gave an
 * effective radius of 0.36 px at 16 px and 0.56 px at 20 px — sub-pixel, so those
 * frames read as SQUARE corners even though the geometry was "correct". Four frames
 * failed that way (16, 20, 24, 40 px).
 *
 * A corner only reads as rounded once it is roughly 2 device pixels. That is 6/48 of
 * the grid at 16 px, so the small variant uses a much larger PROPORTIONAL radius than
 * the master — which is exactly what Microsoft's own icon sets do below ~24 px. The
 * cost is a slightly softer silhouette at 24 px, which is cheaper than a square corner
 * at 16. */
const SMALL = {
  size: 48,
  sheet: {
    left: 3.4,
    right: 44.6,
    top: 2.4,
    bottom: 45.6,
    // 9.0/48 = 18.8% of the width. Chosen by rendering candidates at the true 16-32 px
    // sizes (scripts/corner-lab.cjs): 15.4% still reads square at 16 px, 18.8% reads
    // clearly rounded, and past ~22% the sheet starts to look circular rather than like
    // a document. Worst case is the smallest frame: 9.0 * 16/48 = 3.0 device px.
    radius: 9.0,
    fold: 14.0,
    /* Scaled up from the master's 13.0 in line with the larger fold. The pull at this
     * size only needs to survive a 16 px frame, where one unit is a third of a pixel, so
     * the absolute pull matters more than the proportion: 11.4 * 0.082 = 0.94 units
     * = 0.31 device px at 16 px, versus 0.04 px before this change. */
    cutRadius: 11.4,
    /* The crease at this optical size. The fold is the first thing to die when a 48-unit
     * drawing is squeezed into 16 pixels — the diagonal collapses into a bevel and the
     * notch disappears — so this radius is proportionally LARGER here than on the master,
     * the same way the sheet radius is. 14.6 * 0.082 = 1.20 units of pull, i.e. 0.40
     * device px at 16 px and 0.80 at 32 px: the junction stays visibly soft instead of
     * turning into the hard stair-step a sharp crease produces. 14.6 * tan(22.5) + 11.4 *
     * tan(22.5) = 10.8 against 14.0 * sqrt(2) = 19.8 units of diagonal, so a straight
     * segment survives here too. */
    creaseRadius: 14.6,
  },
  /* At 16 px the badge lands on ~6.3 device pixels and the letter on ~4, which is
   * the smallest size at which an S can still be read as an S rather than a blob.
   * Both are pushed as far as the sheet allows; the heading rule gives up height to
   * pay for it, because at this size the monogram is the identity and the rules are
   * only texture. */
  badge: { size: 19.0, radius: 6.2, letter: 12.4 },
  strips: { left: 9.0, right: 29.6 },
  heading: { y: 6.8, h: 4.6, radius: 2.3, rightInset: 0 },
  dialogue: [
    { y: 35.0, h: 3.6, radius: 1.8, opacity: 0.74, rightInset: 2.0 },
    { y: 40.4, h: 3.6, radius: 1.8, opacity: 0.54, rightInset: 6.0 },
  ],
  hasShadow: false,
  hasGloss: false,
};

/* Expand the strips into concrete rects.
 *
 * Every strip starts at the same left edge and is shortened from a shared right edge by
 * its own inset, so the left margin can never stagger and no width can drift. */
function stripRects(g) {
  const { left, right } = g.strips;
  const heading = {
    x: left,
    y: g.heading.y,
    w: right - g.heading.rightInset - left,
    h: g.heading.h,
    radius: g.heading.radius,
  };
  const dialogue = g.dialogue.map((rule) => ({
    x: left,
    y: rule.y,
    w: right - rule.rightInset - left,
    h: rule.h,
    radius: rule.radius,
    opacity: rule.opacity,
  }));
  return { heading, dialogue };
}

/* Optical rule: below ~24 px the master's three dialogue rules and its shadows
 * turn to grey mush in a 16 px taskbar slot, so sizes <= SMALL_OPTICAL_MAX_PX use
 * the simplified drawing (bigger sheet, bigger badge, two dialogue rules).
 * scripts/make-icon.py holds the matching threshold. */
const SMALL_OPTICAL_MAX_PX = 24;


/* The turned corner, as a filled plane.
 *
 * The previous version came to a POINT at the outer vertex and left a sharp 45-degree
 * spike, which is the corner that was visible at every size. Rounding the fold alone
 * could not fix it: the sheet's own outline also came to a point there, so the fold and
 * the silhouette had to be rounded together or a sliver of sheet would show through the
 * notch. That is why sheetPath() owns the cut geometry and this path is CLIPPED to the
 * sheet — the fold's two tips then inherit exactly the silhouette's fillets, with no
 * duplicated rounding maths to drift out of sync.
 *
 * That is also why fixing the second corner needed no change here: the fold plane is
 * clipped to the sheet outline, so enlarging the crease fillet in cutGeometry() moved
 * the fold's own tip with it. Any future change to either corner must keep the fold
 * inside this clip rather than rounding the plane itself.
 *
 * The inner corner (lower edge meeting left edge) is a genuine 90-degree corner of the
 * artwork and keeps its own arc. */
function foldPath(g, inset) {
  const { right: R, top: T, fold: f } = g.sheet;
  const ax = R - f;
  const inner = inset;
  return [
    `M${fmt(ax)} ${fmt(T)}`,
    `L${fmt(R)} ${fmt(T + f)}`,
    `H${fmt(ax + inner)}`,
    `A${fmt(inner)} ${fmt(inner)} 0 0 1 ${fmt(ax)} ${fmt(T + f - inner)}`,
    "Z",
  ].join(" ");
}

/* Rounded-rect as a <rect>: content rules and the badge are all just rounded
 * rectangles, so there is nothing to gain from hand-writing paths here. */
function rectAttrs(r) {
  return `x="${fmt(r.x)}" y="${fmt(r.y)}" width="${fmt(r.w)}" height="${fmt(r.h)}" rx="${fmt(r.radius)}"`;
}

/* ---- Theme application ----------------------------------------------------- */

function gradientStops(id, colors) {
  const offsets = [0, 0.3, 0.66, 1];
  const stops = colors
    .map((color, index) => {
      const offset = colors.length === 4 ? offsets[index] : index / (colors.length - 1);
      return `      <stop offset="${fmt(offset, 2)}" stop-color="${color}"/>`;
    })
    .join("\n");
  return `    <linearGradient id="${id}" x1="0.06" y1="0" x2="0.94" y2="1">\n${stops}\n    </linearGradient>`;
}

function badgeStops(id, colors) {
  const stops = colors
    .map((color, index) => {
      const offset = [0, 0.42, 1][index] ?? index / (colors.length - 1);
      return `      <stop offset="${fmt(offset, 2)}" stop-color="${color}"/>`;
    })
    .join("\n");
  return `    <linearGradient id="${id}" x1="0.15" y1="0" x2="0.85" y2="1">\n${stops}\n    </linearGradient>`;
}

function defs(theme, g) {
  const parts = [
    gradientStops("az-page", theme.sheet),
    `    <linearGradient id="az-fold" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="${theme.fold[0]}" stop-opacity="${g.hasShadow ? "0.92" : "0.95"}"/>
      <stop offset="1" stop-color="${theme.fold[1]}" stop-opacity="${g.hasShadow ? "0.28" : "0.34"}"/>
    </linearGradient>`,
  ];

  if (g.hasShadow) {
    parts.push(`    <linearGradient id="az-fold-shade" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="${theme.shadowSheet}" stop-opacity="0.30"/>
      <stop offset="1" stop-color="${theme.shadowSheet}" stop-opacity="0"/>
    </linearGradient>`);
  }

  parts.push(`    <linearGradient id="az-rule" x1="0" y1="0" x2="1" y2="0.2">
      <stop offset="0" stop-color="${theme.rule[0]}" stop-opacity="${g.hasShadow ? "0.98" : "1"}"/>
      <stop offset="1" stop-color="${theme.rule[1]}" stop-opacity="${g.hasShadow ? "0.82" : "0.88"}"/>
    </linearGradient>`);
  parts.push(badgeStops("az-badge", theme.badge));

  /* Badge sheen. The previous revision painted a rounded rect over the top 44% of
     the badge with a hard bottom edge, which is the 2010 glossy-button idiom and
     reads as a glass lid rather than a lit plane. Fluent badges are lit from the
     top with no visible terminator, so the highlight is a vertical gradient that
     fades to nothing across the whole height of the badge. */
  if (g.hasGloss) {
    parts.push(`    <linearGradient id="az-badge-gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.26"/>
      <stop offset="0.55" stop-color="#FFFFFF" stop-opacity="0.06"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>`);
  }
  if (g.hasShadow) {
    parts.push(`    <filter id="az-sheet-shadow" x="-30%" y="-30%" width="170%" height="185%">
      <feDropShadow dx="0.6" dy="1.7" stdDeviation="1.6" flood-color="${theme.shadow}" flood-opacity="0.40"/>
    </filter>`);
    parts.push(`    <filter id="az-badge-shadow" x="-45%" y="-45%" width="195%" height="205%">
      <feDropShadow dx="0.3" dy="1.2" stdDeviation="1.1" flood-color="${theme.shadow}" flood-opacity="0.52"/>
    </filter>`);
  }
  /* The fold is clipped to the sheet silhouette so its two tips inherit the sheet's own
   * rounded cut. Both are drawn from the same geometry, so they cannot disagree and no
   * sliver of sheet can show through the notch. */
  parts.push(`    <clipPath id="az-sheet-clip">
      <path d="${sheetPath(g)}"/>
    </clipPath>`);
  return parts.join("\n");
}

function badgeRect(g, sheet) {
  const cx = (sheet.left + sheet.right) / 2;
  const cy = (sheet.top + sheet.bottom) / 2;
  const b = g.badge;
  return {
    cx,
    cy,
    x: cx - b.size / 2,
    y: cy - b.size / 2,
    w: b.size,
    h: b.size,
    radius: b.radius,
    letter: b.letter,
  };
}

/** The drawable body: everything after </defs>, shared by the SVG and the sprite. */
function body(theme, g) {
  const sheet = g.sheet;
  const badge = badgeRect(g, sheet);
  const { heading, dialogue } = stripRects(g);
  const out = [];

  const shadowOpen = g.hasShadow ? ' filter="url(#az-sheet-shadow)"' : "";
  out.push(`  <g${shadowOpen}>`);
  out.push(`    <path d="${sheetPath(g)}" fill="url(#az-page)"/>`);
  out.push("  </g>");
  out.push("");

  // Clipped to the sheet so the fold's tips take the sheet's rounded cut exactly.
  out.push(`  <g clip-path="url(#az-sheet-clip)">`);
  out.push(`    <path d="${foldPath(g, 3.5)}" fill="url(#az-fold)"/>`);
  if (g.hasShadow) {
    out.push(`    <path d="${foldPath(g, 3.0)}" fill="url(#az-fold-shade)"/>`);
  }
  out.push("  </g>");
  out.push("");

  out.push(`  <rect ${rectAttrs(heading)} fill="url(#az-rule)"/>`);
  for (const rule of dialogue) {
    out.push(
      `  <rect ${rectAttrs(rule)} fill="url(#az-rule)" opacity="${fmt(rule.opacity, 2)}"/>`
    );
  }
  out.push("");

  const badgeOpen = g.hasShadow ? ' filter="url(#az-badge-shadow)"' : "";
  out.push(`  <g${badgeOpen}>`);
  out.push(`    <rect ${rectAttrs(badge)} fill="url(#az-badge)"/>`);
  out.push("  </g>");
  if (g.hasGloss) {
    // Same rect as the badge, so the sheen follows the badge's rounded corners
    // instead of drawing a second, differently-rounded shape on top of it.
    out.push(`  <rect ${rectAttrs(badge)} fill="url(#az-badge-gloss)"/>`);
  }

  const t = letterTransform(badge.cx, badge.cy, badge.letter);
  out.push(`  <path transform="${t.value}" d="${S_OUTLINE}" fill="${theme.letter}"/>`);
  return out.join("\n");
}

/* ---- Full SVG documents ---------------------------------------------------- */

/** `<defs>` can only hold elements, so prose has to be wrapped as an XML comment
 *  (a bare text node inside <defs> is invalid XML and makes Chrome refuse the
 *  whole document — it renders nothing at all, which is how this was caught). */
function comment(text) {
  return `    <!--\n${text
    .split("\n")
    .map((line) => (line.trim() ? `    ${line}` : ""))
    .join("\n")}\n    -->`;
}

const DESIGN_NOTES = `Azkript brand mark — Office-style document glyph.
================================================
Generated by scripts/build-brand.cjs from app/brand/palettes.json and the
geometry in scripts/lib/brand-mark.cjs. Edit those, not this file; then:

    node scripts/build-brand.cjs && node scripts/sync-brand.cjs
    python scripts/make-icon.py

Composition:
  * NO enclosing tile. The glyph is the icon — a document sheet with a turned
    corner, saturated body gradient, no outline.
  * A heading band across the top, then a SLIGHTLY DIMMER dialogue block below
    it: the screenplay ladder, two levels of luminosity.
  * ONE rounded-square letter badge, CENTRED on the sheet rather than hanging off
    the lower-left corner, holding the S monogram.
  * White content on saturated colour; the badge is the only dark plane.`;

const SMALL_NOTES = `Optical size for 16-24 px. Same drawing as azkript-mark.svg, redrawn for a
taskbar slot by scripts/build-brand.cjs (see SMALL_OPTICAL_MAX_PX):

  * larger sheet and badge, so the silhouette and the monogram survive
    resampling into a 16 px box;
  * no cast shadows — at this size they are a grey fringe;
  * two dialogue rules instead of three, thicker, so no pair merges;
  * the turned corner stays: it is what makes the shape read as a document
    rather than a plain square.`;

function masterSvg(theme) {
  const g = MASTER;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" role="img" aria-label="Azkript">
  <defs>
${comment(DESIGN_NOTES)}
${defs(theme, g)}
  </defs>

${body(theme, g)}
</svg>
`;
}

function smallSvg(theme) {
  const g = SMALL;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" role="img" aria-label="Azkript (small optical size)">
  <defs>
${comment(SMALL_NOTES)}
${defs(theme, g)}
  </defs>

${body(theme, g)}
</svg>
`;
}

module.exports = {
  S_OUTLINE,
  S_INK,
  MASTER,
  SMALL,
  SMALL_OPTICAL_MAX_PX,
  masterSvg,
  smallSvg,
  letterTransform,
  sheetPath,
  foldPath,
  cutGeometry,
  /* Inward pull produced by a fillet on a 135-degree corner: the silhouette moves
   * in by radius * (1/sin 67.5 - 1). Verification tools use this rather than
   * re-deriving it, so a measured pull and the predicted pull can never disagree
   * because two files computed the constant differently. */
  FILLET_PULL_RATIO: 1 / Math.sin((67.5 * Math.PI) / 180) - 1,
};

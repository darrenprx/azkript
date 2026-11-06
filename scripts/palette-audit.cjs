/* Audit the colour themes against the measured conventions of the icon family.
 *
 * Why this exists: "looks fine to me" is not a review of a colour system. The 2025
 * Office icon set was measured stop by stop (see reports/brand-mark-plan-*.md), and
 * it obeys two rules tightly enough to check mechanically:
 *
 *   1. The badge is a DEEPER SHADE OF THE SHEET'S OWN HUE, never a neutral and never
 *      a complementary colour. Measured badge-vs-sheet contrast across the set is
 *      1.30 (Word) to 2.98 (Teams), with the badge partly overhanging the sheet.
 *   2. The sheet ramp lightens toward the upper-left and deepens toward the
 *      lower-right, monotonically.
 *
 * A theme that puts a near-black badge on a mid-tone sheet is not "more contrast";
 * it is a different design language (that is the Obsidian/Linear look, where the
 * whole icon is dark). This script catches that before it ships.
 *
 * Usage: node scripts/palette-audit.cjs [--json]
 * Exit code 1 if any theme breaks a hard rule.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const palettePath = path.join(root, "app", "brand", "palettes.json");

/* WCAG relative luminance and contrast ratio. Used here not for accessibility but
 * because it is the standard, reproducible way to express "how much lighter is this
 * plane than that one" — the same quantity the Office measurements report. */
function srgbToLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function hexToHsl(hex) {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

/** Shortest angular distance between two hues on the colour wheel, in degrees. */
function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/* Bands calibrated against the measured 2025 Office set, NOT chosen for headroom.
 *
 * The first version of this audit used a single badge-vs-sheet band of 1.6-3.6 and
 * applied it to three different pairings, which failed every theme and was telling me
 * my audit was wrong rather than my palettes. Re-deriving which pair produces each
 * published number (see scripts/derive-badge-ramps.py) showed the measurements mix
 * several different pairings:
 *
 *   * Word reports 1.30 for badge-light vs a MID sheet stop, and its badge's DEEP
 *     stop is literally the sheet's deepest stop (contrast 1.00).
 *   * Excel reports 2.87 for badge-deep vs the sheet's DEEPEST stop.
 *
 * So the real invariant is not one ratio: it is that the badge lives inside the
 * sheet's tonal envelope. The checks below encode that directly. */
const BADGE_LIGHT_VS_SHEET_MID = { min: 1.6, max: 3.6 };
const BADGE_DEEP_VS_SHEET_DEEP = { min: 1.0, max: 2.3 };
const BADGE_INTERNAL_STEP = { min: 1.35, max: 2.6 };

// The badge must stay within the sheet's own hue family — but "family" is wider than
// it first appears. Measured from the real files, PowerPoint's sheet is orange (hue
// ~24 degrees) and its badge is red (hue ~350 degrees): a 34-degree shift, taken
// deliberately so the darkened badge stays vivid instead of going brown. HSL
// saturation is relative, so darkening a fully saturated hue ALWAYS reduces saturation
// (and reads as mud) unless the hue rotates toward a deeper, more chroma-capable
// neighbour. Office rotates. So this check has to allow that rotation.
const HUE_TOLERANCE = 36;
// Saturation: gains are fine and expected (a shadow plane of the same material gains
// chroma). Large losses are the mud failure, so only losses are tightly bounded.
const SATURATION_GAIN_MAX = 0.35;
const SATURATION_LOSS_MAX = 0.14;
const EPSILON = 1e-9;

function auditTheme(id, theme) {
  const problems = [];
  const notes = [];

  // Rule 1: the sheet ramp deepens monotonically.
  const sheetLums = theme.sheet.map(luminance);
  for (let i = 1; i < sheetLums.length; i += 1) {
    if (!(sheetLums[i] < sheetLums[i - 1])) {
      problems.push(
        `sheet stop ${i} (${theme.sheet[i]}) is not darker than stop ${i - 1} (${theme.sheet[i - 1]})`
      );
    }
  }
  const badgeLums = theme.badge.map(luminance);
  for (let i = 1; i < badgeLums.length; i += 1) {
    if (!(badgeLums[i] < badgeLums[i - 1])) {
      problems.push(`badge stop ${i} (${theme.badge[i]}) is not darker than stop ${i - 1}`);
    }
  }

  // Rule 2: the badge lives INSIDE the sheet's tonal envelope — a deeper plane of
  // the same material, not a hole punched through the glyph.
  const sheetMid = theme.sheet[1];
  const sheetDeep = theme.sheet[theme.sheet.length - 1];
  const badgeLight = theme.badge[0];
  const badgeDeep = theme.badge[theme.badge.length - 1];

  const cMid = contrast(badgeLight, sheetMid);
  const cDeep = contrast(badgeDeep, theme.sheet[theme.sheet.length - 1]);
  const internal = contrast(badgeLight, badgeDeep);

  const band = (name, value, { min, max }) => {
    if (value < min - 1e-9) problems.push(`${name} ${value.toFixed(2)} is below ${min}`);
    if (value > max + 1e-9) problems.push(`${name} ${value.toFixed(2)} is above ${max}`);
  };
  band("badge light vs sheet mid contrast", cMid, BADGE_LIGHT_VS_SHEET_MID);
  band("badge deep vs sheet deepest contrast", cDeep, BADGE_DEEP_VS_SHEET_DEEP);
  band("contrast across the badge itself", internal, BADGE_INTERNAL_STEP);
  notes.push(
    `badge/sheet: light-vs-mid ${cMid.toFixed(2)}, deep-vs-deepest ${cDeep.toFixed(2)}, across badge ${internal.toFixed(2)}`
  );

  // Rule 2b: the badge must be darker than the sheet's mid tone, or it reads as a
  // highlight rather than as the shadow plane.
  if (luminance(badgeLight) >= luminance(sheetMid)) {
    problems.push(
      `badge light (${badgeLight}) is not darker than the sheet mid (${sheetMid}) — it will read as a highlight`
    );
  }

  // Rule 3: badge hue stays in the sheet's hue family.
  const sheetHsl = hexToHsl(sheetMid);
  const badgeHsl = hexToHsl(badgeLight);
  const dh = hueDistance(sheetHsl.h, badgeHsl.h);
  if (dh > HUE_TOLERANCE) {
    problems.push(
      `badge hue ${badgeHsl.h.toFixed(0)}° is ${dh.toFixed(0)}° from sheet hue ${sheetHsl.h.toFixed(0)}° ` +
        `(tolerance ${HUE_TOLERANCE}°) — the badge must be the same material in shadow`
    );
  }
  const dSat = badgeHsl.s - sheetHsl.s;
  if (dSat > SATURATION_GAIN_MAX) {
    problems.push(
      `badge saturation ${(badgeHsl.s * 100).toFixed(0)}% gains ${(dSat * 100).toFixed(0)} points over the sheet's ` +
        `${(sheetHsl.s * 100).toFixed(0)}% (max +${(SATURATION_GAIN_MAX * 100).toFixed(0)}) — the badge is a shadow ` +
        "plane of the same material, not a different paint"
    );
  }
  if (-dSat > SATURATION_LOSS_MAX) {
    problems.push(
      `badge saturation ${(badgeHsl.s * 100).toFixed(0)}% loses ${(-dSat * 100).toFixed(0)} points against the sheet's ` +
        `${(sheetHsl.s * 100).toFixed(0)}% (max -${(SATURATION_LOSS_MAX * 100).toFixed(0)}) — a darker plane that also ` +
        "desaturates turns to muddy brown"
    );
  }
  notes.push(
    `hue: sheet ${sheetHsl.h.toFixed(0)}°, badge ${badgeHsl.h.toFixed(0)}° (Δ${dh.toFixed(0)}°); ` +
      `saturation ${dSat >= 0 ? "+" : ""}${(dSat * 100).toFixed(0)}pts`
  );

  // Rule 4: white content must stay legible on the lightest sheet stop, because the
  // heading rule sits near the bright corner of the gradient.
  const whiteOnLight = contrast("#FFFFFF", theme.sheet[0]);
  const whiteOnMid = contrast("#FFFFFF", sheetMid);
  if (whiteOnMid < 1.35) {
    problems.push(
      `white rules on sheet mid (${sheetMid}) have contrast ${whiteOnMid.toFixed(2)}; ` +
        "content lines will disappear into the body"
    );
  }
  notes.push(`white on sheet: light ${whiteOnLight.toFixed(2)}, mid ${whiteOnMid.toFixed(2)}`);

  // Rule 5: the letter must read on the badge. The floor is 3.0, not the 4.5 a
  // text-accessibility rule would demand: these are logotypes, not body copy, and the
  // measured 2025 Office set itself runs 3.04 (Teams) to 5.18 (OneNote). Holding a
  // logo to body-text contrast would reject Excel's own badge.
  const letterOnBadge = contrast(theme.letter, badgeLight);
  if (letterOnBadge < 3.0) {
    problems.push(
      `letter on badge contrast ${letterOnBadge.toFixed(2)} is below 3.0 — ` +
        "the monogram will be muddy (measured Office range: 3.04-5.18)"
    );
  }
  notes.push(`letter on badge: ${letterOnBadge.toFixed(2)}`);

  return { id, contrast: cMid, problems, notes };
}

function main() {
  const json = process.argv.includes("--json");
  const palette = JSON.parse(fs.readFileSync(palettePath, "utf8"));
  const results = Object.entries(palette.themes).map(([id, theme]) => auditTheme(id, theme));

  let failures = 0;
  for (const r of results) {
    const ok = r.problems.length === 0;
    if (!ok) failures += 1;
    if (json) continue;
    console.log(`${ok ? "PASS" : "FAIL"}  ${r.id}${r.id === palette.selected ? "  (selected)" : ""}`);
    for (const note of r.notes) console.log(`        ${note}`);
    for (const problem of r.problems) console.log(`      ! ${problem}`);
  }

  if (json) {
    console.log(JSON.stringify({ selected: palette.selected, results }, null, 2));
  } else {
    const mean = results.reduce((sum, r) => sum + r.contrast, 0) / results.length;
    console.log(
      `\n${results.length - failures}/${results.length} themes pass. ` +
        `Mean badge-light/sheet-mid contrast ${mean.toFixed(2)} ` +
        `(measured Office band ${BADGE_LIGHT_VS_SHEET_MID.min.toFixed(2)}-${BADGE_LIGHT_VS_SHEET_MID.max.toFixed(2)}).`
    );
  }
  if (failures) process.exitCode = 1;
}

main();

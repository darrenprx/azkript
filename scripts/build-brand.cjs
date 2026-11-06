/* Bake the selected colour theme into the brand SVG sources.
 *
 *   app/brand/palettes.json  (colour)  ─┐
 *   scripts/lib/brand-mark.cjs (shape) ─┴─> app/brand/azkript-mark.svg
 *                                          app/brand/azkript-mark-small.svg
 *
 * Those two SVGs remain the single source of truth downstream: sync-brand.cjs
 * generates the in-app sprite from them and make-icon.py rasterises the desktop
 * icon set from them. This script is the only thing that writes them, so shape and
 * colour can never drift between the two optical sizes.
 *
 * Usage:
 *   node scripts/build-brand.cjs            # write the selected theme
 *   node scripts/build-brand.cjs --check    # exit 1 if the SVGs are stale
 *   node scripts/build-brand.cjs --theme=teal --out=<dir>   # preview another theme
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const mark = require("./lib/brand-mark.cjs");

const root = path.resolve(__dirname, "..");
const brandDir = path.join(root, "app", "brand");
const palettePath = path.join(brandDir, "palettes.json");

const argv = process.argv.slice(2);
const flag = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

function loadPalette() {
  const palette = JSON.parse(fs.readFileSync(palettePath, "utf8"));
  const themes = palette.themes || {};
  const ids = Object.keys(themes);
  if (!ids.length) throw new Error("palettes.json: no themes defined");
  const selected = flag("theme") || palette.selected;
  if (!themes[selected]) {
    throw new Error(
      `palettes.json: selected theme "${selected}" is not defined (have: ${ids.join(", ")})`
    );
  }
  const theme = themes[selected];
  for (const key of ["sheet", "fold", "rule", "badge"]) {
    if (!Array.isArray(theme[key]) || !theme[key].length) {
      throw new Error(`palettes.json: theme "${selected}" is missing "${key}"`);
    }
  }
  if (theme.sheet.length !== 4) {
    throw new Error(
      `palettes.json: theme "${selected}" needs exactly 4 sheet stops (light -> deep), has ${theme.sheet.length}`
    );
  }
  if (theme.badge.length !== 3) {
    throw new Error(
      `palettes.json: theme "${selected}" needs exactly 3 badge stops, has ${theme.badge.length}`
    );
  }
  if (!theme.letter || !theme.shadow || !theme.shadowSheet) {
    throw new Error(`palettes.json: theme "${selected}" needs letter, shadow and shadowSheet`);
  }
  return { palette, selected, theme };
}

function main() {
  const check = argv.includes("--check");
  const outDir = flag("out") ? path.resolve(root, flag("out")) : brandDir;
  const { selected, theme } = loadPalette();

  const files = {
    [path.join(outDir, "azkript-mark.svg")]: mark.masterSvg(theme),
    [path.join(outDir, "azkript-mark-small.svg")]: mark.smallSvg(theme),
  };

  let changed = 0;
  for (const [file, content] of Object.entries(files)) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (current === content) continue;
    changed += 1;
    if (check) {
      console.error(`STALE: ${path.relative(root, file)} does not match theme "${selected}"`);
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    console.log(`wrote ${path.relative(root, file)} (theme: ${selected})`);
  }

  if (check) {
    if (changed) {
      console.error(`run: node scripts/build-brand.cjs`);
      process.exitCode = 1;
      return;
    }
    console.log(`brand SVGs are up to date (theme: ${selected})`);
    return;
  }
  if (!changed) console.log(`brand SVGs already match theme "${selected}"`);
}

main();

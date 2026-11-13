/* Compare candidate BADGE ramps for one theme, at true pixel sizes.
 *
 * Why this exists: the badge is the one plane that cannot be derived purely by
 * arithmetic. Darkening a warm hue in HSL desaturates it, so an amber sheet's badge
 * turns brown no matter what the contrast ratio says — and brown-on-orange has
 * perfectly good contrast, so a numeric check cannot catch it. The 2025 Office set
 * solves this by rotating the badge hue toward a deeper neighbour (PowerPoint's sheet
 * is orange at hue ~24 degrees and its badge is red at ~350), which is a judgement
 * call about vividness that has to be looked at.
 *
 * This renders the real mark with each candidate ramp so the choice is made on pixels,
 * then the winner is written into app/brand/palettes.json.
 *
 * Usage:
 *   node scripts/badge-lab.cjs --theme=amber --ramp="#CA5306,#A54405,#803504" \
 *                              --ramp="#B3300A,#8A1F05,#5E1203" ...
 *   node scripts/badge-lab.cjs --theme=amber --file=candidates.json --out=x.png
 *
 * A ramp is three comma-separated hex stops (light -> deep).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const palettePath = path.join(root, "app", "brand", "palettes.json");
const mark = require("./lib/brand-mark.cjs");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};
const flagAll = (name) =>
  argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.split("=").slice(1).join("="));

const themeId = flag("theme");
const out = path.resolve(root, flag("out", "app/brand/preview/badge-lab.png"));
const sizes = flag("sizes", "24,32,48,128")
  .split(",")
  .map((s) => Number.parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0);

if (!themeId) {
  console.error("usage: node scripts/badge-lab.cjs --theme=<id> --ramp=#a,#b,#c [--ramp=...]");
  process.exit(2);
}

const palette = JSON.parse(fs.readFileSync(palettePath, "utf8"));
const base = palette.themes[themeId];
if (!base) {
  console.error(`unknown theme "${themeId}" (have: ${Object.keys(palette.themes).join(", ")})`);
  process.exit(2);
}

let ramps = flagAll("ramp").map((r, index) => ({
  label: `candidate ${index + 1}`,
  ramp: r.split(",").map((s) => s.trim()),
}));
if (flag("file")) {
  ramps = JSON.parse(fs.readFileSync(path.resolve(root, flag("file")), "utf8"));
}
if (!ramps.length) {
  ramps = [{ label: "current", ramp: base.badge }];
}

for (const candidate of ramps) {
  if (!Array.isArray(candidate.ramp) || candidate.ramp.length !== 3) {
    console.error(`${candidate.label}: a ramp needs exactly 3 stops`);
    process.exit(2);
  }
}

/* --- colour maths, duplicated from palette-audit.cjs on purpose: this script is a
 * standalone visual tool and should keep working even if the audit changes. --- */
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex) {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return (
    0.2126 * srgbToLinear(((n >> 16) & 255) / 255) +
    0.7152 * srgbToLinear(((n >> 8) & 255) / 255) +
    0.0722 * srgbToLinear((n & 255) / 255)
  );
}
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
function hsl(hex) {
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
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

const playwrightPath = path.join(root, "node_modules", "playwright-core");
if (!fs.existsSync(playwrightPath)) {
  console.error("SKIP: node_modules/playwright-core is not installed");
  process.exit(1);
}
const { chromium } = require(playwrightPath);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
    const cells = [];
    for (let i = 0; i < ramps.length; i += 1) {
      const theme = { ...base, badge: ramps[i].ramp };
      const svg = mark.masterSvg(theme);
      const url =
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(svg.replace(/\swidth="48"/, "").replace(/\sheight="48"/, ""));
      for (const size of sizes) cells.push({ index: i, size, url });
    }

    await page.setContent(`<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#fff}.m{display:block}</style>
<div id="host" style="display:flex;flex-wrap:wrap"></div>
<script>
const cells = ${JSON.stringify(cells.map(({ url, size }) => ({ url, size })))};
const host = document.getElementById("host");
for (const c of cells) {
  const img = document.createElement("img");
  img.className = "m"; img.src = c.url; img.width = c.size; img.height = c.size;
  host.appendChild(img);
}
</script>`);
    await page.waitForFunction(
      () => [...document.querySelectorAll("img")].every((i) => i.complete && i.naturalWidth > 0),
      null,
      { timeout: 30000 }
    );
    await page.waitForTimeout(120);

    const handles = await page.locator("img.m").all();
    const rasters = [];
    for (let i = 0; i < handles.length; i += 1) {
      const buf = await handles[i].screenshot({ omitBackground: true });
      rasters.push({ ...cells[i], dataUrl: "data:image/png;base64," + buf.toString("base64") });
    }
    await page.close();

    const sheetMid = base.sheet[1];
    const stats = ramps.map((candidate) => {
      const light = hsl(candidate.ramp[0]);
      return {
        cMid: contrast(candidate.ramp[0], sheetMid),
        letter: contrast("#FFFFFF", candidate.ramp[0]),
        hue: light.h,
        sat: light.s,
        lum: light.l,
      };
    });

    const sheet = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
    await sheet.setContent(`<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;font:12px/1.45 "Segoe UI",sans-serif;background:#1b2a3d;color:#e8eef7}
  .row{padding:16px 22px 20px;border-top:1px solid rgba(255,255,255,.12)}
  .head{display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap}
  .name{font:600 14px "Segoe UI"}
  .ramp{display:flex;gap:4px}
  .sw{width:34px;height:15px;border-radius:3px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.22)}
  .meta{opacity:.72;font-variant-numeric:tabular-nums}
  .band{display:flex;gap:26px;align-items:flex-end}
  .cell{display:flex;flex-direction:column;gap:6px;align-items:center}
  canvas{image-rendering:pixelated;display:block}
  .lbl{opacity:.6;font-size:11px}
</style>
<div id="sheet"></div>
<script>
const rasters = ${JSON.stringify(rasters)};
const ramps = ${JSON.stringify(ramps)};
const stats = ${JSON.stringify(stats)};
const sheetMid = ${JSON.stringify(sheetMid)};
const sheet = document.getElementById("sheet");
(async () => {
  for (let i = 0; i < ramps.length; i += 1) {
    const row = document.createElement("div");
    row.className = "row";

    const head = document.createElement("div");
    head.className = "head";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = ramps[i].label;
    head.appendChild(name);

    const ramp = document.createElement("div");
    ramp.className = "ramp";
    for (const color of ramps[i].ramp) {
      const sw = document.createElement("span");
      sw.className = "sw";
      sw.style.background = color;
      sw.title = color;
      ramp.appendChild(sw);
    }
    head.appendChild(ramp);

    const s = stats[i];
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = ramps[i].ramp.join("  ") +
      "   badge/sheet " + s.cMid.toFixed(2) +
      "   white " + s.letter.toFixed(2) +
      "   hue " + s.hue.toFixed(0) + "\\u00b0 sat " + (s.sat * 100).toFixed(0) + "% L " + (s.lum * 100).toFixed(0) + "%";
    head.appendChild(meta);
    row.appendChild(head);

    const band = document.createElement("div");
    band.className = "band";
    for (const r of rasters.filter((x) => x.index === i)) {
      const img = new Image();
      await new Promise((res) => { img.onload = res; img.src = r.dataUrl; });
      const z = Math.max(1, Math.round(150 / r.size));
      const c = document.createElement("canvas");
      c.width = r.size * z; c.height = r.size * z;
      const g = c.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, r.size, r.size, 0, 0, r.size * z, r.size * z);
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.appendChild(c);
      const lbl = document.createElement("span");
      lbl.className = "lbl";
      lbl.textContent = r.size + " px";
      cell.appendChild(lbl);
      band.appendChild(cell);
    }
    row.appendChild(band);
    sheet.appendChild(row);
  }
  document.title = "ready";
})();
</script>`);
    await sheet.waitForFunction(() => document.title === "ready", null, { timeout: 30000 });
    await sheet.waitForTimeout(150);

    fs.mkdirSync(path.dirname(out), { recursive: true });
    await sheet.screenshot({ path: out, fullPage: true });
    console.log("wrote", path.relative(root, out));
    console.log(`theme ${themeId}; sheet mid ${sheetMid}; ${ramps.length} candidates at ${sizes.join("/")} px`);
    for (let i = 0; i < ramps.length; i += 1) {
      const s = stats[i];
      console.log(
        `  ${ramps[i].label.padEnd(12)} ${ramps[i].ramp.join(" ")}  ` +
          `badge/sheet ${s.cMid.toFixed(2)}  white ${s.letter.toFixed(2)}  ` +
          `hue ${s.hue.toFixed(0)} sat ${(s.sat * 100).toFixed(0)}% L ${(s.lum * 100).toFixed(0)}%`
      );
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

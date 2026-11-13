/* Find the corner radius that actually SURVIVES at small icon sizes.
 *
 * The failure mode this investigates: a corner radius of 3.6-4.0 units on the 48-unit
 * grid is only 1.2-1.3 device pixels at 16 px. Rasterising that yields a corner whose
 * arc covers a fraction of one pixel, so the result reads as a SQUARE corner even
 * though the geometry is correctly rounded. The 1024 px master looks perfect and the
 * 16 px taskbar frame looks square — which is exactly the kind of bug that survives
 * "the source is correct" review.
 *
 * Office's own icon sets ship dedicated small artwork with a PROPORTIONALLY LARGER
 * radius for this reason. This script renders candidate radii at the real small sizes
 * and reports, per size, how many corner pixels are visibly softened, so the radius
 * can be chosen from pixels rather than assumed.
 *
 * Usage: node scripts/corner-lab.cjs [--out=preview/corner-lab.png]
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const mark = require("./lib/brand-mark.cjs");
const { execFileSync } = require("node:child_process");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};
const out = path.resolve(root, flag("out", "app/brand/preview/corner-lab.png"));

const SIZES = [16, 20, 24, 32];
const RADII = [4.0, 5.0, 6.0, 7.0, 8.0];

const work = path.join(root, "app", "brand", "preview", ".corner-lab");
fs.mkdirSync(work, { recursive: true });

const rows = [];
for (const radius of RADII) {
  // Patch the shared geometry in memory, then ask the same generator for the SVG, so
  // this tests exactly what build-brand.cjs would ship.
  const original = mark.SMALL.sheet.radius;
  mark.SMALL.sheet.radius = radius;
  const svg = mark.smallSvg({
    sheet: ["#FFD9A0", "#FFAE47", "#EE7A12", "#9A4204"],
    fold: ["#FFF0D2", "#FFC470"],
    rule: ["#FFFFFF", "#FFF4E2"],
    badge: ["#B83A0C", "#8E2407", "#611603"],
    shadow: "#2A1203",
    shadowSheet: "#5A2606",
    letter: "#FFFFFF",
  });
  mark.SMALL.sheet.radius = original;

  const svgPath = path.join(work, `r${radius}.svg`);
  fs.writeFileSync(svgPath, svg);

  const cells = [];
  for (const size of SIZES) {
    const png = path.join(work, `r${radius}-${size}.png`);
    execFileSync(
      process.execPath,
      [path.join(root, "scripts", "render-icon.cjs"), svgPath, png, String(size)],
      { cwd: root, stdio: "pipe" }
    );
    cells.push({ size, png, dataUrl: "data:image/png;base64," + fs.readFileSync(png).toString("base64") });
  }
  rows.push({ radius, cells });
}

(async () => {
  const playwrightPath = path.join(root, "node_modules", "playwright-core");
  if (!fs.existsSync(playwrightPath)) {
    console.error("SKIP: playwright-core missing");
    process.exit(1);
  }
  const { chromium } = require(playwrightPath);
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 400 }, deviceScaleFactor: 1 });
    const payload = rows.map((r) => ({
      radius: r.radius,
      cells: r.cells.map((c) => ({ size: c.size, dataUrl: c.dataUrl })),
    }));

    await page.setContent(`<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;background:#1b2a3d;color:#e8eef7;font:12px/1.4 "Segoe UI",sans-serif}
  .row{padding:14px 20px 18px;border-top:1px solid rgba(255,255,255,.12)}
  .head{font:600 13px "Segoe UI";margin-bottom:10px}
  .band{display:flex;gap:26px;align-items:flex-end}
  .cell{display:flex;flex-direction:column;gap:6px;align-items:center}
  canvas{image-rendering:pixelated;display:block}
  .lbl{opacity:.62;font-size:11px}
</style>
<div id="sheet"></div>
<script>
const rows = ${JSON.stringify(payload)};
const sheet = document.getElementById("sheet");
(async () => {
  for (const row of rows) {
    const wrap = document.createElement("div");
    wrap.className = "row";
    const h = document.createElement("div");
    h.className = "head";
    h.textContent = "corner radius " + row.radius.toFixed(1) + " units";
    wrap.appendChild(h);
    const band = document.createElement("div");
    band.className = "band";
    for (const c of row.cells) {
      const img = new Image();
      await new Promise((res) => { img.onload = res; img.src = c.dataUrl; });
      const z = Math.round(190 / c.size);
      const cv = document.createElement("canvas");
      cv.width = c.size * z; cv.height = c.size * z;
      const g = cv.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, c.size, c.size, 0, 0, c.size * z, c.size * z);
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.appendChild(cv);
      const lbl = document.createElement("span");
      lbl.className = "lbl";
      const px = row.radius / 48 * c.size;
      lbl.textContent = c.size + " px  (r = " + px.toFixed(2) + " device px)";
      cell.appendChild(lbl);
      band.appendChild(cell);
    }
    wrap.appendChild(band);
    sheet.appendChild(wrap);
  }
  document.title = "ready";
})();
</script>`);
    await page.waitForFunction(() => document.title === "ready", null, { timeout: 30000 });
    await page.waitForTimeout(150);
    await page.screenshot({ path: out, fullPage: true });
    console.log("wrote", path.relative(root, out));
    for (const r of payload) {
      const parts = r.cells.map((c) => `${c.size}px r=${(r.radius / 48 * c.size).toFixed(2)}dev`);
      console.log(`  radius ${r.radius.toFixed(1)}u -> ${parts.join(", ")}`);
    }
  } finally {
    await browser.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

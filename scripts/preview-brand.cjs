/* Render brand marks for visual review, at true pixel sizes.
 *
 * Usage:
 *   node scripts/preview-brand.cjs <out.png> <svg>... [--sizes=16,24,32,48,64,128,256]
 *                                   [--bg=light|dark] [--zoom=6]
 *
 * Why this exists: judging an icon means looking at the pixels Windows will
 * actually show, not at a scaled-up 1024 px render. Every size is rasterised at
 * its real pixel count (one <img> laid out at that CSS size, device scale 1, then
 * an element screenshot), and only then magnified with nearest-neighbour for
 * inspection. Scaling a big raster down would hide exactly the mush we are
 * looking for.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};

if (positional.length < 2) {
  console.error("usage: node scripts/preview-brand.cjs <out.png> <svg>... [--sizes=...] [--bg=light|dark]");
  process.exit(2);
}

const out = path.resolve(positional[0]);
const svgs = positional.slice(1).map((p) => path.resolve(p));
const sizes = flag("sizes", "16,24,32,48,64,128,256")
  .split(",")
  .map((s) => Number.parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0);
const bgName = flag("bg", "light");
const forcedZoom = Number.parseInt(flag("zoom", "0"), 10);

const playwrightPath = path.join(root, "rea", "node_modules", "playwright-core");
if (!fs.existsSync(playwrightPath)) {
  console.error("SKIP: rea/node_modules/playwright-core is not installed");
  process.exit(1);
}
const { chromium } = require(playwrightPath);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const BG = { light: "#f3f6fa", dark: "#1f2430", white: "#ffffff" };
const bg = BG[bgName] || bgName;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    // --- Pass 1: rasterise every (variant, size) at its true pixel size. ---
    const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
    const cells = [];
    for (const svgPath of svgs) {
      // Inline as a data URL rather than a file:// reference: setContent runs on
      // an about:blank document, and that context is not allowed to load file
      // URLs, which silently leaves every <img> unloaded.
      // Intrinsic width/height are stripped so the CSS box alone decides the
      // raster size — with them present Chromium rasterises at 48 px and the
      // screenshot is a resample rather than a true-size render.
      const svgText = fs
        .readFileSync(svgPath, "utf8")
        .replace(/\swidth="[^"]*"/, "")
        .replace(/\sheight="[^"]*"/, "");
      const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
      for (const size of sizes) cells.push({ svgPath, url, size });
    }

    await page.setContent(`<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:${bg}} .m{display:block}</style>
<div id="host" style="display:flex;flex-wrap:wrap;gap:8px;padding:8px"></div>
<script>
  const cells = ${JSON.stringify(cells.map(({ url, size }) => ({ url, size })))};
  const host = document.getElementById("host");
  for (const c of cells) {
    const img = document.createElement("img");
    img.className = "m";
    img.src = c.url;
    img.width = c.size;
    img.height = c.size;
    host.appendChild(img);
  }
</script>`);
    await page.waitForFunction(
      () => [...document.querySelectorAll("img")].every((i) => i.complete && i.naturalWidth > 0),
      null,
      { timeout: 20000 }
    );
    await page.waitForTimeout(80);

    const handles = await page.locator("img.m").all();
    const rasters = [];
    for (let i = 0; i < handles.length; i += 1) {
      const buf = await handles[i].screenshot({ omitBackground: true });
      rasters.push({
        svgPath: cells[i].svgPath,
        size: cells[i].size,
        label: path.basename(cells[i].svgPath, ".svg"),
        dataUrl: "data:image/png;base64," + buf.toString("base64"),
      });
    }
    await page.close();

    // --- Pass 2: compose the review sheet with nearest-neighbour magnification. ---
    const sheet = await browser.newPage({ viewport: { width: 1600, height: 700 }, deviceScaleFactor: 1 });
    const fg = bgName === "dark" ? "#dbe3ee" : "#5a6675";
    await sheet.setContent(`<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;background:${bg};font:12px/1.4 "Segoe UI",sans-serif;color:${fg}}
  .band{display:flex;gap:26px;align-items:flex-end;padding:20px 22px 26px}
  .rowlabel{font:600 12px "Segoe UI";padding:18px 22px 0;letter-spacing:.02em;opacity:.75}
  .cell{display:flex;flex-direction:column;gap:8px;align-items:center}
  canvas{image-rendering:pixelated;display:block}
  .lbl{font-variant-numeric:tabular-nums;white-space:nowrap;opacity:.85}
</style>
<div id="sheet"></div>
<script>
const rasters = ${JSON.stringify(rasters)};
const forcedZoom = ${forcedZoom};
const sheet = document.getElementById("sheet");
const order = [...new Set(rasters.map((r) => r.svgPath))];
(async () => {
  for (const variant of order) {
    const mine = rasters.filter((x) => x.svgPath === variant);
    const label = document.createElement("div");
    label.className = "rowlabel";
    label.textContent = mine[0].label;
    sheet.appendChild(label);

    const band = document.createElement("div");
    band.className = "band";
    for (const r of mine) {
      const img = new Image();
      await new Promise((res) => { img.onload = res; img.src = r.dataUrl; });
      const z = forcedZoom || Math.max(2, Math.round(190 / r.size));
      const c = document.createElement("canvas");
      c.width = r.size * z;
      c.height = r.size * z;
      const g = c.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, r.size, r.size, 0, 0, r.size * z, r.size * z);

      const cell = document.createElement("div");
      cell.className = "cell";
      cell.appendChild(c);
      const lbl = document.createElement("span");
      lbl.className = "lbl";
      lbl.textContent = r.size + "\\u00a0px";
      cell.appendChild(lbl);
      band.appendChild(cell);
    }
    sheet.appendChild(band);
  }
  document.title = "ready";
})();
</script>`);
    await sheet.waitForFunction(() => document.title === "ready", null, { timeout: 20000 });
    await sheet.waitForTimeout(120);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await sheet.screenshot({ path: out, fullPage: true });
    console.log("wrote", out);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

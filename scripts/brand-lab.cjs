/* Render every colour theme in app/brand/palettes.json side by side.
 *
 * The point is comparison, so the sheet is built to be judged rather than admired:
 * every theme shows the SAME drawing at the sizes Windows actually uses, at true
 * pixel size first and then magnified with nearest-neighbour. Nothing is scaled
 * down from a big raster, because a 1024 px render resampled to a thumbnail hides
 * exactly the mush that makes a small icon fail.
 *
 * Usage:
 *   node scripts/brand-lab.cjs [--out=app/brand/preview/theme-lab.png]
 *                              [--sizes=16,24,32,48,64,128]
 *                              [--zoom=0]        (0 = auto per size)
 *                              [--bg=light|dark|both]
 *                              [--only=amber,teal]
 *
 * Writes one PNG. The `selected` theme in palettes.json is marked.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const brandDir = path.join(root, "app", "brand");
const palettePath = path.join(brandDir, "palettes.json");
const mark = require("./lib/brand-mark.cjs");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};

const out = path.resolve(root, flag("out", "app/brand/preview/theme-lab.png"));
const sizes = flag("sizes", "16,24,32,48,64,128")
  .split(",")
  .map((s) => Number.parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0);
const forcedZoom = Number.parseInt(flag("zoom", "0"), 10);
const bgMode = flag("bg", "both");
const only = flag("only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const palette = JSON.parse(fs.readFileSync(palettePath, "utf8"));
const allIds = Object.keys(palette.themes);
const ids = only.length ? allIds.filter((id) => only.includes(id)) : allIds;
if (!ids.length) {
  console.error(`no themes matched --only=${only.join(",")} (have: ${allIds.join(", ")})`);
  process.exit(2);
}

const playwrightPath = path.join(root, "rea", "node_modules", "playwright-core");
if (!fs.existsSync(playwrightPath)) {
  console.error("SKIP: rea/node_modules/playwright-core is not installed");
  process.exit(1);
}
const { chromium } = require(playwrightPath);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const BACKGROUNDS = {
  light: { css: "#eef1f5", ink: "#28313d", sub: "#5a6675" },
  dark: { css: "#1b2a3d", ink: "#e8eef7", sub: "#9fb0c4" },
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    // Rasterise each (theme, size) at its TRUE pixel size: the img is laid out at
    // `size` CSS px with deviceScaleFactor 1 and screenshotted, so a 16 px entry
    // really is 16 px of the artwork, not a resample of a bigger render.
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
    const cells = [];
    for (const id of ids) {
      const theme = palette.themes[id];
      for (const kind of ["master", "small"]) {
        const svg = kind === "master" ? mark.masterSvg(theme) : mark.smallSvg(theme);
        const url =
          "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace(/\swidth="48"/, "").replace(/\sheight="48"/, ""));
        for (const size of sizes) cells.push({ id, kind, size, url });
      }
    }

    await page.setContent(`<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#fff} .m{display:block}</style>
<div id="host" style="display:flex;flex-wrap:wrap"></div>
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

    const bgs = bgMode === "both" ? ["light", "dark"] : [bgMode];
    const sheet = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
    await sheet.setContent(`<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;font:12px/1.45 "Segoe UI",sans-serif;background:#bec4cc}
  .stack{display:block}
  .gap{height:10px;background:#bec4cc}
  .bglabel{padding:10px 22px 4px;font:600 11px "Segoe UI";letter-spacing:.09em;text-transform:uppercase}
  .theme{padding:14px 22px 18px;border-top:1px solid rgba(128,128,128,.25)}
  .head{display:flex;align-items:baseline;gap:10px;margin-bottom:10px;flex-wrap:wrap}
  .name{font:600 14px "Segoe UI";letter-spacing:.01em}
  .sel{font:600 10px "Segoe UI";letter-spacing:.09em;text-transform:uppercase;padding:2px 7px;border-radius:999px;border:1px solid currentColor}
  .swatches{display:flex;gap:4px;margin-left:auto;align-items:center}
  .sw{width:26px;height:13px;border-radius:3px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.18)}
  .band{display:flex;gap:22px;align-items:flex-end;flex-wrap:wrap}
  .cell{display:flex;flex-direction:column;gap:6px;align-items:center}
  canvas{image-rendering:pixelated;display:block}
  .lbl{font-variant-numeric:tabular-nums;white-space:nowrap;opacity:.72;font-size:11px}
  .kind{font:600 10px "Segoe UI";letter-spacing:.08em;text-transform:uppercase;opacity:.6;margin:12px 0 4px}
  .rationale{padding:0 22px 10px;font-size:11.5px;opacity:.8;max-width:1100px}
</style>
<div id="sheet"></div>
<script>
const rasters = ${JSON.stringify(rasters)};
const themes = ${JSON.stringify(ids.map((id) => ({ ...palette.themes[id], id })))};
const selected = ${JSON.stringify(palette.selected)};
const forcedZoom = ${forcedZoom};
const bgs = ${JSON.stringify(bgs.map((b) => ({ name: b, ...BACKGROUNDS[b] })))};
const sheet = document.getElementById("sheet");

(async () => {
  let first = true;
  for (const bg of bgs) {
    if (!first) {
      const gap = document.createElement("div");
      gap.className = "gap";
      sheet.appendChild(gap);
    }
    first = false;

    const stack = document.createElement("div");
    stack.className = "stack";
    stack.dataset.bg = bg.name;
    stack.style.background = bg.css;

    const bgLabel = document.createElement("div");
    bgLabel.className = "bglabel";
    bgLabel.style.color = bg.sub;
    bgLabel.textContent = "on " + bg.name + " background";
    stack.appendChild(bgLabel);

    for (const theme of themes) {
      const section = document.createElement("div");
      section.className = "theme";

      const head = document.createElement("div");
      head.className = "head";
      head.style.color = bg.ink;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = theme.id + " — " + theme.label;
      head.appendChild(name);
      if (theme.id === selected) {
        const sel = document.createElement("span");
        sel.className = "sel";
        sel.textContent = "selected";
        head.appendChild(sel);
      }
      const sw = document.createElement("div");
      sw.className = "swatches";
      const capSheet = document.createElement("span");
      capSheet.className = "lbl";
      capSheet.style.color = bg.sub;
      capSheet.textContent = "sheet \\u2192";
      sw.appendChild(capSheet);
      for (const color of theme.sheet) {
        const chip = document.createElement("span");
        chip.className = "sw";
        chip.style.background = color;
        chip.title = color;
        sw.appendChild(chip);
      }
      const capBadge = document.createElement("span");
      capBadge.className = "lbl";
      capBadge.style.color = bg.sub;
      capBadge.textContent = "badge \\u2192";
      capBadge.style.marginLeft = "8px";
      sw.appendChild(capBadge);
      for (const color of theme.badge) {
        const chip = document.createElement("span");
        chip.className = "sw";
        chip.style.background = color;
        chip.title = "badge " + color;
        sw.appendChild(chip);
      }
      head.appendChild(sw);
      section.appendChild(head);

      for (const kind of ["master", "small"]) {
        const kindLabel = document.createElement("div");
        kindLabel.className = "kind";
        kindLabel.style.color = bg.sub;
        kindLabel.textContent = kind === "master" ? "master (32 px and up)" : "small optical size (16-24 px)";
        section.appendChild(kindLabel);

        const band = document.createElement("div");
        band.className = "band";
        const mine = rasters.filter((r) => r.id === theme.id && r.kind === kind);
        for (const r of mine) {
          const img = new Image();
          await new Promise((res) => { img.onload = res; img.src = r.dataUrl; });
          const z = forcedZoom || Math.max(1, Math.round(150 / r.size));
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
          lbl.style.color = bg.sub;
          lbl.textContent = r.size + "\\u00a0px";
          cell.appendChild(lbl);
          band.appendChild(cell);
        }
        section.appendChild(band);
      }

      const why = document.createElement("div");
      why.className = "rationale";
      why.style.color = bg.sub;
      why.textContent = theme.rationale;
      section.appendChild(why);

      stack.appendChild(section);
    }
    sheet.appendChild(stack);
  }
  document.title = "ready";
})();
</script>`);
    await sheet.waitForFunction(() => document.title === "ready", null, { timeout: 30000 });
    await sheet.waitForTimeout(150);

    fs.mkdirSync(path.dirname(out), { recursive: true });
    await sheet.screenshot({ path: out, fullPage: true });
    console.log("wrote", path.relative(root, out));
    console.log(`themes: ${ids.join(", ")} (selected: ${palette.selected})`);
    console.log(`sizes: ${sizes.join(", ")} px; backgrounds: ${bgs.join(", ")}`);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

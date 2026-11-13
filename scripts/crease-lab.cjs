/* Choose the CREASE fillet radius from pixels, the way the outer radius was chosen.
 *
 * The turned-corner cut has two ends, both convex 135-degree corners:
 *   - the CREASE, where the top edge turns onto the diagonal;
 *   - the OUTER vertex, where the diagonal meets the right edge.
 * A fillet on a corner that shallow only pulls the silhouette in by 0.082 * radius,
 * so a radius that "looks fine" in the source is invisible after rasterisation. The
 * only honest way to pick it is to render candidates at the sizes a user sees and
 * measure the pull.
 *
 * This renders a sweep at true pixel sizes (never a big render scaled down, which
 * hides exactly the mush small icons fail on) and prints the predicted pull for each
 * candidate in device pixels at every size.
 *
 * Usage: node scripts/crease-lab.cjs [--out=app/brand/preview/crease-lab.png]
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const mark = require("./lib/brand-mark.cjs");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};
const out = path.resolve(root, flag("out", "app/brand/preview/crease-lab.png"));
const SIZES = [32, 48, 64, 128, 256];
const RADII = [0, 6.0, 10.0, 14.0, 17.5, 21.0];

const palette = JSON.parse(fs.readFileSync(path.join(root, "app", "brand", "palettes.json"), "utf8"));
const theme = palette.themes[palette.selected];

const work = path.join(root, "app", "brand", "preview", ".crease-lab");
fs.mkdirSync(work, { recursive: true });

const rows = [];
for (const radius of RADII) {
  const original = mark.MASTER.sheet.creaseRadius;
  mark.MASTER.sheet.creaseRadius = radius;
  let svg;
  try {
    svg = mark.masterSvg(theme);
  } catch (error) {
    console.log(`creaseRadius ${radius}: REJECTED — ${error.message}`);
    mark.MASTER.sheet.creaseRadius = original;
    continue;
  }
  mark.MASTER.sheet.creaseRadius = original;

  const svgPath = path.join(work, `c${radius}.svg`);
  fs.writeFileSync(svgPath, svg);

  const cells = [];
  for (const size of SIZES) {
    const png = path.join(work, `c${radius}-${size}.png`);
    execFileSync(
      process.execPath,
      [path.join(root, "scripts", "render-icon.cjs"), svgPath, png, String(size)],
      { cwd: root, stdio: "pipe" }
    );
    cells.push({ size, dataUrl: "data:image/png;base64," + fs.readFileSync(png).toString("base64") });
  }
  rows.push({ radius, cells });
}

(async () => {
  const { chromium } = require(path.join(root, "node_modules", "playwright-core"));
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
    const payload = rows.map((r) => ({ radius: r.radius, cells: r.cells }));
    await page.setContent(`<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;background:#1b1f27;color:#e8eef7;font:12px/1.4 "Segoe UI",sans-serif}
  .row{padding:12px 20px 16px;border-top:1px solid rgba(255,255,255,.12)}
  .h{font:600 13px;margin-bottom:8px}
  .h span{opacity:.62;font-weight:400}
  .band{display:flex;gap:24px;align-items:flex-end}
  .cell{display:flex;flex-direction:column;gap:5px;align-items:center}
  canvas{image-rendering:pixelated;display:block}
  .lbl{opacity:.62;font-size:11px}
</style><div id="s"></div>
<script>
const rows=${JSON.stringify(payload)};
const s=document.getElementById("s");
(async()=>{
for(const row of rows){
  const w=document.createElement("div");w.className="row";
  const h=document.createElement("div");h.className="h";
  const pull=row.radius*${JSON.stringify(mark.FILLET_PULL_RATIO)};
  h.innerHTML="creaseRadius "+(row.radius===0?"0 (sharp, the shipped bug)":row.radius.toFixed(1)+"u")+
    " <span>— predicted pull "+pull.toFixed(2)+"u</span>";
  w.appendChild(h);
  const band=document.createElement("div");band.className="band";
  for(const c of row.cells){
    const img=new Image();await new Promise(r2=>{img.onload=r2;img.src=c.dataUrl;});
    const z=Math.max(2, Math.round(150/c.size));
    const cv=document.createElement("canvas");cv.width=c.size*z;cv.height=c.size*z;
    const g=cv.getContext("2d");g.imageSmoothingEnabled=false;
    g.drawImage(img,0,0,c.size,c.size,0,0,c.size*z,c.size*z);
    const cell=document.createElement("div");cell.className="cell";cell.appendChild(cv);
    const l=document.createElement("span");l.className="lbl";l.textContent=c.size+"px";
    cell.appendChild(l);band.appendChild(cell);
  }
  w.appendChild(band);s.appendChild(w);
}
document.title="ready";})();
</script>`);
    await page.waitForFunction(() => document.title === "ready", null, { timeout: 30000 });
    await page.waitForTimeout(140);
    await page.screenshot({ path: out, fullPage: true });
    console.log("wrote", path.relative(root, out));
    for (const r of payload) {
      const pull = r.radius * mark.FILLET_PULL_RATIO;
      const at = SIZES.map((s) => `${(pull * s) / 48 >= 1 ? "" : "~"}${((pull * s) / 48).toFixed(2)}`).join(" / ");
      console.log(`  creaseRadius ${String(r.radius).padStart(4)}u -> pull ${pull.toFixed(2)}u = ${at} device px at ${SIZES.join("/")}`);
    }
  } finally {
    await browser.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

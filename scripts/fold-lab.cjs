/* Find the fillet radii the turned-corner cut needs, from pixels.
 *
 * The cut has TWO convex 135-degree ends and both need rounding:
 *   - the CREASE, where the top edge turns onto the diagonal;
 *   - the OUTER vertex, where the diagonal meets the right edge.
 *
 * The trap, twice-learned: a fillet on a corner this shallow only pulls the
 * silhouette in by
 *
 *     radius * (1/sin(67.5deg) - 1) = 0.0824 * radius
 *
 * so a radius that emits a perfectly real arc can still be invisible at every size a
 * user actually looks at. At 4.2 units the pull is 0.35 units — under one device pixel
 * at 48 px — and the corner went on reading as the acute point it was. Both defects
 * the user reported came from choosing a radius by looking at the 1024 px master.
 *
 * This renders a sweep at true pixel sizes (never a big render scaled down, which
 * hides exactly the mush small icons fail on) and prints the pull in DEVICE pixels at
 * each size, so the choice is made from what ships.
 *
 * Usage:
 *   node scripts/fold-lab.cjs                       # both corners, chosen radii
 *   node scripts/fold-lab.cjs --crease             # sweep the crease radius
 *   node scripts/fold-lab.cjs --outer              # sweep the outer radius
 *   node scripts/fold-lab.cjs --out=path.png
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
const out = path.resolve(root, flag("out", "app/brand/preview/fold-lab.png"));
const SIZES = [32, 48, 64, 128, 256];

/* Two modes. Without a switch this documents the SHIPPED choice: the crease and outer
 * radii as configured, showing the pull each produces. With `--crease` or `--outer`
 * it renders a sweep of candidates for that corner so the choice can be re-derived. */
const mode = argv.includes("--crease") ? "crease" : argv.includes("--outer") ? "outer" : "shipped";
const RADII = argv.includes("--crease")
  ? [0, 6.0, 10.0, 14.0, 17.5, 21.0]
  : argv.includes("--outer")
    ? [0, 4.2, 8.0, 13.0, 18.0, 22.0]
    : [null]; // null = as shipped

const palette = JSON.parse(fs.readFileSync(path.join(root, "app", "brand", "palettes.json"), "utf8"));
const theme = palette.themes[palette.selected];
const BASE = {
  crease: mark.MASTER.sheet.creaseRadius,
  outer: mark.MASTER.sheet.cutRadius,
};

const work = path.join(root, "app", "brand", "preview", ".fold-lab");
fs.mkdirSync(work, { recursive: true });

const rows = [];
for (const radius of RADII) {
  const applied = radius === null ? BASE[mode === "shipped" ? "crease" : mode] : radius;
  const original = mark.MASTER.sheet;
  const saved = { creaseRadius: original.creaseRadius, cutRadius: original.cutRadius };
  if (mode === "crease") mark.MASTER.sheet.creaseRadius = applied;
  else if (mode === "outer") mark.MASTER.sheet.cutRadius = applied;

  let svg;
  try {
    svg = mark.masterSvg(theme);
  } catch (error) {
    console.log(`  ${mode} radius ${applied}: REJECTED — ${error.message}`);
    mark.MASTER.sheet.creaseRadius = saved.creaseRadius;
    mark.MASTER.sheet.cutRadius = saved.cutRadius;
    continue;
  }
  mark.MASTER.sheet.creaseRadius = saved.creaseRadius;
  mark.MASTER.sheet.cutRadius = saved.cutRadius;

  const svgPath = path.join(work, `${mode}-${applied}.svg`);
  fs.writeFileSync(svgPath, svg);

  const cells = [];
  for (const size of SIZES) {
    const png = path.join(work, `${mode}-${applied}-${size}.png`);
    execFileSync(
      process.execPath,
      [path.join(root, "scripts", "render-icon.cjs"), svgPath, png, String(size)],
      { cwd: root, stdio: "pipe" }
    );
    cells.push({ size, dataUrl: "data:image/png;base64," + fs.readFileSync(png).toString("base64") });
  }
  rows.push({ radius: applied, cells });
}

(async () => {
  const { chromium } = require(path.join(root, "rea", "node_modules", "playwright-core"));
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
    const payload = rows.map((r) => ({ radius: r.radius, cells: r.cells }));
    const ratio = mark.FILLET_PULL_RATIO;
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
const MODE=${JSON.stringify(mode)};
const SIZES=${JSON.stringify(SIZES)};
const rows=${JSON.stringify(payload)};
const s=document.getElementById("s");
(async()=>{
for(const row of rows){
  const w=document.createElement("div");w.className="row";
  const h=document.createElement("div");h.className="h";
  const pull=row.radius*${JSON.stringify(ratio)};
  const dev=SIZES.map(sz=>(pull*sz/48)).map(p=>p>=1?p.toFixed(1):"~"+p.toFixed(2)).join(" / ");
  h.innerHTML=(MODE==="shipped"?"crease radius (as shipped) ":"")+
    (MODE==="shipped"?"":MODE+" ") + (row.radius===0?"0 — sharp corner":row.radius.toFixed(1)+"u")+
    " <span>— pull "+pull.toFixed(2)+"u = "+dev+" device px at "+SIZES.join("/")+"</span>";
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
      const pull = r.radius * ratio;
      const dev = SIZES.map((s) => `${(pull * s) / 48 >= 1 ? "" : "~"}${((pull * s) / 48).toFixed(2)}`).join(" / ");
      console.log(`  ${mode} radius ${String(r.radius).padStart(5)}u -> pull ${pull.toFixed(2)}u = ${dev} device px at ${SIZES.join("/")}`);
    }
  } finally {
    await browser.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

/* Rasterise an Azkript brand SVG to a square PNG with a transparent background.
 *
 * Usage: node scripts/render-icon.cjs <input.svg> <output.png> [size]
 *
 * This is the single rasterisation step used by scripts/make-icon.py, so the
 * desktop icon is derived from the master mark in app/brand/ instead of being
 * redrawn with Pillow primitives. Chrome + playwright-core are the same pair the
 * browser smoke test and render-brand.cjs already depend on; Chrome's SVG
 * renderer applies the gradients, the drop shadow filter and the rounded plate
 * exactly as the in-app <img>/inline SVG does.
 *
 * The page background is left fully transparent: `omitBackground` plus a
 * transparent `html,body`. The SVG is injected as an inline <svg> sized to the
 * requested pixel box, so nothing is scaled by CSS after rasterisation.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const [inputArg, outputArg, sizeArg] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  console.error("usage: node scripts/render-icon.cjs <input.svg> <output.png> [size]");
  process.exit(2);
}
const input = path.resolve(root, inputArg);
const output = path.resolve(root, outputArg);
const size = Number.parseInt(sizeArg || "1024", 10);
if (!Number.isFinite(size) || size <= 0) {
  console.error(`invalid size: ${sizeArg}`);
  process.exit(2);
}

const playwrightPath = path.join(root, "node_modules", "playwright-core");
if (!fs.existsSync(playwrightPath)) {
  console.error("SKIP: node_modules/playwright-core is not installed");
  process.exit(1);
}
const { chromium } = require(playwrightPath);
const chrome =
  process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const svg = fs.readFileSync(input, "utf8");
// Force the rasterisation box from the outside; the master file keeps its own
// width/height for the app to use.
const sized = svg.replace(/<svg\b/, `<svg width="${size}" height="${size}"`);
const html = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden}
  svg{display:block}
</style>
${sized}`;

(async () => {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForTimeout(120);
    await page.screenshot({ path: output, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  } finally {
    await browser.close();
  }
  console.log(`rendered ${input} -> ${output} (${size}x${size})`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

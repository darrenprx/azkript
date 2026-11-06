/* Non-interactive UI review: no desktop windows, clipboard, or audio. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const { chromium } = require(path.join(root, 'rea/node_modules/playwright-core'));
(async () => {
  const out = path.join(root, 'reports/bug-audit');
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--mute-audio'] });
  try {
    const measurements = [];
    for (const [width, theme] of [[1440, 'light'], [1080, 'dark'], [390, 'light']]) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(theme => localStorage.setItem('azkript.prefs.v2', JSON.stringify({ theme, startCenter: false })), theme);
      await page.goto(pathToFileURL(path.join(root, 'app/index.html')).href);
      await page.waitForFunction(() => !document.querySelector('#appShell').classList.contains('is-loading'));
      for (const view of ['script', 'sceneview', 'navigator', 'beatboard', 'characters', 'reports']) {
        await page.locator(`.rail__item[data-view="${view}"]`).click();
        await page.waitForTimeout(150);
        const metrics = await page.evaluate(() => ({
          viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
          visibleView: document.querySelector('.view:not([hidden])')?.dataset.viewPanel,
        }));
        assert.equal(metrics.visibleView, view);
        assert.ok(metrics.documentWidth <= width + 1, `page overflows at ${width}px in ${view}: ${metrics.documentWidth}`);
        measurements.push({ width, theme, view, ...metrics });
        await page.screenshot({ path: path.join(out, `${width}-${theme}-${view}.png`) });
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    await fs.writeFile(path.join(out, 'responsive.json'), JSON.stringify(measurements, null, 2));
    console.log(`PASS: ${measurements.length} real navigation/layout states; screenshots saved to reports/bug-audit`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

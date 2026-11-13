/* Exercise hostile recovery/branch markup in a real browser DOM. */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '../..');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--mute-audio'] });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('azkript.prefs.v2', JSON.stringify({ startCenter: false }));
      if (!localStorage.getItem('azkript.document.v3')) localStorage.setItem('azkript.document.v3', JSON.stringify({ paragraphs: [{ type: 'Action', html: '<strong>SECURITY VISIBLE TEXT</strong><img src="missing" onerror="window.__injected=true"><iframe src="index.html"></iframe><span style="position:fixed;inset:0;color:#112233" onclick="window.__injected=true">safe span</span>' }] }));
    });
    await page.goto(pathToFileURL(path.join(root, 'app/index.html')).href);
    await page.waitForFunction(() => !document.querySelector('#appShell').classList.contains('is-loading'));
    assert.match(await page.locator('#editor').innerText(), /SECURITY VISIBLE TEXT/);
    assert.equal(await page.locator('#editor img, #editor iframe, #editor [onclick]').count(), 0);
    assert.equal(await page.evaluate(() => Boolean(window.__injected)), false);
    const result = await page.evaluate(() => {
      const holder = document.createElement('div');
      holder.innerHTML = FDModel.sanitizeHtml('<svg><foreignObject><p onload="bad()">text</p></foreignObject></svg><span data-fdx="&quot;&gt;&lt;img src=x onerror=bad()&gt;">remaining</span>');
      return { active: holder.querySelectorAll('svg, iframe, img, [onload], [onerror]').length, text: holder.textContent };
    });
    assert.equal(result.active, 0); assert.match(result.text, /remaining/);
    await page.evaluate(() => {
      const doc = JSON.parse(localStorage.getItem('azkript.document.v3'));
      doc.story = { lanes: [{ id: 'lane-test', name: 'Imported lane', height: '120\"><img src=missing onerror="window.__injected=true">' }] };
      localStorage.setItem('azkript.document.v3', JSON.stringify(doc));
    });
    await page.reload(); await page.locator('#storyToolsButton').click(); await page.locator('#story-timeline').click();
    assert.equal(await page.locator('#storyRoot img, #storyRoot [onerror]').count(), 0);
    assert.equal(await page.locator('.story-lane').evaluate(element => element.style.height), '120px');
    const blocked = await page.evaluate(() => new Promise(resolve => {
      const frame = document.createElement('iframe');
      const finish = value => { clearTimeout(timer); document.removeEventListener('securitypolicyviolation', violation); frame.remove(); resolve(value); };
      const violation = event => { if (event.effectiveDirective === 'frame-src') finish(true); };
      const timer = setTimeout(() => finish(false), 3000);
      document.addEventListener('securitypolicyviolation', violation);
      frame.src = 'index.html'; document.body.appendChild(frame);
    }));
    assert.equal(blocked, true, 'CSP independently blocks embedded frames');
    console.log('PASS: hostile recovery and story HTML is inert, valid formatting remains, and CSP blocks frames.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

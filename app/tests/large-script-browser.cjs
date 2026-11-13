/* Actual typing/search/navigation benchmark in a 150–300 page screenplay. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const M = require('../js/model.js');
const pagination = require('../js/pagination.js');
const root = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(root, 'node_modules/playwright-core'));
(async () => {
  const doc = M.blankDocument(); doc.title = 'Long-script benchmark'; doc.titlePage.enabled = false;
  doc.paragraphs = Array.from({ length: 2400 }, (_, index) => M.makeParagraph(index % 100 === 0 ? 'Scene Heading' : 'Action',
    index % 100 === 0 ? `INT. TEST LOCATION ${index / 100 + 1} - DAY` : `Block ${index}: ${'screenplay '.repeat(20)}`));
  const expected = pagination.layout(doc).scriptPageCount;
  assert.ok(expected >= 150 && expected <= 300, `fixture is ${expected} pages`);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--mute-audio'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(document => {
      localStorage.setItem('azkript.document.v3', JSON.stringify(document));
      localStorage.setItem('azkript.prefs.v2', JSON.stringify({ startCenter: false, smartTypeEnabled: false }));
    }, doc);
    const start = Date.now();
    await page.goto(pathToFileURL(path.join(root, 'app/index.html')).href);
    await page.waitForFunction(() => !document.querySelector('#appShell').classList.contains('is-loading'), null, { timeout: 30000 });
    const bootMilliseconds = Date.now() - start;
    await page.evaluate(() => {
      window.__editLatencies = [];
      document.querySelector('#editor').addEventListener('beforeinput', () => {
        const start = performance.now(); requestAnimationFrame(() => window.__editLatencies.push(performance.now() - start));
      }, { capture: true });
    });
    const action = page.locator('.para[data-type="Action"]').first(); await action.click(); await page.keyboard.press('End');
    await page.keyboard.type(' fast editing checks', { delay: 5 });
    await page.waitForTimeout(100);
    assert.match(await action.innerText(), /fast editing checks/);
    const latencies = await page.evaluate(() => window.__editLatencies.slice().sort((a, b) => a - b));
    assert.ok(latencies.length > 0);
    const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];
    assert.ok(p95 < 500, `95th percentile input-to-frame latency ${p95.toFixed(1)}ms exceeds the regression budget`);

    await page.keyboard.press('Control+f'); const searchStart = Date.now();
    await page.locator('#findInput').fill('Block 2399:');
    await page.waitForFunction(() => document.querySelectorAll('.find-result').length > 0, null, { timeout: 10000 });
    const searchMilliseconds = Date.now() - searchStart;
    await page.locator('.find-result').first().click();
    await page.locator('#findClose').click();
    await page.waitForFunction(id => document.querySelector('.para.is-active')?.dataset.id === id, doc.paragraphs[2399].id);
    await page.locator('#viewSegmented [data-mode="page"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#pagePreview .pub-para').length > 0);
    const beforeJump = await page.evaluate(() => ({ holders: document.querySelectorAll('#pagePreview > .page-card').length,
      hydrated: document.querySelectorAll('#pagePreview .pub-para').length }));
    assert.ok(beforeJump.holders >= 150 && beforeJump.holders <= 300);
    assert.ok(beforeJump.hydrated > 0 && beforeJump.hydrated < 700, JSON.stringify(beforeJump));
    await page.locator('#pagePreview > .page-card').last().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('#pagePreview > .page-card:last-child')?.textContent.includes('Block 2399:'));
    const afterJump = await page.evaluate(() => ({ holders: document.querySelectorAll('#pagePreview > .page-card').length,
      hydrated: document.querySelectorAll('#pagePreview .pub-para').length,
      lastText: document.querySelector('#pagePreview > .page-card:last-child').textContent.includes('Block 2399:') }));
    assert.equal(afterJump.holders, beforeJump.holders); assert.equal(afterJump.lastText, true);
    assert.ok(afterJump.hydrated > 0 && afterJump.hydrated < 700, JSON.stringify(afterJump));
    assert.deepEqual(errors, []);
    const report = { paragraphs: doc.paragraphs.length, approximatePages: expected, bootMilliseconds,
      typedEvents: latencies.length, inputToFrameP95Milliseconds: p95, searchMilliseconds, selectedLastParagraph: true,
      pagePreview: { beforeJump, afterJump } };
    await fs.writeFile(path.join(root, 'reports/large-script-browser.json'), JSON.stringify(report, null, 2));
    console.log('PASS: ' + JSON.stringify(report));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

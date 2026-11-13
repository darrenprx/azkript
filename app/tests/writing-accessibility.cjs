/* Measured UI accessibility checks; physical assistive-technology QA remains separate. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const M = require('../js/model.js');
const FDX = require('../js/fdx.js');
const root = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(root, 'node_modules/playwright-core'));
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--mute-audio'] });
  const measurements = []; let failures = 0;
  async function check(name, doc, run) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    try {
      await page.addInitScript(doc => {
        localStorage.setItem('azkript.document.v3', JSON.stringify(doc));
        localStorage.setItem('azkript.prefs.v2', JSON.stringify({ startCenter: false, smartTypeEnabled: false }));
      }, doc);
      await page.goto(pathToFileURL(path.join(root, 'app/index.html')).href);
      await page.waitForFunction(() => !document.querySelector('#appShell').classList.contains('is-loading'));
      const result = await run(page, doc); assert.deepEqual(errors, []); measurements.push({ name, ...result }); console.log('PASS: ' + name);
    } catch (error) { failures++; console.error('FAIL: ' + name + '\n' + error.stack); }
    finally { await context.close(); }
  }
  const open = async page => {
    await page.locator('[data-ribbon-tab="view"]').click();
    await page.locator('[data-ribbon-command="view-writing-reliability"]').click();
    await page.waitForFunction(() => document.querySelector('#appDialog').open);
  };
  await check('ribbon Home/End and native dialog keyboard focus stay usable', M.sampleDocument(), async page => {
    await page.locator('[data-ribbon-tab="view"]').focus(); await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.ribbonTab), 'help');
    await page.keyboard.press('Home'); assert.equal(await page.evaluate(() => document.activeElement.dataset.ribbonTab), 'home');
    await open(page);
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
      assert.equal(await page.evaluate(() => document.activeElement.closest('dialog')?.id), 'appDialog');
    }
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#appDialog').open);
    return { keyboardFocusTrapped: true };
  });
  await check('200% interface scaling keeps the editor and save controls inside the viewport', M.sampleDocument(), async page => {
    await open(page); await page.locator('#interfaceScale').selectOption('2');
    await page.locator('#appDialog .btn--primary').click(); await page.waitForFunction(() => !document.querySelector('#appDialog').open);
    const result = await page.evaluate(() => {
      const box = selector => { const el = document.querySelector(selector), rect = el.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height }; };
      return { zoom: Number(getComputedStyle(document.documentElement).zoom), inlineZoom: document.documentElement.style.zoom,
        storedScale: JSON.parse(localStorage.getItem('azkript.prefs.v2')).uiScale, viewport: { width: innerWidth, height: innerHeight },
        editor: box('#paperScroll'), status: box('.statusbar'), save: box('#saveButton') };
    });
    assert.equal(result.zoom, 2, JSON.stringify(result));
    assert.ok(result.editor.top >= 0 && result.editor.bottom <= result.viewport.height + 2 && result.editor.height >= 100,
      `editor is vertically clipped: ${JSON.stringify(result)}`);
    assert.ok(result.editor.left >= 0 && result.editor.right <= result.viewport.width + 2 && result.editor.width >= 200,
      `editor is horizontally clipped: ${JSON.stringify(result)}`);
    assert.ok(result.status.bottom <= result.viewport.height + 2, `statusbar is clipped: ${JSON.stringify(result)}`);
    assert.ok(result.save.right <= result.viewport.width + 2 && result.save.bottom <= result.viewport.height + 2, `save control is clipped: ${JSON.stringify(result)}`);
    await page.screenshot({ path: path.join(root, 'reports/writing-accessibility-200.png') });
    // A keyboard command can reopen and close a dialog at the scaled size.
    await page.keyboard.press('Control+k'); await page.locator('#commandInput').fill('Typography and accessibility');
    await page.keyboard.press('Enter'); await page.waitForFunction(() => document.querySelector('#appDialog').open);
    for (let i = 0; i < 10 && !await page.evaluate(() => document.activeElement.matches('#appDialog .btn--primary')); i++) await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.matches('#appDialog .btn--primary')), true);
    const apply = await page.locator('#appDialog .btn--primary').boundingBox();
    assert.ok(apply && apply.y >= 0 && apply.y + apply.height <= result.viewport.height + 2, `keyboard-focused dialog action cannot be reached at 200%: ${JSON.stringify(apply)}`);
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#appDialog').open);
    const rail = page.locator('.workspace > .rail'); await rail.hover(); await page.mouse.wheel(0, 1000);
    await page.waitForTimeout(100);
    const navigation = await page.locator('.rail__item[data-view="reports"]').evaluate(el => {
      const rail = el.closest('.rail'), a = rail.getBoundingClientRect(), b = el.getBoundingClientRect();
      return { overflowY: getComputedStyle(rail).overflowY, railTop: a.top, railBottom: a.bottom, buttonTop: b.top, buttonBottom: b.bottom };
    });
    assert.match(navigation.overflowY, /auto|scroll/);
    assert.ok(navigation.buttonTop >= navigation.railTop - 1 && navigation.buttonBottom <= navigation.railBottom + 1,
      `lower navigation is not reachable with a mouse wheel at200%: ${JSON.stringify(navigation)}`);
    await page.locator('.rail__item[data-view="reports"]').click();
    await page.waitForFunction(() => !document.querySelector('#reportsView').hidden && document.querySelector('#scriptView').hidden);
    assert.equal(await page.locator('#reportsView').getAttribute('data-view-panel'), 'reports');
    result.navigation = navigation;
    return result;
  });
  await check('forced-colors mode retains visible keyboard focus', M.sampleDocument(), async page => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.locator('[data-ribbon-tab="home"]').focus();
    const result = await page.locator('[data-ribbon-tab="home"]').evaluate(el => {
      const cs = getComputedStyle(el); return { forcedColors: matchMedia('(forced-colors: active)').matches, outlineStyle: cs.outlineStyle,
        outlineWidth: parseFloat(cs.outlineWidth), foreground: cs.color, background: cs.backgroundColor };
    });
    assert.equal(result.forcedColors, true); assert.ok(result.outlineStyle !== 'none' && result.outlineWidth >= 1);
    return result;
  });
  const custom = M.blankDocument(); custom.titlePage.enabled = false;
  custom.elements = { Action: { ...M.ELEMENTS.Action, left: 1, right: 6.5, first: 0.2, before: 18, font: 'Arial', fontSize: 14, spacing: 1.5 } };
  custom.paragraphs = [M.makeParagraph('Action', 'Native typography should be measurable on both surfaces.')];
  await check('custom native typography matches editor and published metrics', custom, async (page, doc) => {
    const measure = selector => page.locator(selector).first().evaluate(el => {
      const cs = getComputedStyle(el); return { family: cs.fontFamily, size: parseFloat(cs.fontSize), lineHeight: parseFloat(cs.lineHeight),
        width: parseFloat(cs.width), indent: parseFloat(cs.textIndent) };
    });
    const write = await measure('#editor .para');
    assert.match(write.family, /Arial/); assert.ok(Math.abs(write.size - 14 * 96 / 72) < 0.1);
    // Preview paper borders occupy a few CSS pixels; the inch geometry must
    // remain within that border allowance rather than shifting whole margins.
    assert.ok(Math.abs(write.lineHeight - 28) < 0.1); assert.ok(Math.abs(write.width - 5.5 * 96) < 6, JSON.stringify(write));
    assert.ok(Math.abs(write.indent - 0.2 * 96) < 0.1);
    await page.locator('#viewSegmented [data-mode="page"]').click();
    const published = await measure(`.pub-para[data-id="${doc.paragraphs[0].id}"]`);
    assert.ok(Math.abs(published.size - write.size) < 0.1); assert.ok(Math.abs(published.lineHeight - write.lineHeight) < 0.1);
    assert.ok(Math.abs(published.width - write.width) < 6); assert.ok(Math.abs(published.indent - write.indent) < 0.1);
    return { write, published };
  });
  const missing = M.cloneDocument(custom); missing.elements.Action.font = 'Azkript Definitely Missing Font 93848';
  await check('font controls activate a workspace override while preserving document geometry and FDX requests', custom, async (page, doc) => {
    const get = () => page.locator('#editor .para').first().evaluate(el => ({ family: getComputedStyle(el).fontFamily,
      size: parseFloat(getComputedStyle(el).fontSize), width: parseFloat(getComputedStyle(el).width) }));
    const before = await get();
    assert.match(await page.locator('#fontSelect option:checked').innerText(), /Document: Arial/);
    await page.locator('#fontSelect').selectOption('Consolas');
    const after = await get();
    assert.match(after.family, /Consolas/); assert.ok(Math.abs(after.width - before.width) < 0.1);
    assert.ok(Math.abs(after.size - 16) < 0.1);
    const persisted = await page.evaluate(() => ({
      mode: JSON.parse(localStorage.getItem('azkript.prefs.v2')).typographyMode,
      font: JSON.parse(localStorage.getItem('azkript.document.v3')).elements.Action.font,
      size: JSON.parse(localStorage.getItem('azkript.document.v3')).elements.Action.fontSize,
    }));
    assert.equal(persisted.mode, 'workspace'); assert.equal(persisted.font, 'Arial'); assert.equal(persisted.size, 14);
    await open(page); assert.match(await page.locator('#appDialog').innerText(), /FDX keeps the document's font requests/);
    await page.locator('#typographyMode').selectOption('document'); await page.locator('#appDialog .btn--primary').click();
    await page.waitForFunction(() => !document.querySelector('#appDialog').open);
    assert.match((await get()).family, /Arial/);
    return { before, after, persisted };
  });
  missing.paragraphs[0].html = FDX.runsToHtml([{ text: 'Native run font', style: '', attrs: { Font: 'Arial', Size: '22' } }]);
  await check('missing fonts are disclosed and workspace override affects native runs', missing, async page => {
    await open(page); assert.match(await page.locator('#appDialog').innerText(), /Not detected; a fallback font will be used/);
    await page.locator('#typographyMode').selectOption('workspace'); await page.locator('#appDialog .btn--primary').click();
    await page.waitForFunction(() => !document.querySelector('#appDialog').open);
    const run = await page.locator('#editor .para span').first().evaluate(el => ({ family: getComputedStyle(el).fontFamily, size: parseFloat(getComputedStyle(el).fontSize) }));
    assert.match(run.family, /Courier New/); assert.ok(Math.abs(run.size - 16) < 0.1);
    return { run };
  });
  await fs.writeFile(path.join(root, 'reports/writing-accessibility.json'), JSON.stringify(measurements, null, 2));
  await browser.close(); if (failures) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });

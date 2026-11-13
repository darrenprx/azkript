/* Actual app editing contracts. IME cases simulate composition events; they
 * do not claim physical OS input-method or screen-reader certification. */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const M = require('../js/model.js');
const root = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(root, 'node_modules/playwright-core'));
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--mute-audio'] });
  let failures = 0;
  async function check(name, paragraphs, run) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    const doc = M.blankDocument(); doc.titlePage.enabled = false; doc.paragraphs = paragraphs;
    try {
      await page.addInitScript(doc => {
        localStorage.setItem('azkript.document.v3', JSON.stringify(doc));
        localStorage.setItem('azkript.prefs.v2', JSON.stringify({ startCenter: false, smartTypeEnabled: false }));
      }, doc);
      await page.goto(pathToFileURL(path.join(root, 'app/index.html')).href);
      await page.waitForFunction(() => !document.querySelector('#appShell').classList.contains('is-loading'));
      await run(page, doc); assert.deepEqual(errors, []); console.log('PASS: ' + name);
    } catch (error) { failures++; console.error('FAIL: ' + name + '\n' + error.stack); }
    finally { await context.close(); }
  }
  const p = (type, text) => M.makeParagraph(type, text);
  const texts = page => page.locator('#editor .para').evaluateAll(els => els.map(el => el.textContent));
  const select = (page, doc, start, end) => page.evaluate(({ start, end }) => {
    if (!FDCoreWriting.restoreSelection(document.querySelector('#editor'), { start, end })) throw new Error('Could not restore selection');
  }, { start: { id: doc.paragraphs[start[0]].id, offset: start[1] }, end: { id: doc.paragraphs[end[0]].id, offset: end[1] } });
  const selectionDoc = () => [p('Action', 'before selection'), p('Dialogue', 'discard line'), p('Action', 'endAFTER'), p('Action', 'untouched')];
  await check('typing replaces a cross-paragraph selection and Undo restores every block', selectionDoc(), async (page, doc) => {
    await select(page, doc, [0, 6], [2, 3]); await page.keyboard.type('X');
    assert.deepEqual(await texts(page), ['beforeXAFTER', 'untouched']);
    await page.keyboard.press('Control+z'); assert.deepEqual(await texts(page), doc.paragraphs.map(M.paragraphText));
  });
  await check('Enter splits a cross-paragraph selection at the insertion point', selectionDoc(), async (page, doc) => {
    await select(page, doc, [0, 2], [2, 3]); await page.keyboard.press('Enter');
    assert.deepEqual(await texts(page), ['be', 'AFTER', 'untouched']);
  });
  await check('Backspace deletes a cross-paragraph selection without changing the suffix', selectionDoc(), async (page, doc) => {
    await select(page, doc, [2, 3], [0, 6]); await page.keyboard.press('Backspace');
    assert.deepEqual(await texts(page), ['beforeAFTER', 'untouched']);
  });
  await check('Delete at a paragraph boundary joins both blocks and preserves the caret', [p('Action', 'first'), p('Action', 'second')], async (page, doc) => {
    await select(page, doc, [0, 5], [0, 5]); await page.keyboard.press('Delete'); await page.keyboard.type('!');
    assert.deepEqual(await texts(page), ['first!second']);
  });
  await check('multilingual typing uses RTL direction and does not split an IME confirmation', [p('Action', '')], async page => {
    const el = page.locator('#editor .para').first(); await el.click();
    await page.keyboard.insertText('مرحبا بالعالم');
    assert.equal(await el.evaluate(el => getComputedStyle(el).direction), 'rtl');
    const before = await page.locator('#editor .para').count();
    await el.evaluate(el => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      el.textContent = '中文候选"';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: '中文候选"' }));
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, isComposing: true, key: 'Enter', keyCode: 229 }));
    });
    assert.equal(await page.locator('#editor .para').count(), before);
    assert.equal(await el.innerText(), '中文候选"', 'candidate text is not rewritten during composition');
    await el.evaluate(el => {
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文候选' }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: false, inputType: 'insertText', data: '中文候选' }));
    });
    await page.keyboard.press('Control+s');
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('azkript.document.v3')).paragraphs[0].html.includes('中文候选')));
  });
  await browser.close(); if (failures) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });

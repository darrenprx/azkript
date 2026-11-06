/* Background-only regressions for real writing and saving workflows. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(root, 'rea/node_modules/playwright-core'));
const url = pathToFileURL(path.join(root, 'app/index.html')).href;
const source = fs.readFileSync(path.join(root, 'app/js/app.js'), 'utf8');

(async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--mute-audio'] });
  let failures = 0;
  async function check(name, run, desktop = false) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await page.addInitScript(({ desktop }) => {
        localStorage.clear();
        localStorage.setItem('azkript.prefs.v2', JSON.stringify({ startCenter: false, smartTypeEnabled: false }));
        if (!desktop) return;
        window.__desktop = { recovery: null, clears: 0, confirmed: 0, cancelled: 0, saves: [] };
        window.azkript = {
          isDesktop: true, platform: 'win32', getInfo: async () => ({ version: 'test' }),
          readRecovery: async () => null, recent: async () => [], touchRecent: async () => true,
          updateState: value => { window.__desktop.state = value; },
          writeRecovery: async value => { window.__desktop.recovery = structuredClone(value); return true; },
          clearRecovery: async () => { window.__desktop.recovery = null; window.__desktop.clears++; },
          onCommand: cb => { window.__command = cb; }, onRequestSave: cb => { window.__requestSave = cb; },
          saveFile: options => new Promise(resolve => {
            window.__desktop.saves.push(options);
            window.__finishSave = () => resolve({ path: 'C:/temporary/draft.fdx', name: 'draft.fdx' });
          }),
          confirmClose: () => { window.__desktop.confirmed++; },
          cancelClose: () => { window.__desktop.cancelled++; },
        };
      }, { desktop });
      await page.goto(url);
      await page.waitForFunction(() => !document.querySelector('#appShell').classList.contains('is-loading'));
      if (desktop) await page.waitForFunction(() => !!window.__command);
      await run(page);
      assert.deepEqual(errors, []);
      console.log('PASS: ' + name);
    } catch (error) { failures++; console.error('FAIL: ' + name + '\n' + error.stack); }
    finally { await context.close(); }
  }
  const action = page => page.locator('.para[data-type="Action"]').first();
  const append = async (page, text) => { await action(page).click(); await page.keyboard.press('End'); await page.keyboard.type(text); };
  const revert = async page => {
    await page.evaluate(() => document.querySelector('[data-ribbon-command="file-revert"]').click());
    await page.locator('#appDialog .btn--danger').click();
    await page.waitForFunction(() => !document.querySelector('#appDialog').open);
  };
  await check('zero-width Unicode search terminates in the actual background worker', async page => {
    await action(page).fill('😀AZKRIPT_ZEROWIDTH_MARKER_93817');
    await page.keyboard.press('Control+f');
    await page.locator('[data-find-option="regex"]').click();
    await page.locator('#findInput').fill('AZKRIPT_ZEROWIDTH_MARKER_93817|(?=.)');
    await page.waitForFunction(() => document.querySelector('#findCount').textContent === '1 result');
    assert.equal(await page.locator('.find-result').count(), 1);
  });
  await check('IME confirmation does not split a paragraph or run shortcuts', async page => {
    const before = await page.locator('.para').count();
    await action(page).click();
    await action(page).evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
    assert.equal(await page.locator('.para').count(), before);
    await action(page).evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true })));
    assert.equal(await page.locator('#commandDialog').evaluate(el => el.open), false);
  });
  await check('Replace one expands regex captures and named groups', async page => {
    await action(page).fill('Alpha Alpha');
    await page.keyboard.press('Control+h');
    await page.locator('[data-find-option="regex"]').click();
    await page.locator('#findInput').fill('(?<word>Alpha)');
    await page.locator('#replaceInput').fill('$<word>/$12/$$');
    await page.locator('#findReplaceOne').click();
    assert.equal(await action(page).innerText(), 'Alpha/Alpha2/$ Alpha');
    await page.locator('#findReplaceAll').click();
    assert.equal(await action(page).innerText(), 'Alpha/Alpha2/$/Alpha/Alpha2/$2/$ Alpha/Alpha2/$');
  });
  await check('a browser import survives reload without an extra edit', async page => {
    await page.locator('#fileInput').setInputFiles(path.join(root, 'examples/sample.fdx'));
    await page.waitForFunction(() => document.querySelector('#docTitle').textContent === 'sample');
    const savedTitle = await page.evaluate(() => JSON.parse(localStorage.getItem('azkript.document.v3')).title);
    assert.equal(savedTitle, 'sample');
    // Remove the setup script on a new page so persisted data can be read as-is.
    const reopened = await page.context().newPage();
    await reopened.goto(url);
    await reopened.waitForFunction(() => !document.querySelector('#appShell').classList.contains('is-loading'));
    assert.equal(await reopened.locator('#docTitle').innerText(), 'sample');
  });
  await check('Revert uses the latest browser autosave', async page => {
    await append(page, ' AUTOSAVED');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('azkript.document.v3')).paragraphs.some(p => p.html.includes('AUTOSAVED')));
    await append(page, ' UNSAVED');
    await revert(page);
    assert.match(await action(page).innerText(), /AUTOSAVED/);
    assert.doesNotMatch(await action(page).innerText(), /UNSAVED/);
  });
  await check('edits during Save remain recoverable and Revert restores bytes actually saved', async page => {
    await append(page, ' SAVED-BEFORE');
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => !!window.__finishSave);
    await append(page, ' EDITED-DURING');
    await page.waitForFunction(() => window.__desktop.recovery?.document.paragraphs.some(p => p.html.includes('EDITED-DURING')));
    await page.evaluate(() => window.__finishSave());
    await page.waitForFunction(() => !document.querySelector('#saveState').classList.contains('is-busy'));
    assert.equal(await page.evaluate(() => window.__desktop.state.dirty), true);
    assert.ok(await page.evaluate(() => window.__desktop.recovery), 'unsaved edits must keep a recovery copy');
    await revert(page);
    assert.match(await action(page).innerText(), /SAVED-BEFORE/);
    assert.doesNotMatch(await action(page).innerText(), /EDITED-DURING/);
  }, true);
  await check('Save on close refuses to discard edits made during the write', async page => {
    await append(page, ' BEFORE-CLOSE');
    await page.evaluate(() => { window.__requestSave(); });
    await page.waitForFunction(() => !!window.__finishSave);
    await append(page, ' AFTER-CLOSE');
    await page.evaluate(() => window.__finishSave());
    await page.waitForFunction(() => !document.querySelector('#saveState').classList.contains('is-busy'));
    assert.equal(await page.evaluate(() => window.__desktop.confirmed), 0);
    assert.equal(await page.evaluate(() => window.__desktop.cancelled), 1);
  }, true);
  await check('the first edit immediately arms the native unsaved-changes guard', async page => {
    const dirty = await action(page).evaluate(el => {
      el.append(' immediate edit');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      return window.__desktop.state.dirty;
    });
    assert.equal(dirty, true);
  }, true);
  await check('a pending Save cannot attach its path to a different document', async page => {
    await append(page, ' SAVE-PENDING');
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => !!window.__finishSave);
    await page.keyboard.press('Control+n');
    assert.equal(await page.locator('#appDialog').evaluate(el => el.open), false);
    assert.equal(await page.locator('#docTitle').innerText(), 'The Last Signal');
    assert.match(await action(page).innerText(), /SAVE-PENDING/);
    await page.evaluate(() => window.__finishSave());
    await page.waitForFunction(() => !document.querySelector('#saveState').classList.contains('is-busy'));
  }, true);
  await check('opening an FDXT creates a new screenplay without overwriting its template', async page => {
    for (const [index, [extension, template]] of [['fdx', true], ['fdxt', false]].entries()) {
      await page.evaluate(async ({ extension, template }) => window.__command({ command: 'open-document', payload: {
        path: `C:/templates/My Template.${extension}`, name: `My Template.${extension}`,
        contents: FDX.serialize(FDModel.sampleDocument(), { template }),
      } }), { extension, template });
      await page.keyboard.press('Control+s');
      await page.waitForFunction(count => window.__desktop.saves.length === count, index + 1);
      assert.equal(await page.evaluate(index => window.__desktop.saves[index].path, index), null);
      await page.evaluate(() => window.__finishSave());
      await page.waitForFunction(() => !document.querySelector('#saveState').classList.contains('is-busy'));
    }
  }, true);
  await check('multiline paste keeps the suffix after the pasted lines', async page => {
    await action(page).fill('beforeAFTER');
    await action(page).evaluate(el => {
      const range = document.createRange(); range.setStart(el.firstChild, 6); range.collapse(true);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
      const data = new DataTransfer(); data.setData('text/plain', 'ONE\nTWO');
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
    const pasted = await action(page).evaluate(el => [el.textContent, el.nextElementSibling.textContent]);
    assert.deepEqual(pasted, ['beforeONE', 'TWOAFTER']);
    await page.keyboard.type('!');
    assert.equal(await action(page).evaluate(el => el.nextElementSibling.textContent), 'TWO!AFTER');
  });
  await check('ribbon Paste updates saved content and undo history', async page => {
    await action(page).fill('before');
    await page.keyboard.press('End');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => ' PASTED' } });
    });
    await page.locator('.ribbon-tab-panel:not([hidden]) [data-ribbon-command="edit-paste"]').click();
    await page.waitForTimeout(150);
    assert.equal(await action(page).innerText(), 'before PASTED');
    await page.keyboard.press('Control+s');
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('azkript.document.v3')).paragraphs.some(p => p.html.includes('PASTED'))));
    await page.keyboard.press('Control+z');
    assert.doesNotMatch(await action(page).innerText(), /PASTED/);
  });
  await browser.close();
  if (failures) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });

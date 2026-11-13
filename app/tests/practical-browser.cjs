/* User-facing interchange, history and cancellable-search regressions. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(root, 'node_modules/playwright-core'));
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--mute-audio'] });
  let failures = 0;
  async function check(name, run) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.addInitScript(() => localStorage.setItem('azkript.prefs.v2', JSON.stringify({ startCenter: false, smartTypeEnabled: false })));
      await page.goto(pathToFileURL(path.join(root, 'app/index.html')).href);
      await page.waitForFunction(() => !document.querySelector('#appShell').classList.contains('is-loading'));
      await run(page); assert.deepEqual(errors, []); console.log('PASS: ' + name);
    } catch (error) { failures++; console.error('FAIL: ' + name + '\n' + error.stack); }
    finally { await context.close(); }
  }
  const command = async (page, id) => {
    await page.locator('[data-ribbon-tab="file"]').click();
    await page.locator(`.ribbon-tab-panel:not([hidden]) [data-ribbon-command="${id}"]`).click();
  };
  const close = async page => { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#appDialog').open); };
  const action = page => page.locator('#editor .para[data-type="Action"]').first();
  await check('actual import/edit/save retains custom types, rich runs, unknown XML and identity', async page => {
    await page.locator('#fileInput').setInputFiles(path.join(root, 'app/tests/fixtures/interchange-native.fdx'));
    await page.locator('#editor .para[data-type="Lyrics"]').waitFor();
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('azkript.document.v3')));
    await action(page).click(); await page.keyboard.press('End'); await page.keyboard.type(' Edited in the real editor.');
    await page.keyboard.press('Control+s');
    const result = await page.evaluate(() => {
      const doc = JSON.parse(localStorage.getItem('azkript.document.v3'));
      const tree = new DOMParser().parseFromString(FDX.serialize(doc), 'application/xml');
      return { id: doc.documentId, lyrics: tree.querySelector('Paragraph[Type="Lyrics"]')?.textContent,
        future: tree.querySelector('FutureVendorSection')?.textContent,
        hasWrapper: !!tree.querySelector('Paragraph[VendorDualWrapper="keep"]'),
        action: tree.querySelector('Paragraph[id="80a0f705-c578-4d11-9900-a267e82ae4da"]')?.textContent,
        run: tree.querySelector('Paragraph[Type="Lyrics"] Text')?.getAttribute('future:Flag') };
    });
    assert.equal(result.id, before.documentId); assert.match(result.lyrics, /中文/);
    assert.ok(result.future); assert.equal(result.hasWrapper, true); assert.equal(result.run, 'keep');
    assert.match(result.action, /Edited in the real editor/);
    await command(page, 'file-compatibility');
    assert.match(await page.locator('#appDialog').innerText(), /Original vendor data|original XML|source XML/i);
    await fs.mkdir(path.join(root, 'reports/practical-upgrade'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'reports/practical-upgrade/compatibility.png') });
  });
  await check('browser version history compares and restores while retaining the previous draft', async page => {
    await action(page).click(); await page.keyboard.press('End'); await page.keyboard.type(' FIRST-VERSION');
    await command(page, 'file-history'); await page.locator('#snapshotLabel').fill('Before revision');
    await page.getByRole('button', { name: 'Save snapshot', exact: true }).click();
    await page.locator('.history-version:has-text("Before revision")').waitFor(); await close(page);
    await action(page).click(); await page.keyboard.press('End'); await page.keyboard.type(' SECOND-VERSION');
    await page.keyboard.press('Control+s');
    await command(page, 'file-history'); await page.locator('.history-version:has-text("Before revision")').click();
    await page.locator('.text-diff summary').first().click();
    assert.match(await page.locator('.text-diff').innerText(), /SECOND-VERSION/);
    await page.getByRole('button', { name: 'Restore this version', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#appDialog').open);
    assert.match(await action(page).innerText(), /FIRST-VERSION/); assert.doesNotMatch(await action(page).innerText(), /SECOND-VERSION/);
    const priorDraft = await page.evaluate(async () => {
      const store = new FDWritingTools.BrowserBackups();
      const current = JSON.parse(localStorage.getItem('azkript.document.v3'));
      const versions = await store.list(FDWritingTools.backupKey(current));
      const previous = versions.find(version => version.label === 'Before restoring a version');
      return previous ? JSON.stringify((await store.read(previous.id)).document) : '';
    });
    assert.match(priorDraft, /SECOND-VERSION/);
    const retained = await page.evaluate(async () => {
      const backups = new FDWritingTools.BrowserBackups({ retention: 3 });
      const doc = FDModel.blankDocument();
      for (let index = 0; index < 5; index++) { doc.paragraphs[0].html = String(index); await backups.create(doc); }
      return (await backups.list(FDWritingTools.backupKey(doc))).length;
    });
    assert.equal(retained, 3);
  });
  await check('real Find times out expensive regex, stays responsive and recovers', async page => {
    await action(page).fill('a'.repeat(4000) + '!');
    await page.keyboard.press('Control+f'); await page.locator('[data-find-option="regex"]').click();
    await page.evaluate(() => { window.__heartbeat = 0; window.__ticker = setInterval(() => window.__heartbeat++, 20); });
    await page.locator('#findInput').fill('(a+)+$');
    await page.waitForFunction(() => document.querySelector('#findCount').textContent === 'Search timed out', null, { timeout: 10000 });
    assert.ok(await page.evaluate(() => window.__heartbeat > 10));
    await page.locator('#findInput').fill('a!$');
    await page.waitForFunction(() => document.querySelector('#findCount').textContent === '1 result');
    await page.locator('#findInput').fill('(a+)+$');
    await page.locator('#cancelBackgroundSearch').click();
    assert.equal(await page.locator('#findCount').innerText(), 'Search cancelled');
    await page.evaluate(() => clearInterval(window.__ticker));
  });
  await browser.close(); if (failures) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });

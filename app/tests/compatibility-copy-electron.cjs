/* A risky imported production document defaults to a separate file. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const { _electron } = require(path.join(root, 'node_modules/playwright-core'));
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'azkript-compat-copy-'));
  const original = path.join(temp, 'Production Draft.fdx'), copy = path.join(temp, 'Production Draft copy.fdx');
  const contents = await fs.readFile(path.join(root, 'app/tests/fixtures/interchange-native.fdx'), 'utf8');
  await fs.writeFile(original, contents);
  const env = { ...process.env, AZKRIPT_USER_DATA: path.join(temp, 'profile'), AZKRIPT_TEST_BACKGROUND: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
      args: ['.', '--mute-audio', '--disable-renderer-backgrounding'], cwd: root, env });
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => document.querySelector('#startCenter')?.open);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    await page.locator('#startContinue').click(); await page.waitForFunction(() => !document.querySelector('#startCenter').open);
    await app.evaluate(({ dialog }, original) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [original] });
      global.__copyPickerCount = 0;
      dialog.showSaveDialog = async () => { global.__copyPickerCount++; return { canceled: false, filePath: original }; };
    }, original);
    await page.locator('#openButton').click();
    await page.locator('.para[data-type="Lyrics"]').waitFor();
    await page.locator('.para[data-type="Lyrics"]').click(); await page.keyboard.press('End');
    await page.locator('[data-ribbon-tab="edit"]').click();
    await page.locator('.ribbon-tab-panel:not([hidden]) [data-ribbon-command="edit-delete"]').click();
    assert.equal(await page.locator('.para[data-type="Lyrics"]').count(), 0);
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => document.querySelector('#appDialog')?.open && document.querySelector('#dialogTitle')?.textContent === 'Compatibility review');
    assert.equal(await fs.readFile(original, 'utf8'), contents);
    assert.equal(await app.evaluate(() => global.__copyPickerCount), 1);
    await page.locator('#appDialog .btn--primary').click(); await page.waitForFunction(() => !document.querySelector('#appDialog').open);
    await app.evaluate(({ dialog }, copy) => {
      dialog.showSaveDialog = async () => { global.__copyPickerCount++; return { canceled: false, filePath: copy }; };
    }, copy);
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => !document.body.classList.contains('is-dirty') && !document.querySelector('#saveState').classList.contains('is-busy'));
    assert.equal(await app.evaluate(() => global.__copyPickerCount), 2);
    const action = page.locator('.para[data-type="Action"]').first();
    await action.click(); await page.keyboard.press('End'); await page.keyboard.type(' EDIT-AFTER-COPY');
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => !document.body.classList.contains('is-dirty') && !document.querySelector('#saveState').classList.contains('is-busy'));
    assert.equal(await app.evaluate(() => global.__copyPickerCount), 2, 'later saves stay in the chosen working copy');
    assert.equal(await fs.readFile(original, 'utf8'), contents);
    assert.match(await fs.readFile(copy, 'utf8'), /EDIT-AFTER-COPY/);
    assert.deepEqual(errors, []);
    console.log('PASS: risky compatibility edits cannot overwrite the source and subsequent saves use the working copy');
  } finally {
    if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await app.close().catch(() => {}); }
    await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

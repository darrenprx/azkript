/* Verify the actual privileged bridge with separate hidden windows. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');
const root = path.resolve(__dirname, '../..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'azkript-security-'));
  const env = { ...process.env, AZKRIPT_USER_DATA: path.join(temp, 'profile'), AZKRIPT_TEST_BACKGROUND: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({ executablePath: process.env.AZKRIPT_TEST_EXECUTABLE || require('electron'), args: [...(process.env.AZKRIPT_TEST_EXECUTABLE ? [] : ['.']), '--mute-audio', '--use-fake-device-for-media-stream'], cwd: root, env });
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.azkript) && document.querySelector('#quickSearchButton'));
    const info = await page.evaluate(() => window.azkript.getInfo());
    assert.equal(info.name, 'Azkript');
    assert.equal(info.electron, require('../../package.json').devDependencies.electron);
    const microphone = await page.evaluate(async () => {
      try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(track => track.stop()); return 'unexpected-grant'; }
      catch (error) { return error.name; }
    });
    assert.equal(microphone, 'NotAllowedError', 'background tests must not grant even a fake microphone');
    const clipboardPermission = await page.evaluate(async () => (await navigator.permissions.query({ name: 'clipboard-read' })).state);
    assert.equal(clipboardPermission, 'granted', 'the editor paste command needs clipboard permission; no clipboard contents are read by this test');
    const appRoot = await app.evaluate(({ app }) => app.getAppPath());
    const denied = await app.evaluate(async ({ BrowserWindow }, options) => {
      const values = [];
      for (const target of ['data:text/html,<p>Untrusted page</p>', options.entry]) {
        const window = new BrowserWindow({ show: false, webPreferences: { preload: options.preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
        try {
          await window.loadURL(target);
          values.push(await window.webContents.executeJavaScript('window.azkript.getInfo().then(() => false, () => true)'));
          await window.webContents.executeJavaScript('window.azkript.confirmClose()');
        } finally { window.destroy(); }
      }
      return values;
    }, { entry: require('node:url').pathToFileURL(path.join(appRoot, 'app/index.html')).href, preload: path.join(appRoot, 'desktop/preload.js') });
    assert.deepEqual(denied, [true, true]);
    assert.equal((await page.evaluate(() => window.azkript.getInfo())).name, 'Azkript', 'an untrusted close notification cannot close the editor');
    await page.locator('#startCenterClose').click();
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === 'Edit').submenu.items.find(item => item.label === 'Search Everything…').click());
    await page.locator('#unifiedQuery').waitFor();
    await page.locator('#dialogActions').getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#appDialog').open);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === 'Help').submenu.items.find(item => item.label === 'Open Documentation').click());
    await page.waitForFunction(() => document.querySelector('#appDialog').open);
    assert.match(await page.locator('#appDialog').innerText(), /Using Azkript/);
    assert.match(await page.locator('#appDialog').innerText(), /Share a copy/);
    await page.locator('#dialogActions').getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#appDialog').open);
    await page.locator('[data-ribbon-tab="help"]').click();
    await page.locator('[data-ribbon-command="help-updates"]').click();
    assert.match(await page.locator('#appDialog').innerText(), /Manual packages/);
    assert.doesNotMatch(await page.locator('#appDialog').innerText(), /Up to date/);
    await page.locator('#dialogActions').getByRole('button', { name: 'Done', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#appDialog').open);
    await app.evaluate(({ app, shell }) => { app.testExternalUrls = []; shell.openExternal = async url => { app.testExternalUrls.push(url); }; });
    await page.locator('[data-ribbon-command="help-feedback"]').click();
    await page.getByRole('button', { name: 'Open issue tracker', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#appDialog').open);
    assert.deepEqual(await app.evaluate(({ app }) => app.testExternalUrls), ['https://github.com/darrenprx/azkript/issues/new/choose']);
    const preferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false);
    assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => window.isVisible())), [false]);
    await fs.mkdir(path.join(root, 'reports/public-readiness'), { recursive: true });
    await fs.writeFile(path.join(root, 'reports/public-readiness/security-desktop.json'), JSON.stringify({ passed: true, runtime: info.electron, foreignWindowsDenied: denied.length, microphoneDenied: true, clipboardPermissionGranted: true, clipboardContentsRead: false, sandbox: true, hidden: true, helpAndSearch: true, updateAndFeedback: true }, null, 2));
    console.log('PASS: real IPC rejects foreign windows, retains the hidden sandbox, and routes Help and Search correctly.');
  } finally {
    if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

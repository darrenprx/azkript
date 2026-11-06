/* Verify that even cancellation/crash paths in background mode cannot open
 * native desktop UI. This is process/profile isolation, not an OS sandbox. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '../..');
const { _electron } = require(path.join(root, 'rea/node_modules/playwright-core'));
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'azkript-background-guard-'));
  const env = { ...process.env, AZKRIPT_USER_DATA: path.join(temp, 'profile'), AZKRIPT_TEST_BACKGROUND: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({ executablePath: process.env.AZKRIPT_TEST_EXECUTABLE || path.join(root, 'node_modules/electron/dist/electron.exe'),
      args: [...(process.env.AZKRIPT_TEST_EXECUTABLE ? [] : ['.']), ...(process.env.AZKRIPT_TEST_DISABLE_GPU === '1' ? ['--disable-gpu'] : []), '--mute-audio'], cwd: root, env });
    const page = await app.firstWindow();
    await page.waitForFunction(() => !document.querySelector('#appShell').classList.contains('is-loading'));
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isVisible())), false);
    const results = await app.evaluate(async ({ dialog, BrowserWindow }) => ({
      open: await dialog.showOpenDialog(BrowserWindow.getAllWindows()[0], {}),
      save: await dialog.showSaveDialog(BrowserWindow.getAllWindows()[0], {}),
      message: await dialog.showMessageBox(BrowserWindow.getAllWindows()[0], { title: 'Background cancellation guard', buttons: ['Save', 'Discard', 'Cancel'], cancelId: 2 }),
      print: await new Promise(resolve => BrowserWindow.getAllWindows()[0].webContents.print({}, (success, reason) => resolve({ success, reason }))),
    }));
    assert.equal(results.open.canceled, true); assert.equal(results.save.canceled, true);
    assert.equal(results.message.response, 2); assert.equal(results.print.success, false);
    const marker = await page.evaluate(async () => {
      const payload = { document: FDModel.sampleDocument(), dirty: true, filePath: null };
      await window.azkript.writeRecovery(payload); return window.azkript.readRecovery();
    });
    assert.ok(marker?.document, 'recovery should exist before simulating a renderer crash');
    const exited = new Promise(resolve => app.process().once('exit', code => resolve(code)));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer()).catch(() => {});
    const timeout = setTimeout(() => { app.process().kill(); }, 15000);
    let exitCode;
    try { exitCode = await exited; } finally { clearTimeout(timeout); }
    assert.equal(exitCode, 1, 'a renderer crash must fail the background run without a native error dialog');
    const recovery = JSON.parse(await fs.readFile(path.join(temp, 'profile', 'recovery', 'session.json'), 'utf8'));
    assert.ok(recovery.document, 'crash handling must retain the recovery draft');
    app = null;
    console.log('PASS: hidden native picker/close/print guards and real renderer crash recovery');
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

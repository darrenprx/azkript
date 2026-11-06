/* Hidden integration test for the real preload/main file-safety contract. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require(path.join(__dirname, "../../rea/node_modules/playwright-core"));
const root = path.resolve(__dirname, "../..");

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "azkript-file-safety-e2e-"));
  const file = path.join(temp, "File Safety.fdx");
  const env = { ...process.env, AZKRIPT_USER_DATA: path.join(temp, "profile"), AZKRIPT_TEST_BACKGROUND: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"),
      args: [".", "--mute-audio", "--disable-renderer-backgrounding"], cwd: root, env });
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.azkript?.listBackups));
    await page.waitForFunction(() => document.querySelector("#appShell") && !document.querySelector("#appShell").classList.contains("is-loading"));
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    const initialWidth = await page.evaluate(() => innerWidth);
    assert.equal(await page.evaluate(() => window.azkript.setInterfaceScale(2)), 2);
    await page.waitForFunction(width => innerWidth <= Math.ceil(width / 2) + 1, initialWidth);
    assert.equal(await page.evaluate(async () => (await window.azkript.getInfo()).interfaceScale), 2);
    assert.equal(await page.evaluate(() => window.azkript.setInterfaceScale(1)), 1);
    await page.waitForFunction(width => Math.abs(innerWidth - width) <= 1, initialWidth);
    assert.equal(await page.evaluate(async () => {
      try { await window.azkript.setInterfaceScale(5); return false; } catch { return true; }
    }), true, "only supported app-local scale factors are accepted");

    await fs.writeFile(file, "first");
    const first = await page.evaluate(file => window.azkript.readFile(file), file);
    assert.match(first.identity, /^[a-f0-9]{64}$/);
    await fs.writeFile(file, "external edit");
    const conflict = await page.evaluate(({ file, identity }) => window.azkript.saveFile({ path: file,
      expectedIdentity: identity, contents: "should not overwrite", documentId: "test-document" }), { file, identity: first.identity });
    assert.equal(conflict.conflict, true);
    assert.equal(await fs.readFile(file, "utf8"), "external edit");

    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, file);
    const samePath = await page.evaluate(({ file, identity }) => window.azkript.saveFile({ path: null, saveAs: true,
      expectedPath: file, expectedIdentity: identity, contents: "must not bypass conflict through Save As" }), { file, identity: first.identity });
    assert.equal(samePath.conflict, true);
    assert.equal(await fs.readFile(file, "utf8"), "external edit");
    const protectedOriginal = await page.evaluate(file => window.azkript.saveFile({ path: file,
      protectedSourcePath: file, contents: "must remain a separate compatibility copy" }), file);
    assert.equal(protectedOriginal.copyRequired, true);
    assert.equal(await fs.readFile(file, "utf8"), "external edit");
    const copy = path.join(temp, "Safe Copy.fdx");
    await app.evaluate(({ dialog }, copy) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: copy });
    }, copy);
    const copied = await page.evaluate(({ file, identity }) => window.azkript.saveFile({ path: null, saveAs: true,
      expectedPath: file, expectedIdentity: identity, contents: "my separate copy" }), { file, identity: first.identity });
    assert.equal(copied.canceled, false);
    assert.equal(await fs.readFile(copy, "utf8"), "my separate copy");
    assert.equal(await fs.readFile(file, "utf8"), "external edit");

    const saved = await page.evaluate(({ file, identity }) => window.azkript.saveFile({ path: file,
      expectedIdentity: identity, contents: "saved edit", documentId: "test-document", defaultName: "File Safety" }),
    { file, identity: conflict.currentIdentity });
    assert.equal(saved.canceled, false);
    assert.notEqual(saved.identity, first.identity);
    const history = await page.evaluate(file => window.azkript.listBackups({ filePath: file }), file);
    assert.equal(history.length, 1);
    const archived = await page.evaluate(id => window.azkript.readBackup(id), history[0].id);
    assert.equal(archived.contents, "external edit");

    // Simulate another editor writing after our temporary file was staged.
    // The final check must protect that late edit as well as early conflicts.
    await app.evaluate((_electron, target) => {
      const io = process.getBuiltinModule("fs/promises");
      const basename = process.getBuiltinModule("path").basename;
      global.__safetyOriginalOpen = io.open;
      io.open = async function(file, flags, ...rest) {
        const handle = await global.__safetyOriginalOpen.call(io, file, flags, ...rest);
        if (flags === "wx" && basename(String(file)).startsWith(`.${basename(target)}.`)) {
          const write = handle.writeFile.bind(handle);
          handle.writeFile = async (...args) => {
            const result = await write(...args);
            await io.writeFile(target, "late external edit");
            return result;
          };
        }
        return handle;
      };
    }, file);
    let lateConflict;
    try {
      lateConflict = await page.evaluate(({ file, identity }) => window.azkript.saveFile({ path: file,
        expectedIdentity: identity, contents: "staged new contents", documentId: "test-document" }), { file, identity: saved.identity });
    } finally {
      await app.evaluate(() => { process.getBuiltinModule("fs/promises").open = global.__safetyOriginalOpen; delete global.__safetyOriginalOpen; });
    }
    assert.equal(lateConflict.conflict, true);
    assert.equal(await fs.readFile(file, "utf8"), "late external edit");

    const snapshot = { documentId: "test-document", filePath: file, title: "File Safety", document: {
      id: "test-document", title: "File Safety", paragraphs: [{ id: "p1", type: "Action", html: "unsaved draft" }],
    } };
    const backup = await page.evaluate(payload => window.azkript.createBackup(payload), snapshot);
    const again = await page.evaluate(payload => window.azkript.createBackup({ ...payload,
      document: { ...payload.document, updatedAt: new Date().toISOString() } }), snapshot);
    assert.equal(backup.id, again.id);
    const restored = await page.evaluate(id => window.azkript.readBackup(id), backup.id);
    assert.equal(restored.document.paragraphs[0].html, "unsaved draft");
    await page.evaluate(({ snapshot, identity }) => window.azkript.writeRecovery({ ...snapshot, identity }),
      { snapshot, identity: lateConflict.currentIdentity });
    assert.equal(await page.evaluate(async () => (await window.azkript.readRecovery()).identity), lateConflict.currentIdentity);
    await page.evaluate(snapshot => window.azkript.writeRecovery(snapshot), snapshot);
    assert.equal(await page.evaluate(async () => (await window.azkript.readRecovery()).identity), null, "legacy recovery has an explicit unknown identity");
    await page.evaluate(() => window.azkript.clearRecovery());

    await page.evaluate(({ file, identity }) => {
      window.__fileEvents = [];
      window.__unsubscribeFiles = window.azkript.onFileChanged(event => window.__fileEvents.push(event));
      return window.azkript.watchFile({ path: file, identity });
    }, { file, identity: lateConflict.currentIdentity });
    await fs.writeFile(file, "watched external edit");
    await page.waitForFunction(() => window.__fileEvents.some(event => event.identity && !event.error), null, { timeout: 6000 });
    const external = await page.evaluate(() => window.__fileEvents.at(-1));
    assert.notEqual(external.identity, lateConflict.currentIdentity);
    const live = await page.evaluate(file => window.azkript.getFileIdentity(file), file);
    assert.equal(live.identity, external.identity);
    await page.evaluate(() => { window.__unsubscribeFiles(); return window.azkript.unwatchFile(); });

    await fs.rm(file);
    const missing = await page.evaluate(({ file, identity }) => window.azkript.saveFile({ path: file,
      expectedIdentity: identity, contents: "must not silently recreate" }), { file, identity: live.identity });
    assert.equal(missing.conflict, true);
    assert.equal(missing.missing, true);
    console.log("PASS: hidden main/preload conflict, backup, snapshot, watch and missing-file workflows");
  } finally {
    if (app) await app.close().catch(() => {});
    await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

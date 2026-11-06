/* User-facing history/conflict flows against a hidden real Electron stack. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require(path.join(__dirname, "../../rea/node_modules/playwright-core"));
const root = path.resolve(__dirname, "../..");

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "azkript-safety-ui-"));
  const file = path.join(temp, "Safety Draft.fdx"), copy = path.join(temp, "Safe Copy.fdx");
  const original = await fs.readFile(path.join(root, "examples/sample.fdx"), "utf8");
  await fs.writeFile(file, original);
  const env = { ...process.env, AZKRIPT_USER_DATA: path.join(temp, "profile"), AZKRIPT_TEST_BACKGROUND: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"),
      args: [".", "--mute-audio", "--disable-renderer-backgrounding"], cwd: root, env });
    const page = await app.firstWindow(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.waitForFunction(() => document.querySelector("#appShell") && !document.querySelector("#appShell").classList.contains("is-loading"));
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    await page.waitForFunction(() => document.querySelector("#startCenter").open);
    await page.locator("#startContinue").click();
    await page.waitForFunction(() => !document.querySelector("#startCenter").open);
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
    await page.locator("#openButton").click();
    await page.waitForFunction(() => document.querySelector("#docTitle").textContent === "Safety Draft");
    const action = () => page.locator('.para[data-type="Action"]').first();
    const append = async text => { await action().click(); await page.keyboard.press("End"); await page.keyboard.type(text); };
    const fileCommand = async command => {
      await page.locator('[data-ribbon-tab="file"]').click();
      await page.locator(`.ribbon-tab-panel:not([hidden]) [data-ribbon-command="${command}"]`).click();
    };
    const closeDialog = async () => { await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector("#appDialog").open); };

    await append(" SNAPSHOT-TEXT");
    await fileCommand("file-history");
    await page.locator("#snapshotLabel").fill("Before rewrite");
    await page.locator("#appDialog").getByRole("button", { name: "Save snapshot", exact: true }).click();
    await page.locator('.history-version:has-text("Before rewrite")').waitFor();
    await closeDialog();
    await append(" LATER-UNSAVED");
    await fileCommand("file-history");
    await page.locator('.history-version:has-text("Before rewrite")').click();
    assert.match(await page.locator(".text-diff").innerText(), /changed/);
    await page.locator("#appDialog").getByRole("button", { name: "Restore this version", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#appDialog").open);
    assert.match(await action().innerText(), /SNAPSHOT-TEXT/);
    assert.doesNotMatch(await action().innerText(), /LATER-UNSAVED/);
    assert.equal(await fs.readFile(file, "utf8"), original, "restore must not overwrite disk before Save");
    assert.equal(await page.evaluate(() => document.body.classList.contains("is-dirty")), true);

    await fileCommand("file-revert");
    await page.locator("#appDialog").getByRole("button", { name: "Revert", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#appDialog").open);
    assert.doesNotMatch(await action().innerText(), /SNAPSHOT-TEXT|LATER-UNSAVED/,
      "Revert after restore must use the actual saved disk version");
    console.log("PASS: version history snapshot/compare/restore/Revert");

    await append(" LOCAL-ONLY");
    const external = original.replace("Wind pulls", "EXTERNAL VERSION Wind pulls");
    assert.notEqual(external, original);
    await fs.writeFile(file, external);
    await page.locator("#externalChangeBanner").waitFor({ state: "visible", timeout: 6000 });
    await page.locator("#saveButton").click();
    await page.waitForFunction(() => document.querySelector("#appDialog").open && document.querySelector("#dialogTitle").textContent === "Compare disk changes");
    assert.equal(await fs.readFile(file, "utf8"), external);

    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, file);
    await page.locator("#appDialog").getByRole("button", { name: "Save a copy", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#appDialog").open && document.querySelector("#dialogTitle").textContent === "Compare disk changes");
    assert.equal(await fs.readFile(file, "utf8"), external, "same-path Save As must not bypass the conflict");
    await app.evaluate(({ dialog }, copy) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: copy }); }, copy);
    await page.locator("#appDialog").getByRole("button", { name: "Save a copy", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#saveState").classList.contains("is-busy") && !document.body.classList.contains("is-dirty"));
    const copied = await fs.readFile(copy, "utf8");
    assert.match(copied, /LOCAL-ONLY/);
    assert.equal(await fs.readFile(file, "utf8"), external);
    console.log("PASS: external-change banner, same-target conflict and separate-copy save");

    await fs.writeFile(copy, copied.replace("LOCAL-ONLY", "DISK-RELOAD"));
    await page.locator("#externalChangeBanner").waitFor({ state: "visible", timeout: 6000 });
    await page.locator("#reviewExternalChange").click();
    await page.locator("#appDialog").getByRole("button", { name: "Reload disk version", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#appDialog").open);
    assert.match(await action().innerText(), /DISK-RELOAD/);
    assert.doesNotMatch(await action().innerText(), /LOCAL-ONLY/);
    assert.equal(await page.evaluate(() => document.body.classList.contains("is-dirty")), false);
    const versions = await page.evaluate(copy => window.azkript.listBackups({ filePath: copy }), copy);
    assert.ok(versions.some(version => version.label === "Before reloading from disk"));
    assert.deepEqual(errors, []);
    console.log("PASS: protected reload with pre-reload snapshot");

    const validBeforeMalformedReload = await fs.readFile(copy, "utf8");
    await fileCommand("file-disk-status");
    await page.waitForFunction(() => document.querySelector("#appDialog").open && document.querySelector("#dialogTitle").textContent === "File is up to date");
    // The compared file can become invalid before the user clicks Reload.
    await fs.writeFile(copy, "<FinalDraft><Content>");
    await page.locator("#appDialog").getByRole("button", { name: "Reload disk version", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#appDialog").open && document.querySelector("#dialogTitle").textContent === "That file could not be read");
    await page.waitForTimeout(250);
    assert.equal(await page.locator("#appDialog").evaluate(dialog => dialog.open), true, "the reload action must not close the replacement import-error dialog");
    assert.match(await action().innerText(), /DISK-RELOAD/, "failed reload must retain the current draft");
    await closeDialog();
    await page.locator("#externalChangeBanner").waitFor({ state: "visible", timeout: 6000 });
    await fs.writeFile(copy, validBeforeMalformedReload);
    await page.waitForFunction(() => document.querySelector("#externalChangeBanner").hidden, null, { timeout: 6000 });
    console.log("PASS: malformed reload preserves draft/error dialog; returning disk bytes clears stale banner");

    // Recovery must retain the last-known disk identity across a restart.
    // An older recovery file without identity is conservatively unknown.
    const recovery = await page.evaluate(async copy => {
      const disk = await window.azkript.readFile(copy), document = FDX.parse(disk.contents);
      document.paragraphs.find(p => p.type === "Action").html += " RECOVERED-LOCAL";
      return { version: 1, title: document.title, filePath: copy, identity: disk.identity,
        document, updatedAt: new Date().toISOString() };
    }, copy);
    const afterCrash = (await fs.readFile(copy, "utf8")).replace("DISK-RELOAD", "EXTERNAL-AFTER-CRASH");
    await fs.writeFile(copy, afterCrash);
    for (const legacy of [false, true]) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()));
      await app.close(); app = null;
      const recoveryFile = path.join(temp, "profile/recovery/session.json");
      await fs.mkdir(path.dirname(recoveryFile), { recursive: true });
      const fixture = { ...recovery }; if (legacy) delete fixture.identity;
      await fs.writeFile(recoveryFile, JSON.stringify(fixture));
      app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"),
        args: [".", "--mute-audio", "--disable-renderer-backgrounding"], cwd: root, env });
      const recoveredPage = await app.firstWindow();
      await recoveredPage.waitForFunction(() => document.querySelector("#startCenter")?.open === true);
      await recoveredPage.locator("#recoveryRestore").click();
      await recoveredPage.waitForFunction(() => !document.querySelector("#startCenter").open);
      assert.match(await recoveredPage.locator('.para[data-type="Action"]').first().innerText(), /RECOVERED-LOCAL/);
      await recoveredPage.keyboard.press("Control+s");
      await recoveredPage.waitForFunction(() => document.querySelector("#appDialog").open && document.querySelector("#dialogTitle").textContent === "Compare disk changes");
      assert.equal(await fs.readFile(copy, "utf8"), afterCrash, `${legacy ? "legacy" : "identified"} recovery must not overwrite a newer disk version`);
      console.log(`PASS: ${legacy ? "legacy" : "identified"} recovery preserves externally changed disk bytes`);
    }
    console.log("PASS: hidden renderer history/restore/Revert, conflict/save-copy/reload, and current/legacy recovery safety workflows");
  } finally {
    if (app) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
      await app.close().catch(() => {});
    }
    await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

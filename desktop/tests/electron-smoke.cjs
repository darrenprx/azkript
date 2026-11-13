/* End-to-end desktop smoke test for Azkript.
 *
 * Launches the real Electron main/preload/renderer stack with an isolated
 * userData directory, exercises open/save/PDF/menu/window paths, and verifies
 * the shipped files. Native file and save pickers are replaced with explicit
 * test paths so no human interaction is required.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require(path.join(__dirname, "..", "..", "node_modules", "playwright-core"));

const root = path.resolve(__dirname, "..", "..");
const electronPath = process.env.AZKRIPT_TEST_EXECUTABLE || path.join(root, "node_modules", "electron", "dist", "electron.exe");
const appArgs = process.env.AZKRIPT_TEST_EXECUTABLE ? [] : [process.env.AZKRIPT_TEST_APP || "."];
const sourceSample = path.join(root, "examples", "sample.fdx");

(async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "azkript-e2e-"));
  const userData = path.join(temp, "userdata");
  const documentPath = path.join(temp, "First Draft.fdx");
  const pdfPath = path.join(temp, "First Draft.pdf");
  const env = { ...process.env, AZKRIPT_USER_DATA: userData, AZKRIPT_TEST_BACKGROUND: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  await fsp.mkdir(userData, { recursive: true });
  await fsp.copyFile(sourceSample, documentPath);
  let app;
  try {
    app = await _electron.launch({
      executablePath: electronPath,
      args: [...appArgs, ...(process.env.AZKRIPT_TEST_DISABLE_GPU === '1' ? ['--disable-gpu'] : []), "--mute-audio", "--disable-renderer-backgrounding"],
      cwd: root,
      env,
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    /* Wait for the real startup condition instead of a fixed sleep: the window
     * is shown on `ready-to-show`, and the Start Center opens once the renderer
     * finishes booting. Both take longer on a cold start or a loaded machine. */
    await page
      .waitForFunction(() => document.getElementById("startCenter")?.open === true, null, { timeout: 15000 })
      .catch(() => {});
    await app
      .evaluate(
        ({ BrowserWindow }) =>
          new Promise((resolve) => {
            const window = BrowserWindow.getAllWindows()[0];
            if (!window || process.env.AZKRIPT_TEST_BACKGROUND === "1" || window.isVisible()) return resolve();
            window.once("show", () => resolve());
            setTimeout(resolve, 5000);
          }),
      )
      .catch(() => {});

    const windows = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        visible: window.isVisible(),
        title: window.getTitle(),
        bounds: window.getBounds(),
      })),
    );
    assert.equal(windows.length, 1);
    assert.equal(windows[0].visible, false, "automation must never show a window or steal focus");
    assert.ok(windows[0].bounds.width >= 1080);
    assert.equal(await page.title(), "The Last Signal — Azkript");
    assert.equal(await page.locator("#startCenter").evaluate((el) => el.open), true, "Start Center opens on first launch");
    assert.equal(await page.locator(".template-card").count(), 4);
    assert.equal(await page.locator("#startCenterTitle").innerText(), "Every story begins\nwith a blank page.");

    /* The Start Center is a full-screen modal, so its close button is the only
     * pointer exit. It regressed twice: a window drag-region on the header ate
     * the click, and an interrupted close animation latched `is-closing`, which
     * made every later close a no-op on an invisible panel. Exercise a real
     * pointer click, repeatedly, plus the stranded-state recovery. */
    await page
      .waitForFunction(() => document.querySelector(".start-center")?.getBoundingClientRect().width > 100, null, {
        timeout: 5000,
      })
      .catch(() => {});

    /* SETTLE THE ENTRANCE ANIMATION BEFORE MEASURING, or this assertion races it.
     *
     * `.start-center` animates in with
     *     @keyframes startPanelIn { from { scale(0.97) } to { scale(1) } }  (420ms, fill: both)
     * and while that animation sits at its first keyframe the WHOLE panel paints 3%
     * small, so the fixed 40x40 close button has a bounding box of 38.8px. That is
     * below the >= 39px threshold below and produces
     *     "close control needs a real hit target"
     * for a control that is actually 40px — a false failure about animation timing,
     * not about the hit target. It was observed failing intermittently on this
     * machine, and instrumenting the exact sequence showed every failing sample had
     *     transform = matrix(0.97, 0, 0, 0.97, 0, 22)   (the first keyframe)
     * while the computed width was still the correct "40px".
     *
     * Waiting a fixed 420ms is NOT a fix: Chromium throttles animations on an
     * occluded window, so the animation can remain at its first keyframe for as long
     * as the window is not being composited. Finishing the running animations is
     * deterministic and leaves the panel in exactly the state a user interacts with
     * once it has appeared. */
    await page.evaluate(() => {
      for (const element of document.querySelectorAll(".start-center, .start-center-dialog")) {
        for (const animation of element.getAnimations?.() ?? []) {
          try {
            animation.finish();
          } catch {
            /* an animation that cannot finish (infinite/paused) is not the entrance */
          }
        }
      }
    });

    /* Assert the DESIGNED hit target from the layout box, which cannot be distorted
     * by an ancestor transform, and separately assert the painted box once the
     * entrance has settled. The first catches a genuinely small control; the second
     * catches a transform that permanently shrinks it. Measuring only the painted
     * box during an animation was the source of the flakiness. */
    const closeTarget = await page.locator("#startCenterClose").evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        layoutWidth: el.offsetWidth,
        layoutHeight: el.offsetHeight,
        paintedWidth: rect.width,
        paintedHeight: rect.height,
      };
    });
    assert.ok(
      closeTarget.layoutWidth >= 39 && closeTarget.layoutHeight >= 39,
      `close control needs a real hit target: layout box is ` +
        `${closeTarget.layoutWidth}x${closeTarget.layoutHeight}px, expected at least 39x39`,
    );
    assert.ok(
      closeTarget.paintedWidth >= 39 && closeTarget.paintedHeight >= 39,
      `close control paints smaller than its layout box even after the entrance settled: ` +
        `${closeTarget.paintedWidth.toFixed(2)}x${closeTarget.paintedHeight.toFixed(2)}px ` +
        `for a ${closeTarget.layoutWidth}x${closeTarget.layoutHeight}px control`,
    );
    /* Window drag regions are an OS-level concept: Playwright's synthetic mouse
     * events bypass them, so no click test can catch a regression here. Assert
     * the invariant directly — the header that hosts the close button must not
     * be a drag region, or real users lose clicks on it. */
    const headerRegion = await page.evaluate(() =>
      getComputedStyle(document.querySelector(".start-center__top")).getPropertyValue("-webkit-app-region"),
    );
    assert.equal(headerRegion.trim(), "no-drag", "the Start Center header must not be a window drag region");
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const box = await page.locator("#startCenterClose").boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page
        .waitForFunction(() => !document.getElementById("startCenter").open, null, { timeout: 3000 })
        .catch(() => {});
      assert.equal(
        await page.locator("#startCenter").evaluate((el) => el.open),
        false,
        `close click must close the Start Center (cycle ${cycle + 1})`,
      );
      /* Reopen through the brand button. While the close animation is running
       * the modal still owns the pointer, so a synthetic click can land on the
       * dialog instead of the button; use the DOM click after the dialog has
       * actually closed. */
      await page
        .waitForFunction(() => !document.getElementById("startCenter").open, null, { timeout: 3000 })
        .catch(() => {});
      await page.evaluate(() => document.getElementById("brandButton").click());
      await page
        .waitForFunction(() => document.getElementById("startCenter").open, null, { timeout: 3000 })
        .catch(() => {});
      assert.equal(
        await page.locator("#startCenter").evaluate((el) => el.open),
        true,
        `Start Center should reopen (cycle ${cycle + 1})`,
      );
    }
    /* Force the stranded state: an invisible panel on an open dialog. Any close
     * path must recover from it rather than trapping the user. */
    await page.evaluate(() => {
      document.getElementById("startCenter").classList.add("is-closing");
    });
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await page
      .waitForFunction(() => !document.getElementById("startCenter").open, null, { timeout: 5000 })
      .catch(() => {});
    assert.equal(
      await page.locator("#startCenter").evaluate((el) => el.open),
      false,
      "an interrupted close must not strand an invisible modal",
    );
    await page.locator("#brandButton").click();
    await page.waitForTimeout(500);

    const menu = await app.evaluate(({ Menu }) => {
      const current = Menu.getApplicationMenu();
      return current ? current.items.map((item) => item.label) : [];
    });
    assert.ok(menu.includes("File"));
    assert.ok(menu.includes("Format"));
    assert.ok(menu.includes("Scene"));
    assert.ok(menu.includes("Help"));

    await page.locator("#startContinue").click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator("#startCenter").evaluate((el) => el.open), false);
    assert.equal(await page.locator(".para").count(), 28);

    // Native template opening must instantiate a new document. Ctrl+S must
    // show a save picker rather than overwriting the source template.
    const templatePath = path.join(temp, "Screenplay Template.fdxt");
    const templateCopy = path.join(temp, "From Template.fdx");
    const templateContents = await page.evaluate(() => FDX.serialize(FDModel.sampleDocument(), { template: true }));
    await fsp.writeFile(templatePath, templateContents, "utf8");
    await app.evaluate(({ dialog }, targets) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [targets.templatePath] });
      global.__templateSavePickers = 0;
      dialog.showSaveDialog = async () => {
        global.__templateSavePickers++;
        return { canceled: false, filePath: targets.templateCopy };
      };
    }, { templatePath, templateCopy });
    await page.locator("#openButton").click();
    await page.waitForFunction(() => document.body.classList.contains("is-dirty"));
    await page.keyboard.press("Control+s");
    await page.waitForFunction(() => !document.querySelector("#saveState").classList.contains("is-busy") && !document.body.classList.contains("is-dirty"));
    assert.equal(await app.evaluate(() => global.__templateSavePickers), 1);
    assert.equal(await fsp.readFile(templatePath, "utf8"), templateContents);
    assert.match(await fsp.readFile(templateCopy, "utf8"), /Template="No"/);

    // Open a document through the same native picker path as File > Open.
    await app.evaluate(
      ({ dialog }, target) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
      },
      documentPath,
    );
    await page.locator("#openButton").click();
    await page.waitForTimeout(1000);
    assert.equal(await page.locator("#docTitle").innerText(), "First Draft");
    assert.equal(await page.locator("#saveStateText").innerText().then((text) => text.startsWith("Saved")), true);

    // Ctrl+S writes the current path with no dialog.
    const before = await page.locator(".para[data-type='Action']").first().innerText();
    await page.locator(".para[data-type='Action']").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Desktop smoke beat.");
    await page.waitForTimeout(300);
    assert.notEqual(await page.locator(".para[data-type='Action']").first().innerText(), before);
    await page.keyboard.press("Control+S");
    await page.waitForTimeout(1400);
    const saved = await fsp.readFile(documentPath, "utf8");
    assert.match(saved, /<FinalDraft DocumentType="Script"/);
    assert.match(saved, /Desktop smoke beat\./);
    assert.equal(await page.locator("#saveStateText").innerText().then((text) => text.startsWith("Saved")), true);

    // Native recent list is updated by save.
    const recent = JSON.parse(await fsp.readFile(path.join(userData, "recent.json"), "utf8"));
    assert.ok(recent.items.some((item) => path.resolve(item.path) === path.resolve(documentPath)));

    // Native menu Save As path: stub the save picker, invoke the real File menu
    // item, and verify the new file plus current path.
    const saveAsPath = path.join(temp, "First Draft Copy.fdx");
    await app.evaluate(
      ({ dialog }, target) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
      },
      saveAsPath,
    );
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const fileMenu = Menu.getApplicationMenu().items.find((item) => item.label === "File");
      const saveAs = fileMenu.submenu.items.find((item) => item.label === "Save As…");
      saveAs.click(saveAs, BrowserWindow.getAllWindows()[0], {});
    });
    await page.waitForTimeout(1400);
    const saveAsFile = await fsp.readFile(saveAsPath, "utf8");
    assert.match(saveAsFile, /<FinalDraft DocumentType="Script"/);
    assert.match(saveAsFile, /Desktop smoke beat\./);
    assert.equal(
      await page.locator("#documentPill").getAttribute("title"),
      saveAsPath,
    );

    // PDF export through the real printToPDF path.
    await app.evaluate(
      ({ dialog }, target) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
      },
      pdfPath,
    );
    await page.evaluate(() => {
      const tab = document.querySelector('.inspector-tab[data-tab="document"]');
      if (tab) tab.click();
      const button = document.querySelector("#exportPdfButton");
      if (button) button.click();
    });
    await page.waitForFunction(()=>document.querySelector('#toastStack')?.textContent.match(/PDF exported|PDF export failed/));
    assert.doesNotMatch(await page.locator('#toastStack').innerText(),/PDF export failed/);
    const pdf = await fsp.readFile(pdfPath);
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    assert.ok(pdf.length > 20000);

    // Page view uses the pagination engine and exposes a dock.
    await page.locator("#viewSegmented [data-mode='page']").click();
    await page.waitForTimeout(800);
    assert.ok((await page.locator(".page-card").count()) >= 1);
    assert.equal(await page.locator("#pageDock").isVisible(), true);
    assert.match(await page.locator("#pageDockLabel").innerText(), /Title|1 \//);

    /* Ctrl+Alt+P must switch to Page view, not print. The print handler used to
     * match `ctrl+p` without checking Alt, so the documented Page View shortcut
     * opened a native print dialog and blocked the renderer.
     *
     * Observe prints without replacing the real IPC handler: stub webContents
     * .print (which is what the handler ultimately calls), so the production
     * handler still runs and later assertions keep working. */
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      global.__printCalls = 0;
      contents.print = (options, callback) => {
        global.__printCalls += 1;
        if (callback) callback(true, "");
      };
    });
    await page.locator("#viewSegmented [data-mode='write']").click();
    await page.waitForTimeout(400);
    await app.evaluate(() => {
      global.__printCalls = 0;
    });
    await page.locator("#editor").click({ position: { x: 40, y: 20 } });
    await page.keyboard.press("Control+Alt+p");
    await page.waitForTimeout(900);
    assert.equal(
      await page.evaluate(() => document.body.classList.contains("page-mode")),
      true,
      "Ctrl+Alt+P must enter Page view",
    );
    assert.equal(
      await app.evaluate(() => global.__printCalls),
      0,
      "Ctrl+Alt+P must not invoke print",
    );
    await page.keyboard.press("Control+p");
    await page.waitForTimeout(1200);
    assert.equal(
      await app.evaluate(() => global.__printCalls),
      1,
      "Ctrl+P must still print",
    );
    await page.locator("#viewSegmented [data-mode='write']").click();
    await page.waitForTimeout(400);

    // Print uses the same paginated print root. The native dialog is stubbed so
    // the test can assert the exact Chromium print options without human input.
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      global.__fdPrintOptions = null;
      contents.print = (options, callback) => {
        global.__fdPrintOptions = options;
        callback(true, "");
      };
    });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send("desktop:command", { command: "print" });
    });
    await page.waitForTimeout(1600);
    const printOptions = await app.evaluate(() => global.__fdPrintOptions);
    assert.ok(printOptions, "print options were forwarded to Chromium");
    assert.equal(printOptions.printBackground, true);
    assert.equal(printOptions.silent, false);
    assert.deepEqual(printOptions.margins, { marginType: "none" });
    assert.equal(Math.round(printOptions.pageSize.width), 215900);
    assert.equal(Math.round(printOptions.pageSize.height), 279400);
    assert.equal(await page.evaluate(() => document.body.classList.contains("is-printing")), false);

    // Cleanup must finish after earlier writes, so a completed save/discard
    // cannot be followed by an older in-flight recovery resurrecting itself.
    await page.evaluate(async () => {
      const document = FDModel.sampleDocument();
      await Promise.all([
        ...Array.from({ length: 6 }, () => window.azkript.writeRecovery({ document })),
        window.azkript.clearRecovery(),
      ]);
    });
    assert.equal(fs.existsSync(path.join(userData, "recovery", "session.json")), false);

    // A dirty edit produces a crash-safe recovery copy.
    await page.locator("#viewSegmented [data-mode='write']").click();
    await page.waitForTimeout(350);
    await page.locator(".para[data-type='Action']").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Recovery beat.");
    await page.waitForTimeout(1400);
    const recoveryPath = path.join(userData, "recovery", "session.json");
    assert.equal(fs.existsSync(recoveryPath), true);
    const recovery = JSON.parse(await fsp.readFile(recoveryPath, "utf8"));
    assert.match(JSON.stringify(recovery.document), /Recovery beat/);
    assert.equal(path.resolve(recovery.filePath), path.resolve(saveAsPath));
    const recoverySnapshot = recovery;

    // Export uses the same low-level file writer as Save. It must not change
    // the active file or clear the main process's unsaved-changes guard.
    const titleBeforeExport = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
    await page.evaluate(async target => window.azkript.saveFile({
      path: target, contents: FDX.serialize(FDModel.sampleDocument()), defaultName: "Exported Copy",
    }), path.join(temp, "Exported Copy.fdx"));
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), titleBeforeExport);

    // The native close prompt is shown for dirty work. Cancel keeps the window.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false });
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await page.waitForTimeout(500);
    const stillOpen = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    assert.equal(stillOpen, 1);
    assert.equal(
      await page
        .locator(".para[data-type='Action']")
        .first()
        .innerText()
        .then((text) => text.includes("Recovery beat")),
      true,
    );

    // Discard from the close prompt closes and clears the recovery copy.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    const closed = new Promise((resolve) => {
      app.on("close", resolve);
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5000))]);
    await page.waitForTimeout(500).catch(() => {});
    assert.equal(fs.existsSync(recoveryPath), false);
    app = null;

    // Put the captured recovery back and verify the Start Center restore path
    // in a fresh process against the same userData directory.
    await fsp.mkdir(path.dirname(recoveryPath), { recursive: true });
    await fsp.writeFile(
      recoveryPath,
      JSON.stringify({ ...recoverySnapshot, updatedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
    app = await _electron.launch({
      executablePath: electronPath,
      args: [...appArgs, "--mute-audio", "--disable-renderer-backgrounding"],
      cwd: root,
      env,
    });
    const restorePage = await app.firstWindow();
    await restorePage.waitForFunction(() => document.getElementById("startCenter")?.open === true && document.getElementById("recoveryBanner")?.hidden === false, null, { timeout: 20000 });
    assert.equal(
      await restorePage.locator("#recoveryBanner").isVisible(),
      true,
      "Start Center offers the recovery copy",
    );
    await restorePage.locator("#recoveryRestore").click();
    await restorePage.waitForTimeout(700);
    assert.equal(await restorePage.locator("#docTitle").innerText(), "First Draft");
    assert.match(await restorePage.locator("#saveStateText").innerText(), /Unsaved|Edited/);
    assert.equal(
      await restorePage
        .locator(".para[data-type='Action']")
        .first()
        .innerText()
        .then((text) => text.includes("Recovery beat")),
      true,
    );

    // Save on close: the restored draft already has a file path, so the native
    // Save decision must write it before the window exits.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    const restoredClosed = new Promise((resolve) => {
      app.on("close", resolve);
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await Promise.race([restoredClosed, new Promise((resolve) => setTimeout(resolve, 6000))]);
    await restorePage.waitForTimeout(500).catch(() => {});
    const closedSave = await fsp.readFile(saveAsPath, "utf8");
    assert.match(closedSave, /Recovery beat\./);
    assert.equal(fs.existsSync(recoveryPath), false);
    app = null;

    assert.deepEqual(errors, []);
    console.log("PASS: desktop smoke test");
  } finally {
    if (app) {
      await app
        .evaluate(({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows()) window.destroy();
        })
        .catch(() => {});
      await app.close().catch(() => {});
    }
    await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

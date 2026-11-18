/* Real Electron accessibility-backend checks. This inspects Chromium's AX tree
 * with platform accessibility enabled. It is not physical IME or NVDA testing.
 * All windows stay hidden, muted, and use a disposable profile. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '../..');
const { _electron } = require(path.join(root, 'node_modules/playwright-core'));

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'azkript-accessibility-'));
  const env = { ...process.env, AZKRIPT_USER_DATA: path.join(temp, 'profile'), AZKRIPT_TEST_BACKGROUND: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const cases = [], errors = []; let app, page;
  const report = { kind: 'electron-chromium-accessibility-tree', physicalIME: 'PENDING',
    physicalScreenReader: 'PENDING', isolatedProfile: true, windowsHidden: true,
    executable: process.env.AZKRIPT_TEST_EXECUTABLE || path.join(root, 'node_modules/electron/dist/electron.exe'),
    provider: 'Chromium CDP accessibility backend; not a Windows screen-reader consumer', cases };
  try {
    app = await _electron.launch({ executablePath: process.env.AZKRIPT_TEST_EXECUTABLE || path.join(root, 'node_modules/electron/dist/electron.exe'),
      args: [...(process.env.AZKRIPT_TEST_EXECUTABLE ? [] : ['.']), ...(process.env.AZKRIPT_TEST_DISABLE_GPU === '1' ? ['--disable-gpu'] : []), '--mute-audio', '--disable-renderer-backgrounding', '--force-renderer-accessibility'], cwd: root, env });
    page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
    await page.waitForFunction(() => document.querySelector('#appShell') && !document.querySelector('#appShell').classList.contains('is-loading'));
    await app.evaluate(({ app }) => app.setAccessibilitySupportEnabled(true));
    report.runtime = await app.evaluate(({ app }) => ({ appVersion: app.getVersion(), electron: process.versions.electron,
      chromium: process.versions.chrome, platform: process.platform, arch: process.arch,
      accessibilityEnabled: app.isAccessibilitySupportEnabled() }));
    assert.equal(await app.evaluate(({ app }) => app.isAccessibilitySupportEnabled()), true);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.isVisible())), false);
    await page.evaluate(() => {
      localStorage.setItem('azkript.prefs.v2', JSON.stringify({ startCenter: false, smartTypeEnabled: true, reducedMotion: true }));
    });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#appShell') && !document.querySelector('#appShell').classList.contains('is-loading'));
    // A noninteractive Windows session can have a narrow virtual display. Open
    // the responsive inspector through its real control before testing its AX tree.
    report.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
      inspectorDisplay: getComputedStyle(document.querySelector('#inspector')).display }));
    if (!await page.locator('#inspector').isVisible()) await page.locator('#inspectorToggle').click();
    await page.locator('#inspector').waitFor({ state: 'visible' });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Accessibility.enable');
    const tree = async () => (await cdp.send('Accessibility.getFullAXTree')).nodes.filter(n => !n.ignored);
    const value = (n, key) => n.properties?.find(p => p.name === key)?.value?.value;
    const visibleSwitches = async () => (await tree()).filter(n => n.role?.value === 'switch');
    const namedSwitches = async label => {
      const switches = await visibleSwitches();
      assert.ok(switches.length > 0, label + ' must contain actual accessible switches');
      for (const sw of switches) {
        assert.ok(sw.name?.value?.trim(), label + ' contains an unnamed switch');
        assert.ok(['true', 'false', true, false].includes(value(sw, 'checked')), 'switch checked state must be exposed');
      }
      cases.push({ name: label, switches: switches.map(sw => ({ name: sw.name.value, checked: value(sw, 'checked') })) });
    };
    await namedSwitches('inspector switches have names and checked state');
    let nodes = await tree();
    const paragraph = nodes.find(n => n.role?.value === 'textbox' && n.name?.value === 'Action paragraph');
    assert.ok(paragraph, 'editable screenplay text must be exposed');
    assert.equal(value(paragraph, 'multiline'), true);
    assert.match(paragraph.value?.value || '', /./);
    cases.push({ name: 'screenplay text and multiline textbox semantics are exposed', textLength: paragraph.value.value.length });

    await page.locator('#settingsButton').click();
    await page.waitForFunction(() => document.querySelector('#appDialog').open);
    nodes = await tree();
    assert.ok(nodes.find(n => n.role?.value === 'dialog' && n.name?.value?.trim()), 'settings dialog must have a spoken title');
    await namedSwitches('settings switches are associated with visible headings');
    const ambient = page.locator('[data-setting="ambientGlow"]');
    const old = await ambient.getAttribute('aria-checked'); await ambient.click();
    const changed = (await visibleSwitches()).find(n => n.name?.value === 'Ambient background glow');
    assert.ok(changed); assert.equal(String(value(changed, 'checked')), String(old !== 'true'));
    cases.push({ name: 'switch changes propagate to the accessibility backend' });
    const settingsDialog = page.locator('#appDialog');
    const boundaries = await settingsDialog.evaluate(el => {
      const controls = [...el.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')]
        .filter(control => control.tabIndex >= 0 && !control.matches(':disabled') && control.getClientRects().length);
      controls[0].focus();
      controls[0].dataset.qaModalEdge = 'first';
      controls.at(-1).dataset.qaModalEdge = 'last';
      return controls.length;
    });
    assert.ok(boundaries > 1);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.qaModalEdge), 'last');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.qaModalEdge), 'first');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#appDialog').open);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'settingsButton');
    cases.push({ name: 'modal keyboard focus wraps in both directions and Escape returns to the launcher' });

    await page.keyboard.press('Control+k');
    await page.waitForFunction(() => document.querySelector('#commandDialog').open);
    nodes = await tree();
    assert.ok(nodes.find(n => n.role?.value === 'dialog' && n.name?.value === 'Command palette'));
    let options = nodes.filter(n => n.role?.value === 'option');
    assert.equal(options.filter(n => value(n, 'selected') === true).length, 1);
    const selectedBefore = options.find(n => value(n, 'selected') === true).name.value;
    const commandComposition = await page.locator('#commandInput').evaluate(el => {
      const dispatch = options => el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options }));
      return { enter: dispatch({ key: 'Enter', isComposing: true }), arrow: dispatch({ key: 'ArrowDown', isComposing: true }),
        legacyEnter: dispatch({ key: 'Enter', keyCode: 229 }), open: document.querySelector('#commandDialog').open };
    });
    assert.deepEqual(commandComposition, { enter: true, arrow: true, legacyEnter: true, open: true },
      'IME candidate keys must not execute commands or move command selection');
    assert.equal((await tree()).find(n => n.role?.value === 'option' && value(n, 'selected') === true).name.value, selectedBefore);
    cases.push({ name: 'composition candidate Enter/Arrow keys do not execute command palette actions', input: 'simulated composition key events' });
    await page.keyboard.press('ArrowDown'); nodes = await tree();
    options = nodes.filter(n => n.role?.value === 'option');
    const selectedAfter = options.filter(n => value(n, 'selected') === true);
    assert.equal(selectedAfter.length, 1); assert.notEqual(selectedAfter[0].name.value, selectedBefore);
    assert.ok((await page.locator('#commandInput').getAttribute('aria-activedescendant'))?.startsWith('command-option-'));
    await page.locator('#commandInput').fill('impossible-command-093750');
    await page.waitForFunction(() => !document.querySelector('#commandInput').hasAttribute('aria-activedescendant'));
    cases.push({ name: 'command palette exposes selected options and removes stale active descendants' });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#commandDialog').open);

    // These dialogs use distinct markup around switches; checking the backend
    // catches an unlabeled control even when its visual text looks correct.
    for (const label of ['Header and Footer setup', 'Mores and Continueds', 'Page Watermark',
      'SmartType autocomplete lists', 'Highlight Characters in Script', 'Lock Pages / A-Pages']) {
      await page.keyboard.press('Control+k');
      await page.waitForFunction(() => document.querySelector('#commandDialog').open);
      await page.locator('#commandInput').fill(label);
      await page.locator('.command-item').filter({ hasText: label }).first().click();
      await page.waitForFunction(() => document.querySelector('#appDialog').open);
      const dialogNode = (await tree()).find(n => n.role?.value === 'dialog');
      assert.ok(dialogNode?.name?.value?.trim(), label + ' dialog must have a spoken title');
      if(label==='Lock Pages / A-Pages'){
        const action=(await tree()).find(n=>n.role?.value==='button'&&n.name?.value==='Issue and lock pages');
        assert.ok(action,'production locking must expose its named issue action');
        const button=page.getByRole('button',{name:'Issue and lock pages',exact:true});await button.focus();
        assert.equal(await button.evaluate(el=>el===document.activeElement),true,'the issue action must be keyboard reachable');
        cases.push({name:'production locking exposes a named keyboard-reachable issue action'});
      }else await namedSwitches(label);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('#appDialog').open);
    }

    await page.locator('#revisionButton').click();
    await page.waitForFunction(() => document.querySelector('#appDialog').open);
    await namedSwitches('revision manager switch');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#appDialog').open);

    await page.keyboard.press('Control+f');
    await page.waitForFunction(() => document.querySelector('#findDialog').open);
    await page.locator('#findInput').fill('signal');
    await page.waitForFunction(() => document.querySelector('#findCount').textContent.includes('result'));
    nodes = await tree();
    assert.ok(nodes.find(n => ['searchbox','textbox'].includes(n.role?.value) && n.name?.value === 'Find in screenplay'));
    assert.ok(nodes.find(n => n.role?.value === 'textbox' && n.name?.value === 'Replace with'));
    const status = nodes.find(n => n.role?.value === 'status' && value(n, 'live') === 'polite');
    assert.ok(status, 'result-count updates must be announced without reading all search results');
    assert.deepEqual(await page.locator('#findInput').evaluate(el => ({
      enter: el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })),
      legacyEnter: el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }))
    })), { enter: true, legacyEnter: true }, 'Find must leave IME candidate selection to the input method');
    cases.push({ name: 'Find does not intercept composition candidate Enter keys', input: 'simulated composition key events' });
    cases.push({ name: 'find fields have stable names and results expose a polite status region' });
    const findInput = page.locator('#findInput');
    await findInput.fill('azk-unmatched-query');
    await page.waitForFunction(() => document.querySelector('#findCount').textContent === '0 results');
    const regexOption = page.getByRole('button', { name: 'Regex' });
    assert.equal(await regexOption.getAttribute('aria-pressed'), 'false');
    await regexOption.press('Space');
    const regexNode = (await tree()).find(n => n.role?.value === 'button' && n.name?.value === 'Regex');
    assert.equal(String(value(regexNode, 'pressed')), 'true');
    await findInput.fill('[');
    await page.waitForFunction(() => document.querySelector('#findCount').textContent === 'Invalid regex');
    await regexOption.press('Space');
    await findInput.fill('signal');
    await page.locator('#findResults .find-result').first().waitFor();
    await findInput.press('Enter');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#findDialog').open);
    assert.deepEqual(await page.evaluate(() => ({ editor: !!document.activeElement.closest('#editor'), text: getSelection().toString().toLowerCase() })),
      { editor: true, text: 'signal' });
    cases.push({ name: 'Find announces filter state and distinguishes no matches from invalid regex, then returns focus to matched text' });

    const action = page.locator('#editor .para[data-type="Action"]').first();
    await action.focus();
    await action.evaluate(el => getSelection().collapse(el.firstChild, 2));
    await page.keyboard.press('F6');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'titlePageButton',
      'keyboard users must be able to leave the editor while Tab changes element types');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'pageSetupButton');
    await page.keyboard.press('F6');
    assert.ok(await action.evaluate(el => document.activeElement === el && getSelection().focusOffset === 2),
      'keyboard users must be able to return to their editing position');
    cases.push({ name: 'F6 exits the editor for keyboard navigation and returns to the caret' });

    const original = await action.innerHTML();
    const originalText = await action.textContent();
    const placeCaret = () => action.evaluate(el => getSelection().collapse(el, 0));
    await placeCaret();
    await cdp.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 });
    assert.match(await action.textContent(), /^nihao/, 'Chromium must render the active candidates in the editor');
    assert.equal(await page.locator('#saveState').evaluate(el => el.classList.contains('is-dirty')), false,
      'uncommitted composition must stay out of edit, recovery and history state');
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    assert.equal(await action.innerHTML(), original, 'cancelling composition must preserve the original paragraph');
    assert.equal(await page.locator('#saveState').evaluate(el => el.classList.contains('is-dirty')), false,
      'cancelling composition must leave a clean draft clean');
    cases.push({ name: 'uncommitted and cancelled IME input do not mark the draft dirty', input: 'Chromium CDP composition' });

    await placeCaret();
    await cdp.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 });
    await cdp.send('Input.insertText', { text: '你好' });
    assert.equal(await action.innerHTML(), '你好' + original);
    await page.keyboard.insertText('!');
    await page.keyboard.press('Control+z');
    assert.equal(await action.innerHTML(), '你好' + original, 'undo of later typing must leave the committed IME edit');
    await page.keyboard.press('Control+z');
    assert.equal(await action.innerHTML(), original, 'one undo must revert the entire composition');
    await page.keyboard.press('Control+y');
    assert.equal(await action.innerHTML(), '你好' + original, 'one redo must restore exactly the committed composition');
    cases.push({ name: 'one undo and redo cover the committed IME text independently of later typing', input: 'Chromium CDP composition' });

    const globalComposition = await action.evaluate(el => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'ni' }));
      const allowed = el.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
      const open = document.querySelector('#commandDialog').open;
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
      return { allowed, open };
    });
    assert.deepEqual(globalComposition, { allowed: true, open: false }, 'active editor composition also guards shortcuts when an OS event omits isComposing');
    cases.push({ name: 'composition state protects editor shortcuts when key flags are missing', input: 'simulated composition state' });

    const paragraphCount = await page.locator('#editor .para').count();
    await action.evaluate(el => getSelection().setBaseAndExtent(el.firstChild, 0, el.firstChild, 2));
    await page.keyboard.press('Control+b');
    const bold = action.locator('b, strong, span[style*="font-weight"]').first();
    const styled = await action.innerHTML();
    await bold.evaluate(el => getSelection().setBaseAndExtent(el.firstChild, 0, el.firstChild, 1));
    await cdp.send('Input.imeSetComposition', { text: 'にほんご', selectionStart: 4, selectionEnd: 4 });
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    assert.equal(await action.innerHTML(), styled, 'cancellation over a selection must keep the selected styled text');
    assert.equal(await page.evaluate(() => getSelection().toString()), '你');

    await bold.evaluate(el => getSelection().collapse(el.firstChild, 1));
    await cdp.send('Input.imeSetComposition', { text: 'にほんご', selectionStart: 4, selectionEnd: 4 });
    await cdp.send('Input.insertText', { text: '日本語' });
    assert.equal(await bold.textContent(), '你日本語好');
    await page.keyboard.press('Control+z');
    assert.equal(await bold.textContent(), '你好');
    assert.equal(await action.textContent(), '你好' + originalText);
    await page.keyboard.press('Control+y');
    assert.equal(await bold.textContent(), '你日本語好');

    const plainAction = () => action.evaluate(el => FDPagination.plainText(el.innerHTML));
    await action.evaluate(el => getSelection().collapse(el.lastChild, 5));
    await action.press('Shift+Enter');
    const breakOffset = (await plainAction()).indexOf('\n');
    assert.ok(breakOffset > 0, `Shift+Enter must insert a soft break in ${await action.innerHTML()}`);
    for (const [after, preedit, text] of [[false, 'zuo', '左'], [true, 'you', '右']]) {
      const offset = after ? breakOffset + 2 : breakOffset;
      await action.evaluate((el, offset) => {
        const point = { id: el.dataset.id, offset };
        FDCoreWriting.restoreSelection(el.closest('#editor'), { start: point, end: point });
      }, offset);
      await cdp.send('Input.imeSetComposition', { text: preedit, selectionStart: preedit.length, selectionEnd: preedit.length });
      await cdp.send('Input.insertText', { text });
    }
    assert.match(await plainAction(), /左\n右/);
    assert.equal(await page.locator('#editor .para').count(), paragraphCount);

    const savedPath = path.join(temp, 'ime-round-trip.fdx');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
    }, savedPath);
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => document.querySelector('#saveStateText').textContent.startsWith('Saved'));
    await action.evaluate(el => { el.dataset.beforeReopen = 'true'; });
    await page.keyboard.press('Control+o');
    await page.locator('#editor [data-before-reopen]').waitFor({ state: 'detached' });
    assert.equal(await bold.textContent(), '你日本語好');
    assert.match(await plainAction(), /左\n右/);
    cases.push({ name: 'IME cancellation, styled conversion and edits around a soft line break survive undo and FDX reopen', input: 'Chromium CDP composition' });

    // Exercise the actual autocomplete UI, keeping focus in the editing field.
    const cue = page.locator('#editor .para[data-type="Character"]').first();
    await cue.focus(); await page.keyboard.press('Control+a'); await page.keyboard.type('M');
    await page.waitForFunction(() => !document.querySelector('#smartType').hidden);
    const selectedSmart = await page.locator('#smartType [aria-selected="true"]').count();
    assert.equal(selectedSmart, 1);
    const activeID = await cue.getAttribute('aria-activedescendant');
    assert.ok(activeID); assert.equal(await page.locator('#' + activeID).getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await cue.getAttribute('aria-activedescendant'), null);
    cases.push({ name: 'SmartType exposes the active option and clears it when dismissed' });

    await page.locator('#fileInput').setInputFiles(path.join(root, 'app/tests/fixtures/native-production.fdx'));
    await page.getByRole('dialog', { name: 'Leave this draft behind?' }).getByRole('button', { name: 'Discard changes' }).click();
    await page.locator('#editor .para[data-id="73062100-1243-4528-9012-012345678902"]').waitFor();
    await page.locator('#appDialog[open]').waitFor({ state: 'hidden' });
    await page.keyboard.press('Control+k');
    await page.waitForFunction(() => document.querySelector('#commandDialog').open);
    await page.locator('#commandInput').fill('Edit native FDX metadata');
    await page.locator('.command-item').filter({ hasText: 'Edit native FDX metadata' }).click();
    await page.waitForFunction(() => document.querySelector('#appDialog').open);
    await page.locator('#nativeMetadataFields details').evaluateAll(els => els.forEach(el => { el.open = true; }));
    nodes = await tree();
    assert.ok(nodes.find(n => n.role?.value === 'dialog' && n.name?.value === 'Native metadata'));
    assert.ok(nodes.find(n => n.role?.value === 'combobox' && n.name?.value === 'Metadata section'));
    const nativeFields = nodes.filter(n => n.role?.value === 'textbox');
    assert.ok(nativeFields.length > 0, 'populated native metadata must expose editable fields');
    assert.ok(nativeFields.every(n => n.name?.value?.trim()), 'every exposed metadata editor needs a visible-text accessible name');
    const firstField = page.locator('[data-native-field]').first();
    const edited = (await firstField.inputValue()) + ' draft'; await firstField.fill(edited);
    const sectionSelect = page.locator('#nativeMetadataSection');
    const originalSection = await sectionSelect.inputValue();
    const other = await sectionSelect.locator('option').evaluateAll((els, original) => els.find(el => el.value !== original)?.value, originalSection);
    assert.ok(other, 'fixture must exercise switching between populated sections');
    await sectionSelect.selectOption(other);
    assert.equal(await sectionSelect.inputValue(), originalSection);
    assert.equal(await firstField.inputValue(), edited);
    assert.match(await page.locator('#nativeMetadataError').innerText(), /Apply your native changes/);
    nodes = await tree();
    assert.ok(nodes.find(n => n.role?.value === 'alert' && value(n, 'live') === 'assertive'), 'native editor validation must reach the accessibility backend');
    cases.push({ name: 'native metadata editor exposes named fields and announces protected unsaved-section changes', fields: nativeFields.length });
    assert.deepEqual(errors, []);
    report.passed = true;
    for (const item of cases) console.log('PASS: ' + item.name);
  } catch (error) {
    report.passed = false; report.error = error.stack; console.error(error.stack); process.exitCode = 1;
    if (page) report.failureUI = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
      openDialogs: [...document.querySelectorAll('dialog[open]')].map(el => el.id),
      inspectorDisplay: getComputedStyle(document.querySelector('#inspector')).display,
      inspectorRect: document.querySelector('#inspector').getBoundingClientRect().toJSON() })).catch(() => null);
  }
  finally {
    if (app) {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await app.close().catch(() => {});
    }
    await fs.mkdir(path.join(root, 'reports'), { recursive: true });
    await fs.writeFile(path.join(root, 'reports/native-accessibility.json'), JSON.stringify(report, null, 2));
    await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
  }
})();

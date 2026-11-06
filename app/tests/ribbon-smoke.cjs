/* Ribbon smoke test — one deck, ten tabs, no tab flyout menus.
 * Requires Google Chrome and the Playwright core package that ships with REA.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const playwrightPath = path.join(root, "rea", "node_modules", "playwright-core");
if (!fs.existsSync(playwrightPath)) {
  console.log("SKIP: rea/node_modules/playwright-core is not installed");
  process.exit(0);
}
const { chromium } = require(playwrightPath);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(appUrl);
  await page.waitForTimeout(1100);

  /* Ten tabs, one visible deck panel, and no legacy tab flyout. */
  const tabs = await page.locator("[data-ribbon-tab]").evaluateAll((els) =>
    els.map((el) => el.dataset.ribbonTab),
  );
  assert.deepEqual(tabs, [
    "home", "file", "edit", "view", "format", "insert", "document", "tools", "production", "help",
  ]);
  assert.equal(await page.locator("#menuFlyout").count(), 0, "Tab flyout must not exist");
  assert.equal(await page.locator(".ribbon-tab-panel:not([hidden])").count(), 1);

  for (const tab of tabs) {
    await page.locator(`[data-ribbon-tab="${tab}"]`).click();
    await page.waitForTimeout(130);
    assert.equal(
      await page.locator(`.ribbon-tab-panel[data-ribbon-panel="${tab}"]`).isVisible(),
      true,
      `Panel for ${tab} should be visible`,
    );
    assert.equal(await page.locator(".ribbon-tab-panel:not([hidden])").count(), 1);
  }

  /* Home group captions follow the FD13 screenshot layout. */
  await page.locator('[data-ribbon-tab="home"]').click();
  await page.waitForTimeout(160);
  const groups = await page
    .locator('.ribbon-tab-panel[data-ribbon-panel="home"] .ribbon-group__label')
    .evaluateAll((els) => els.map((el) => el.textContent.trim()));
  for (const label of ["Proofing", "Clipboard", "Font", "Insert", "Script Elements", "Title Page", "Views", "Split"]) {
    assert.ok(groups.includes(label), `Home ribbon should include the ${label} group`);
  }
  const deckFit = await page.evaluate(() => {
    const scroller = document.getElementById("ribbonScroller");
    return scroller.scrollWidth - scroller.clientWidth;
  });
  assert.ok(deckFit <= 8, `Home ribbon should fit at 1600px (overflow ${deckFit}px)`);

  /* Combos open an anchored popover, not a tab menu. */
  await page.locator('[data-ribbon-panel="home"] [data-ribbon-combo="element"]').first().click();
  await page.waitForTimeout(180);
  assert.equal(await page.locator("#ribbonPopover").isVisible(), true);
  assert.ok((await page.locator("#ribbonPopover .rb-menu__item").count()) >= 8);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
  assert.equal(await page.locator("#ribbonPopover").isVisible(), false);

  /* Highlighter palette is a ribbon popover too. */
  await page.locator('[data-ribbon-panel="home"] [data-ribbon-menu="highlight"]').first().click();
  await page.waitForTimeout(160);
  assert.equal(await page.locator("#ribbonPopover").isVisible(), true);
  assert.ok((await page.locator("#ribbonPopover .rb-swatch").count()) >= 4);
  await page.keyboard.press("Escape");

  /* Structure lines toggle is a stateful ribbon control. */
  await page.locator('[data-ribbon-tab="view"]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-ribbon-panel="view"] [data-ribbon-command="view-toggle-structure"]').first().click();
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(() => document.body.classList.contains("show-structure-lines")),
    true,
  );
  assert.equal(
    await page
      .locator('[data-ribbon-panel="view"] [data-ribbon-command="view-toggle-structure"]')
      .first()
      .getAttribute("aria-pressed"),
    "true",
  );

  /* Day / night / midnight appearance controls live in View. */
  await page.locator('[data-ribbon-panel="view"] [data-ribbon-command="view-appearance-night"]').first().click();
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await page.locator('[data-ribbon-panel="view"] [data-ribbon-command="view-appearance-day"]').first().click();
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");

  /* Classic view collapses the ribbon; the pin restores it. */
  await page.locator('[data-ribbon-panel="view"] [data-ribbon-command="view-classic"]').first().click();
  await page.waitForTimeout(400);
  assert.equal(
    await page.evaluate(() => document.getElementById("appShell").classList.contains("ribbon-collapsed")),
    true,
  );

  /* Collapsing the ribbon must give the height to the workspace, not to the
   * statusbar: an empty 0px shell track once swallowed .workspace entirely. */
  const collapsedShell = await page.evaluate(() => {
    const ws = document.querySelector(".workspace").getBoundingClientRect();
    const bar = document.querySelector(".statusbar").getBoundingClientRect();
    const cmd = document.getElementById("ribbonBar").getBoundingClientRect();
    return { wsH: Math.round(ws.height), barH: Math.round(bar.height), cmdH: Math.round(cmd.height) };
  });
  assert.equal(collapsedShell.cmdH, 0, "Collapsed ribbon should occupy no height");
  assert.ok(collapsedShell.barH <= 40, `Statusbar must stay slim (got ${collapsedShell.barH}px)`);
  assert.ok(collapsedShell.wsH > 400, `Workspace must absorb the freed space (got ${collapsedShell.wsH}px)`);

  await page.locator("#ribbonPinButton").click();
  await page.waitForTimeout(400);
  assert.equal(
    await page.evaluate(() => document.getElementById("appShell").classList.contains("ribbon-collapsed")),
    false,
  );

  /* Closing the inspector must not pull .main into another pane's track. */
  await page.locator("#inspectorClose").click();
  await page.waitForTimeout(420);
  const inspectorClosed = await page.evaluate(() => {
    const main = document.querySelector(".main").getBoundingClientRect();
    const editor = document.querySelector("#editor").getBoundingClientRect();
    const wsRows = getComputedStyle(document.querySelector(".workspace")).gridTemplateRows;
    return { mainW: Math.round(main.width), editorW: Math.round(editor.width), wsRows };
  });
  assert.ok(
    inspectorClosed.mainW > 500,
    `Main pane must stay wide with the inspector closed (got ${inspectorClosed.mainW}px)`,
  );
  assert.ok(
    inspectorClosed.editorW > 400,
    `Editor must stay legible with the inspector closed (got ${inspectorClosed.editorW}px)`,
  );
  assert.equal(
    inspectorClosed.wsRows.trim().split(/\s+/).length,
    1,
    `Workspace must stay a single grid row (got "${inspectorClosed.wsRows}")`,
  );
  await page.evaluate(() => document.getElementById("inspectorToggle").click());
  await page.waitForTimeout(420);

  /* Layout-state matrix: rail-collapsed, inspector-closed and no-navigator each
   * zero their own track. Combinations must compose — a hidden pane may never
   * push .main into another pane's track, and no hidden track may keep width. */
  const combos = [
    { name: "rail-collapsed", apply: () => { document.body.classList.add("rail-collapsed"); document.getElementById("appShell").classList.add("rail-collapsed"); } },
    { name: "no-navigator", apply: () => document.querySelector(".workspace").classList.add("no-navigator") },
    { name: "inspector-closed", apply: () => document.getElementById("appShell").classList.add("inspector-closed") },
    { name: "rail+navigator", apply: () => { document.body.classList.add("rail-collapsed"); document.getElementById("appShell").classList.add("rail-collapsed"); document.querySelector(".workspace").classList.add("no-navigator"); } },
    { name: "rail+inspector", apply: () => { document.body.classList.add("rail-collapsed"); document.getElementById("appShell").classList.add("rail-collapsed", "inspector-closed"); } },
    { name: "all-three", apply: () => { document.body.classList.add("rail-collapsed"); const s = document.getElementById("appShell"); s.classList.add("rail-collapsed", "inspector-closed"); document.querySelector(".workspace").classList.add("no-navigator"); } },
    { name: "focus-after-rail", apply: () => { document.body.classList.add("rail-collapsed", "focus-mode"); document.getElementById("appShell").classList.add("rail-collapsed"); } },
  ];
  for (const combo of combos) {
    await page.evaluate(() => {
      document.body.className = "";
      document.getElementById("appShell").className = "app-shell";
      document.querySelector(".workspace").className = "workspace";
    });
    await page.evaluate(combo.apply);
    /* .workspace transitions grid-template-columns; let it settle. */
    await page.waitForTimeout(420);
    const state = await page.evaluate(() => {
      const ws = document.querySelector(".workspace");
      const width = (sel) => Math.round((document.querySelector(sel) || { getBoundingClientRect: () => ({ width: -1 }) }).getBoundingClientRect().width);
      const display = (sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).display : "absent";
      };
      const tracks = getComputedStyle(ws).gridTemplateColumns.split(/\s+/).map((v) => Math.round(parseFloat(v)));
      return {
        single: tracks.length === 1,
        tracks,
        mainW: width(".main"),
        editorW: width("#editor"),
        railHidden: display(".rail") === "none" || width(".rail") === 0,
        navHidden: display(".scenes-panel") === "none" || width(".scenes-panel") === 0,
        inspHidden: display(".inspector") === "none" || width(".inspector") === 0,
        rows: getComputedStyle(ws).gridTemplateRows,
      };
    });
    assert.ok(state.editorW > 400, `${combo.name}: editor must stay legible (got ${state.editorW}px)`);
    assert.equal(
      state.rows.trim().split(/\s+/).length,
      1,
      `${combo.name}: workspace must remain a single grid row (got "${state.rows}")`,
    );
    if (!state.single) {
      assert.ok(state.mainW > 300, `${combo.name}: main pane collapsed (got ${state.mainW}px, tracks ${state.tracks})`);
      if (state.railHidden) assert.ok(state.tracks[0] <= 2, `${combo.name}: hidden rail kept ${state.tracks[0]}px`);
      if (state.navHidden) assert.ok(state.tracks[1] <= 2, `${combo.name}: hidden navigator kept ${state.tracks[1]}px`);
      if (state.inspHidden) assert.ok(state.tracks[3] <= 2, `${combo.name}: hidden inspector kept ${state.tracks[3]}px`);
    }
  }
  await page.evaluate(() => {
    document.body.className = "";
    document.getElementById("appShell").className = "app-shell";
    document.querySelector(".workspace").className = "workspace";
  });
  await page.waitForTimeout(420);

  /* Ctrl+G opens Go To; Escape closes it. */
  await page.locator("#editor .para").first().click();
  await page.keyboard.press("Control+g");
  await page.waitForTimeout(220);
  assert.equal(await page.locator("#appDialog").evaluate((el) => el.open), true);
  await page.locator("#dialogTitle").innerText().then((title) => assert.match(title, /Jump to/i));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.waitForFunction(() => !document.getElementById("appDialog").open, null, { timeout: 3000 });
  await page.waitForTimeout(150);

  /* Command palette indexes the ribbon commands. */
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(220);
  await page.locator("#commandInput").fill("beat board");
  await page.waitForTimeout(160);
  assert.match(await page.locator("#commandList .command-item").first().innerText(), /beat board/i);
  await page.keyboard.press("Escape");

  /* Page mode renders the FDX-backed page cards. */
  await page.locator("#viewSegmented [data-mode='page']").click();
  await page.waitForTimeout(700);
  assert.ok((await page.locator(".page-card").count()) >= 1);
  await page.locator("#viewSegmented [data-mode='write']").click();

  /* A confirmation opened from inside another dialog must stay open. Every
   * dialog reuses #appDialog, so the outer action handler used to close the
   * prompt it had just opened: "Clear local data" flashed its confirmation and
   * dismissed it, leaving the button dead in the water. */
  await page.locator("#settingsButton").click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator("#appDialog").evaluate((el) => el.open), true);
  await page.locator('button.btn--danger:has-text("Clear local data")').click();
  await page.waitForTimeout(600);
  assert.equal(
    await page.locator("#appDialog").evaluate((el) => el.open),
    true,
    "a confirmation opened from a dialog must survive the outer handler",
  );
  assert.equal(await page.locator("#dialogTitle").innerText(), "Clear local data?");
  /* Cancel dismisses the prompt and leaves the document untouched. */
  await page.locator("#appDialog .btn:not(.btn--danger)").first().click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator("#appDialog").evaluate((el) => el.open), false);

  assert.deepEqual(errors, []);
  console.log("PASS: ribbon smoke test");
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

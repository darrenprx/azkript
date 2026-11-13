/* Browser regression test for the defects found in the UI audit.
 *
 * Each case here was a real, reproduced bug. They are grouped in one file
 * because they share a routine ("boot the app, drive one control, assert the
 * observable state"), and because every one of them was a *silent* failure —
 * the control responded visually while doing nothing, or reported success while
 * corrupting data. Silent failures need assertions, not eyeballing.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const playwrightPath = path.join(root, "node_modules", "playwright-core");
if (!fs.existsSync(playwrightPath)) {
  console.log("SKIP: node_modules/playwright-core is not installed");
  process.exit(0);
}
const { chromium } = require(playwrightPath);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(appUrl);
  await page.waitForTimeout(1100);

  const view = (name) => page.evaluate((n) => document.querySelector(`.rail__item[data-view="${n}"]`).click(), name);
  const openDialog = async (id) => {
    await page.evaluate((selector) => document.getElementById(selector).click(), id);
    await page.waitForTimeout(400);
  };
  const closeDialog = async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
  };

  /* 1. Scene View: eight cells must sit on one grid row, at every width.
   * The CSS declared 7 tracks for 8 cells, so "Actions" wrapped to a second
   * row in every scene, doubling each row's height. */
  await view("sceneview");
  await page.waitForTimeout(500);
  for (const width of [1440, 1200, 1080]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    const row = await page.evaluate(() => {
      const first = document.querySelector(".scene-view-table .sv-row");
      if (!first) return null;
      const tops = [...first.children].map((cell) => Math.round(cell.getBoundingClientRect().top));
      return {
        cells: first.children.length,
        sameRow: new Set(tops).size === 1,
        height: Math.round(first.getBoundingClientRect().height),
      };
    });
    assert.ok(row, "scene view row should exist");
    assert.equal(row.cells, 8, "scene view row should have 8 cells");
    assert.equal(row.sameRow, true, `all 8 cells must share one grid row at ${width}px (got ${JSON.stringify(row)})`);
    assert.ok(row.height < 56, `row height must stay compact at ${width}px (got ${row.height})`);
  }
  await page.setViewportSize({ width: 1440, height: 950 });

  /* 2. Cards-across "Auto" must restore the responsive layout, not mean 3. */
  await view("navigator");
  await page.waitForTimeout(450);
  await page.selectOption("#cardsAcrossSelect", "3");
  await page.waitForTimeout(300);
  const fixedThree = await page.evaluate(
    () => document.querySelector("#sceneGrid").style.gridTemplateColumns,
  );
  await page.selectOption("#cardsAcrossSelect", "0");
  await page.waitForTimeout(300);
  const autoInline = await page.evaluate(
    () => document.querySelector("#sceneGrid").style.gridTemplateColumns,
  );
  assert.equal(autoInline, "", "Auto must clear the inline grid override");
  assert.notEqual(fixedThree, "", "a numeric choice must set an explicit track list");

  /* 3. Sprint word delta must actually update while writing. */
  await page.evaluate(() => (document.getElementById("sprintQuickButton") ||
    document.querySelector('[data-ribbon-command="tools-sprint"]')).click());
  await page.waitForTimeout(350);
  await page.evaluate(() => document.getElementById("sprintToggleBtn").click());
  await page.waitForTimeout(400);
  const deltaIdle = await page.evaluate(() => document.getElementById("sprintWordDelta").textContent);
  await view("script");
  await page.waitForTimeout(300);
  await page.locator(".para[data-type='Action']").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" alpha beta gamma delta epsilon");
  await page.waitForTimeout(1200);
  const deltaAfter = await page.evaluate(() => document.getElementById("sprintWordDelta").textContent);
  assert.notEqual(deltaAfter, deltaIdle, "word delta must change after writing");
  assert.match(deltaAfter, /\+[1-9]\d* word/, `expected a positive delta, got "${deltaAfter}"`);

  /* 4. Invalid regex must say so, not report "0 results". */
  await openDialog("findButton");
  const regexToggle = page.locator('button:has-text("Regex")').first();
  if (await regexToggle.count()) {
    await regexToggle.click();
    await page.waitForTimeout(250);
  }
  await page.locator("#findInput").fill("([unclosed");
  await page.waitForTimeout(600);
  assert.match(
    await page.locator("#findCount").innerText(),
    /invalid/i,
    "an invalid regex must be reported as invalid",
  );

  /* 5. Regex replace must expand $1 rather than writing it literally. */
  await page.locator("#findInput").fill("(MARA|ELIAS)");
  await page.waitForTimeout(500);
  await page.locator("#replaceInput").fill("[$1]");
  await page.locator('button:has-text("Replace all")').first().click();
  await page.waitForTimeout(800);
  await closeDialog();
  const editorText = await page.locator("#editor").innerText();
  assert.equal(
    (editorText.match(/\[\$1\]/g) || []).length,
    0,
    "$1 must not be written literally",
  );
  assert.ok(
    (editorText.match(/\[(MARA|ELIAS)\]/g) || []).length > 0,
    "capture groups should be expanded into the replacement",
  );

  /* 6. Beat-board snap toggle must keep aria-pressed in sync with its look. */
  await view("beatboard");
  await page.waitForTimeout(400);
  const snapBefore = await page.evaluate(() => {
    const button = document.getElementById("beatSnapToggle");
    return { aria: button.getAttribute("aria-pressed"), active: button.classList.contains("is-active") };
  });
  await page.locator("#beatSnapToggle").click();
  await page.waitForTimeout(350);
  const snapAfter = await page.evaluate(() => {
    const button = document.getElementById("beatSnapToggle");
    return { aria: button.getAttribute("aria-pressed"), active: button.classList.contains("is-active") };
  });
  assert.notEqual(snapBefore.aria, snapAfter.aria, "aria-pressed must change with the toggle");
  assert.equal(snapAfter.aria, String(snapAfter.active), "aria-pressed must match the visual state");

  /* 7. Revision manager caption must follow the in-place switch. */
  await view("script");
  await page.waitForTimeout(400);
  await openDialog("revisionButton");
  const captionOf = () => page.evaluate(() => document.querySelector(".revision-hero p")?.textContent || "");
  const captionBefore = await captionOf();
  await page.locator("#revisionModeSwitch").click();
  await page.waitForTimeout(500);
  const captionAfter = await captionOf();
  assert.notEqual(captionBefore, captionAfter, "revision caption must update when the switch flips");
  await closeDialog();

  assert.deepEqual(errors, []);
  console.log("PASS: audit regression test");
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  process.exit(1);
});

/* Browser smoke test for Azkript.
 * Requires Google Chrome and the pinned Playwright core dependency.
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
const chrome =
  process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;
let browser;

(async () => {
  browser = await chromium.launch({ headless: true, executablePath: chrome });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(appUrl);
  await page.waitForTimeout(900);
  assert.equal(await page.title(), "The Last Signal — Azkript");
  assert.equal(await page.locator(".scene-item").count(), 3);
  assert.equal(await page.locator(".para").count(), 28);
  assert.equal(await page.locator(".dual-block").count(), 1);

  await page.locator(".rail__item[data-view='navigator']").click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".scene-card").count(), 3);
  await page.locator(".scene-card").first().click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".view:not([hidden])").getAttribute("data-view-panel"), "script");

  await page.locator(".rail__item[data-view='characters']").click();
  await page.waitForTimeout(250);
  assert.ok((await page.locator(".cast-card").count()) >= 2);

  await page.locator(".rail__item[data-view='reports']").click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".stat-card").count(), 6);
  assert.ok((await page.locator(".bar-chart__bar").count()) >= 3);

  await page.locator(".rail__item[data-view='script']").click();
  await page.waitForTimeout(220);
  const action = page.locator(".para[data-type='Action']").first();
  await action.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" A smoke-test beat.");
  await page.waitForTimeout(120);
  assert.equal(await page.locator("#undoButton").isDisabled(), false);
  assert.ok((await action.innerText()).includes("smoke-test beat"));
  await page.locator("#undoButton").click();
  await page.waitForTimeout(180);
  assert.equal((await action.innerText()).includes("smoke-test beat"), false);

  await action.click();
  await page.evaluate(() => {
    const el = document.querySelector(".para[data-type='Action']");
    const text = el.firstChild;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 5);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.locator('.ribbon-tab-panel:not([hidden]) [data-format="bold"]').click();
  await page.waitForTimeout(150);

  await page.locator("#viewSegmented [data-mode='page']").click();
  await page.waitForTimeout(600);
  assert.ok((await page.locator(".page-card").count()) >= 1);
  await page.locator("#viewSegmented [data-mode='write']").click();

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportButton").click();
  const download = await downloadPromise;
  const xml = fs.readFileSync(await download.path(), "utf8");
  assert.match(xml, /<FinalDraft DocumentType="Script" Template="No" Version="6"/);
  assert.match(xml, /<ElementSettings Type="Dialogue">/);
  assert.equal(await page.evaluate(xml => {
    const tree = new DOMParser().parseFromString(xml, 'application/xml');
    const body = [...tree.documentElement.children].find(node => node.nodeName === 'Content');
    return [...body.querySelectorAll('Text')].some(node => (node.getAttribute('Style') || '').split('+').includes('Bold') && node.textContent.length > 0);
  }, xml), true, 'selected body text retains Bold even when native tag attributes are present');

  assert.deepEqual(errors, []);
  console.log("PASS: browser smoke test");
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close().catch(() => {});
  process.exitCode = 1;
});

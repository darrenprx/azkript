/* Browser test for the floating tooltip layer.
 *
 * Tooltips used to be `::after` pseudo-elements on their trigger. A
 * pseudo-element is confined to its trigger's overflow context, so every
 * tooltip inside the ribbon deck, the navigator or the inspector was clipped by
 * that container's `overflow: hidden` — the ribbon sliced the label in half.
 * They are now rendered into a fixed-position portal.
 *
 * This asserts the property that actually broke: the rendered tooltip is fully
 * inside the viewport, even for a trigger whose ancestors clip their overflow.
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(appUrl);
  await page.waitForTimeout(1000);

  /* Hover with an explicit mouse move: Playwright's .hover() scrolls the target
   * into view, and any scroll dismisses tooltips by design. */
  async function tooltipFor(selector) {
    const box = await page.locator(selector).first().boundingBox();
    assert.ok(box, `${selector} should be visible`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(520);
    return page.evaluate(() => {
      const tip = document.querySelector("#tooltipLayer .app-tooltip");
      if (!tip || !tip.classList.contains("is-visible")) return null;
      const rect = tip.getBoundingClientRect();
      return {
        text: tip.textContent,
        side: tip.dataset.side,
        rect,
        onScreen:
          rect.top >= -1 &&
          rect.left >= -1 &&
          rect.bottom <= window.innerHeight + 1 &&
          rect.right <= window.innerWidth + 1,
      };
    });
  }

  /* 1. The reported case: a ribbon button whose deck clips vertically. */
  const ribbon = await tooltipFor('[data-ribbon-command="doc-title-page"]');
  assert.ok(ribbon, "the ribbon tooltip must render");
  assert.match(ribbon.text, /title page/i);
  assert.equal(ribbon.onScreen, true, `ribbon tooltip must not be clipped: ${JSON.stringify(ribbon)}`);

  /* The tooltip must also escape a clipping ancestor in the DOM tree. */
  const clipped = await page.evaluate(() => {
    const tip = document.querySelector("#tooltipLayer .app-tooltip");
    if (!tip) return true;
    let node = tip.parentElement;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if (style.overflow !== "visible" && style.overflow !== "") return false;
      node = node.parentElement;
    }
    return true;
  });
  assert.equal(clipped, true, "the tooltip layer must not clip its children");

  /* 2. A trigger near the bottom of the window flips above. */
  const bottom = await tooltipFor(".start-tips span, #helpButton");
  if (bottom) {
    assert.equal(bottom.onScreen, true, `bottom tooltip must stay on screen: ${JSON.stringify(bottom)}`);
  }

  /* 3. Dismissal: moving the pointer away hides it. */
  await page.mouse.move(720, 600);
  await page.waitForTimeout(400);
  assert.equal(
    await page.evaluate(() => {
      const tip = document.querySelector("#tooltipLayer .app-tooltip");
      return !tip || !tip.classList.contains("is-visible");
    }),
    true,
    "tooltip must hide when the pointer leaves",
  );

  /* 4. No pseudo-element tooltips may remain — that was the clipping bug. */
  const pseudo = await page.evaluate(() => {
    const probe = document.querySelector("[data-tooltip]");
    if (!probe) return "";
    return getComputedStyle(probe, "::after").content;
  });
  assert.ok(
    pseudo === "none" || pseudo === "normal",
    `tooltips must not be drawn with ::after (got ${pseudo})`,
  );

  assert.deepEqual(errors, []);
  console.log("PASS: tooltip layer test");
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  process.exit(1);
});

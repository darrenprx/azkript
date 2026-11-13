/* Regressions for theme glyphs, interrupted transitions, palette navigation and motion. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");
const root = path.resolve(__dirname, "../..");
const output = path.join(root, "reports/ui-polish");

(async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  const cases = [];
  let failures = 0;
  async function check(name, run, options = {}) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 },
      reducedMotion: "no-preference", ...options.context });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.addInitScript(prefs => localStorage.setItem("azkript.prefs.v2", JSON.stringify({
        startCenter: false, smartTypeEnabled: false, ...prefs,
      })), options.prefs || {});
      await page.goto(pathToFileURL(path.join(root, "app/index.html")).href);
      await page.waitForFunction(() => document.querySelector("#workspaceButton") &&
        !document.querySelector("#appShell").classList.contains("is-loading"));
      await run(page);
      assert.deepEqual(errors, []);
      cases.push({ name, passed: true });
      console.log("PASS: " + name);
    } catch (error) {
      failures++;
      cases.push({ name, passed: false, error: error.message });
      console.error("FAIL: " + name + "\n" + error.stack);
      await page.screenshot({ path: path.join(output, `failure-${cases.length}.png`) }).catch(() => {});
    } finally { await context.close(); }
  }
  const waitForTheme = async (page, theme) => {
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await page.waitForFunction(theme => {
      const visible = [...document.querySelectorAll("#themeToggle svg")]
        .filter(svg => Number(getComputedStyle(svg).opacity) > 0.01);
      const glyph = { light: "sun", dark: "moon", midnight: "midnight" }[theme];
      return visible.length === 1 && visible[0].firstElementChild.getAttribute("href") === `#i-${glyph}` &&
        Number(getComputedStyle(visible[0]).opacity) > 0.99;
    }, theme);
  };
  try {
    await fs.mkdir(output, { recursive: true });
    await check("Day, Night and Midnight show one centered glyph and toggle correctly", async page => {
      await page.locator("#settingsButton").click();
      for (const [theme, glyph] of [["light", "sun"], ["dark", "moon"], ["midnight", "midnight"]]) {
        await page.locator("#settingsTheme").selectOption(theme);
        await waitForTheme(page, theme);
        const visible = await page.locator("#themeToggle").evaluate(button => {
          const rect = button.getBoundingClientRect();
          return [...button.querySelectorAll("svg")].filter(svg => Number(getComputedStyle(svg).opacity) > 0.99)
            .map(svg => ({ href: svg.firstElementChild.getAttribute("href"),
              dx: Math.abs(svg.getBoundingClientRect().x + svg.getBoundingClientRect().width / 2 - rect.x - rect.width / 2),
              dy: Math.abs(svg.getBoundingClientRect().y + svg.getBoundingClientRect().height / 2 - rect.y - rect.height / 2) }));
        });
        assert.equal(visible.length, 1);
        assert.equal(visible[0].href, `#i-${glyph}`);
        assert.ok(visible[0].dx < 0.6 && visible[0].dy < 0.6);
      }
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector("#appDialog").open);
      await page.locator("#themeToggle").click();
      await waitForTheme(page, "light");
      await page.locator("#themeToggle").click();
      await waitForTheme(page, "dark");
    });
    await check("rapid theme requests cannot restore a stale palette or label", async page => {
      await page.locator("#settingsButton").click();
      await page.evaluate(() => {
        const select = document.querySelector("#settingsTheme");
        for (const theme of ["dark", "midnight", "light", "dark", "midnight"]) {
          select.value = theme; select.dispatchEvent(new Event("change"));
        }
      });
      await waitForTheme(page, "midnight");
      await page.waitForTimeout(350);
      assert.equal(await page.locator("html").getAttribute("data-theme"), "midnight");
      assert.match(await page.locator("#themeToggle").getAttribute("aria-label"), /Midnight.*Day/);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("azkript.prefs.v2")).theme), "midnight");
      assert.equal(await page.locator("meta[name=color-scheme]").getAttribute("content"), "dark");
    });
    await check("palette arrows preserve result nodes, avoid replaying entrances and reveal selection", async page => {
      await page.locator("#commandButton").click();
      await page.locator("#commandInput").focus();
      await page.evaluate(() => {
        window.polishRows = [...document.querySelectorAll(".command-item")];
        window.polishMutations = 0;
        new MutationObserver(records => { window.polishMutations += records.length; })
          .observe(document.querySelector("#commandList"), { childList: true });
      });
      for (let index = 0; index < 19; index++) await page.keyboard.press("ArrowDown");
      const result = await page.evaluate(() => {
        const list = document.querySelector("#commandList");
        const selected = list.querySelector('[aria-selected="true"]');
        const bounds = list.getBoundingClientRect(), row = selected.getBoundingClientRect();
        return { mutations: window.polishMutations,
          same: [...list.children].every((row, index) => row === window.polishRows[index]),
          visible: row.top >= bounds.top - 1 && row.bottom <= bounds.bottom + 1,
          active: document.querySelector("#commandInput").getAttribute("aria-activedescendant"),
          id: selected.id, selectedCount: list.querySelectorAll('[aria-selected="true"]').length };
      });
      assert.equal(result.mutations, 0);
      assert.equal(result.same, true);
      assert.equal(result.visible, true);
      assert.equal(result.active, result.id);
      assert.equal(result.selectedCount, 1);
      await page.locator("#commandInput").fill("zzzz no results");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowUp");
      assert.equal(await page.locator("#commandInput").getAttribute("aria-activedescendant"), null);
      await page.locator("#commandInput").fill("Midnight");
      await page.keyboard.press("Enter");
      await waitForTheme(page, "midnight");
      assert.equal(await page.locator("#commandDialog").evaluate(dialog => dialog.open), false);
    });
    await check("rapid view changes leave one interactive panel and card hover survives entry", async page => {
      await page.evaluate(() => {
        for (const view of ["navigator", "reports", "script", "characters", "navigator"]) {
          document.querySelector(`.rail__item[data-view="${view}"]`).click();
        }
      });
      await page.waitForTimeout(650);
      const panels = await page.locator(".view").evaluateAll(panels => panels.filter(panel => !panel.hidden)
        .map(panel => ({ view: panel.dataset.viewPanel, inert: panel.inert, entering: panel.classList.contains("is-entering") })));
      assert.deepEqual(panels, [{ view: "navigator", inert: false, entering: false }]);
      const card = page.locator(".scene-card").first();
      await card.hover();
      await page.waitForTimeout(250);
      assert.notEqual(await card.evaluate(el => getComputedStyle(el).transform), "none");
    });
    for (const mode of ["app", "system", "system-changed-live"]) {
      await check(`${mode} reduced motion has no stagger, ripple or modal-close delay`, async page => {
        if (mode === "system-changed-live") await page.emulateMedia({ reducedMotion: "reduce" });
        const delay = await page.locator(".scene-item").last().evaluate(el => {
          el.style.setProperty("--i", "200"); return getComputedStyle(el).animationDelay;
        });
        assert.equal(parseFloat(delay), 0);
        await page.locator("#commandButton").click();
        assert.equal(parseFloat(await page.locator(".command-item").last().evaluate(el => getComputedStyle(el).animationDelay)), 0);
        const closed = await page.evaluate(() => {
          const dialog = document.querySelector("#commandDialog");
          dialog.dispatchEvent(new Event("cancel", { cancelable: true })); return !dialog.open;
        });
        assert.equal(closed, true);
        await page.locator(".rail__item[data-view=navigator]").click();
        assert.equal(await page.locator(".view:not([hidden])").count(), 1);
        await page.locator("#brandButton").click();
        await page.locator(".template-card").first().dispatchEvent("pointerdown", { clientX: 10, clientY: 10 });
        assert.equal(await page.locator(".ripple").count(), 0);
      }, { prefs: { reducedMotionPref: mode === "app" },
        context: { reducedMotion: mode === "system" ? "reduce" : "no-preference" } });
    }
    await check("command glyph stays symmetric and theme controls fit across widths and scale", async page => {
      const geometry = await page.locator("#i-command path").evaluate(el => {
        const b = el.getBBox(); return { x: b.x, y: b.y, width: b.width, height: b.height };
      });
      assert.deepEqual(geometry, { x: 3, y: 3, width: 18, height: 18 });
      for (const [width, scale] of [[1440, 1], [1100, 1], [1440, 2]]) {
        await page.setViewportSize({ width, height: 950 });
        await page.locator("#settingsButton").click();
        await page.locator("#settingsTheme").selectOption("midnight");
        await waitForTheme(page, "midnight");
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.querySelector("#appDialog").open);
        if (scale !== 1) {
          await page.locator("#commandButton").click();
          await page.locator("#commandInput").fill("Typography and accessibility");
          await page.keyboard.press("Enter");
          await page.locator("#interfaceScale").selectOption(String(scale));
          await page.getByRole("button", { name: "Apply", exact: true }).click();
          await page.waitForFunction(() => !document.querySelector("#appDialog").open);
        }
        await page.waitForTimeout(600);
        assert.equal(await page.evaluate(() => Number(getComputedStyle(document.documentElement).zoom)), scale);
        for (const id of ["themeToggle", "commandButton"]) {
          const rect = await page.locator(`#${id}`).boundingBox();
          assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= width, `${id} fits at ${width}/${scale}`);
        }
        await page.screenshot({ path: path.join(output, `midnight-${width}-${scale}x.png`) });
      }
    });
    await fs.writeFile(path.join(output, "verification.json"), JSON.stringify({ cases, failures }, null, 2) + "\n");
  } finally { await browser.close(); }
  if (failures) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });

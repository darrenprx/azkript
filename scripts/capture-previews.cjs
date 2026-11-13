/* Regenerate the README preview screenshots from the current renderer.
 *
 * The previews are committed artifacts used by the public README,
 * so they have to be re-shot whenever
 * the brand or the workspace shell changes. Each scenario drives the real UI
 * (no synthetic markup) at the documented 1600x1000 size; the mobile shot uses
 * a 900x1000 viewport.
 *
 *   node scripts/capture-previews.cjs
 */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const playwrightPath = path.join(root, "node_modules", "playwright-core");
if (!fs.existsSync(playwrightPath)) {
  console.log("SKIP: node_modules/playwright-core is not installed");
  process.exit(0);
}
const { chromium } = require(playwrightPath);
const { _electron } = require(playwrightPath);
const chrome =
  process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;
const outDir = path.join(root, "app");

/* Pin the visual state so shots do not drift with per-machine preferences. */
const PINNED_PREFS = {
  theme: "light",
  accentColor: "cobalt",
  paperTint: "ivory",
  uiDensity: "comfortable",
  ambientGlow: true,
  startCenter: false,
  showOutline: true,
  showRuler: true,
  navigatorVisible: true,
  zoom: 1,
  font: "Courier Final Draft",
  fontSize: 12,
};

async function open(browser, viewport, { theme = "light" } = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: theme === "dark" ? "dark" : "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.addInitScript(
    ({ prefs, theme }) => {
      try {
        localStorage.setItem("azkript.prefs.v2", JSON.stringify({ ...prefs, theme }));
      } catch {
        /* storage unavailable: the shot will use defaults */
      }
    },
    { prefs: PINNED_PREFS, theme },
  );
  await page.goto(appUrl);
  await page.waitForTimeout(1200);
  return { context, page };
}

async function shot(page, name) {
  const target = path.join(outDir, name);
  /* Park the pointer off the toolbar so no hover tooltip lands in the shot. */
  await page.mouse.move(8, 8).catch(() => {});
  await page.waitForTimeout(250).catch(() => {});
  await page.screenshot({ path: target, animations: "disabled" });
  const { size } = fs.statSync(target);
  console.log(`wrote ${name} (${size} bytes)`);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    /* Desktop workspace, light theme: the hero image. */
    {
      const { context, page } = await open(browser, { width: 1600, height: 1000 });
      await shot(page, "preview.png");
      await context.close();
    }

    /* Start Center. It is desktop-only UI (`showStartCenter` no-ops in the
     * browser build), so this shot drives the real Electron shell. */
    {
      const userData = await fsp.mkdtemp(path.join(os.tmpdir(), "azkript-preview-"));
      const env = { ...process.env, AZKRIPT_USER_DATA: userData, AZKRIPT_TEST_BACKGROUND: '1', AZKRIPT_TEST_OFFSCREEN: '1' };
      /* Launching Electron from a Node process that itself was started by
       * Electron would otherwise inherit this and run as plain Node. */
      delete env.ELECTRON_RUN_AS_NODE;
      const electronApp = await _electron.launch({
        executablePath: path.join(root, "node_modules", "electron", "dist", "electron.exe"),
        args: [".", "--force-device-scale-factor=1", "--disable-gpu"],
        cwd: root,
        env,
      });
      try {
        const page = await electronApp.firstWindow();
        await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000));
        await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => {});
        await page.addInitScript(prefs => localStorage.setItem('azkript.prefs.v2', JSON.stringify(prefs)), PINNED_PREFS);
        await page.reload();
        await page.waitForFunction(() => !document.querySelector('#appShell').classList.contains('is-loading'));
        await page.waitForTimeout(1600);
        if (!(await page.locator("#startCenter").evaluate((el) => el.open))) {
          await page.locator("#brandButton").click();
          await page.waitForTimeout(700);
        }
        await page.waitForTimeout(400);
        await page.waitForFunction(() => document.querySelector('#startCenter').open);
        // CDP screenshots can wait indefinitely for a hidden native window's
        // compositor. Electron can capture it while explicitly keeping it hidden.
        const capture = await electronApp.evaluate(async ({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0];
          const image = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
          return { visible: win.isVisible(), empty: image.isEmpty(), png: image.toPNG().toString('base64') };
        });
        if (capture.visible || capture.empty) throw new Error('Start Center capture must come from a populated hidden window.');
        const bytes = Buffer.from(capture.png, 'base64');
        await fsp.writeFile(path.join(outDir, 'preview-start.png'), bytes);
        console.log(`wrote preview-start.png (${bytes.length} bytes; native window remained hidden)`);
      } finally {
        await electronApp.close().catch(() => {});
        await fsp.rm(userData, { recursive: true, force: true }).catch(() => {});
      }
    }

    /* Paginated page view. Step past the title page so the shot shows the
     * engine's real output (scene headings, dialogue splits, page furniture). */
    {
      const { context, page } = await open(browser, { width: 1600, height: 1000 });
      await page.locator("#viewSegmented [data-mode='page']").click();
      await page.waitForTimeout(900);
      const next = page.locator("#pageNext");
      if (await next.isVisible().catch(() => false)) {
        await next.click();
        await page.waitForTimeout(700);
      }
      await shot(page, "preview-page.png");
      await context.close();
    }

    /* Dark theme. */
    {
      const { context, page } = await open(browser, { width: 1600, height: 1000 }, { theme: "dark" });
      await shot(page, "preview-dark.png");
      await context.close();
    }

    /* Revision marking turned on. */
    {
      const { context, page } = await open(browser, { width: 1600, height: 1000 });
      await page.locator("#revisionButton").click();
      await page.waitForTimeout(500);
      const enable = page.locator("#appDialog .btn--primary");
      if (await enable.count()) {
        await enable.first().click();
        await page.waitForTimeout(500);
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      /* Put the caret at the end of the paragraph: a bare click lands wherever
       * the pointer did, which split the word in the previous capture. */
      await page.locator(".para[data-type='Action']").first().click();
      await page.keyboard.press("Control+End");
      await page.keyboard.press("End");
      await page.keyboard.type(" A revised line.");
      await page.waitForTimeout(700);
      await shot(page, "preview-revision.png");
      await context.close();
    }

    /* Find and replace. */
    {
      const { context, page } = await open(browser, { width: 1600, height: 1000 });
      await page.locator("#findButton").click();
      await page.waitForTimeout(500);
      await page.locator("#findInput").fill("radio");
      await page.waitForTimeout(500);
      await shot(page, "preview-find.png");
      await context.close();
    }

    /* Narrow reflow. */
    {
      const { context, page } = await open(browser, { width: 900, height: 1000 });
      await shot(page, "preview-mobile.png");
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  process.exit(1);
});

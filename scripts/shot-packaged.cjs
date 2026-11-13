/* Screenshot the PACKAGED app and assert what it actually renders.
 *
 * Why this exists: every other visual check in this repo drives `app/index.html` in
 * Chrome, which proves the SOURCE renders. It does not prove the artifact a user
 * double-clicks contains that source. This project has already shipped a build whose
 * `app.asar` predated the typography rebalance — the installer worked perfectly and
 * still showed the old, too-small chrome. A source-level screenshot could not catch
 * that; comparing the packaged bytes against the source did.
 *
 * It launches the actual packaged executable with an isolated profile and
 * hidden offscreen rendering, then verifies its Electron version and UI.
 *
 * It asserts, rather than merely photographs:
 *   - the packaged stylesheet carries the typography tokens (a build made before the
 *     type-scale work fails here, loudly);
 *   - the statusbar, ribbon caption and navigator heading resolve at >= 11px;
 *   - the screenplay body is still 12pt;
 *   - the titlebar mark is the generated sprite.
 *
 * Usage: node scripts/shot-packaged.cjs [out.png] [--dark]
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const outArg = args.find((a) => !a.startsWith("--"));
const dark = args.includes("--dark");
const out = path.resolve(
  outArg ||
    path.join(
      root,
      "reports",
      "packaged-app-2026-10-22",
      dark ? "packaged-app-dark.png" : "packaged-app-light.png"
    )
);

const ASAR = path.join(root, "dist", "win-unpacked", "resources", "app.asar");
const electronPath = path.join(root, "dist", "win-unpacked", "Azkript.exe");
const playwrightPath = path.join(root, "node_modules", "playwright-core");

for (const required of [ASAR, electronPath]) {
  if (!fs.existsSync(required)) {
    console.error(`MISSING: ${required} — run npm run package:dir first`);
    process.exit(2);
  }
}
if (!fs.existsSync(playwrightPath)) {
  console.error(`SKIP: ${playwrightPath} is not installed`);
  process.exit(1);
}

(async () => {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const { _electron } = require(playwrightPath);
  const profile = fs.mkdtempSync(path.join(process.env.TEMP || ".", "azkript-packaged-"));

  /* ELECTRON_RUN_AS_NODE must be cleared, or Electron boots as a plain Node process
   * and the driver reports the opaque "Process failed to launch!". This shell exports
   * it globally; desktop/tests/electron-smoke.cjs deletes it for the same reason. */
  const env = { ...process.env, AZKRIPT_USER_DATA: profile, AZKRIPT_TEST_BACKGROUND: "1", AZKRIPT_TEST_OFFSCREEN: '1' };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await _electron.launch({
    executablePath: electronPath,
    args: [`--user-data-dir=${profile}`, "--mute-audio", "--disable-renderer-backgrounding", '--force-device-scale-factor=1', '--disable-gpu'],
    cwd: root,
    env,
  });

  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const info = await page.evaluate(() => window.azkript.getInfo());
    const expected = require('../package.json');
    if (!info.packaged || info.version !== expected.version || info.electron !== expected.devDependencies.electron) {
      throw new Error(`Packaged runtime mismatch: app ${info.version}, Electron ${info.electron}`);
    }
    console.log(`Runtime verified: packaged Azkript ${info.version}, Electron ${info.electron}`);
    await page.waitForTimeout(1800);

    if (dark) {
      for (let i = 0; i < 3; i += 1) {
        const theme = await page.evaluate(() => document.documentElement.dataset.theme);
        if (theme === "dark") break;
        await page.locator("#themeToggle").click();
        await page.waitForTimeout(420);
      }
      await page.waitForTimeout(300);
    }

    /* The Start Center opens on a fresh profile and covers the workspace, so dismiss
     * it before the screenshot: the chrome typography this check is about lives in
     * the titlebar, ribbon, navigator, inspector and statusbar behind it. */
    await page.evaluate(() => {
      const dialog = document.getElementById("startCenter");
      if (dialog?.open) dialog.close();
    });
    await page.waitForTimeout(600);

    const typography = await page.evaluate(() => {
      const rootStyle = getComputedStyle(document.documentElement);
      const pick = (selector) => {
        const el = document.querySelector(selector);
        return el ? getComputedStyle(el).fontSize : null;
      };
      return {
        fs2xs: rootStyle.getPropertyValue("--fs-2xs").trim(),
        fsSm: rootStyle.getPropertyValue("--fs-sm").trim(),
        scriptSize: rootStyle.getPropertyValue("--script-size").trim(),
        statusbar: pick(".statusbar"),
        ribbonCaption: pick(".ribbon-group__label"),
        sceneHeading: pick(".scene-item__heading"),
        screenplayBody: pick(".para"),
      };
    });
    console.log("packaged typography:", JSON.stringify(typography, null, 2));

    /* The assertions are the point. A screenshot alone is a picture, not a check, and
     * the stale-build defect was invisible until artifact and source were compared. */
    if (!typography.fs2xs) {
      throw new Error(
        "the packaged stylesheet has no --fs-2xs token, so this build predates the type-scale " +
          "rebalance. Re-run `npm run package:dir` before shipping it."
      );
    }
    if (typography.fs2xs !== "11px") {
      throw new Error(`packaged floor token --fs-2xs is "${typography.fs2xs}", expected 11px`);
    }
    for (const [label, value] of [
      ["statusbar", typography.statusbar],
      ["ribbon group caption", typography.ribbonCaption],
      ["navigator scene heading", typography.sceneHeading],
    ]) {
      if (value === null) {
        console.warn(`warning: ${label} not present in the packaged DOM`);
        continue;
      }
      if (Number.parseFloat(value) < 11) {
        throw new Error(`packaged ${label} renders at ${value}, below the 11px floor`);
      }
    }
    if (typography.scriptSize !== "12pt") {
      throw new Error(`packaged screenplay body is ${typography.scriptSize}, expected 12pt`);
    }

    /* The Scene View must be THEMED in the artifact, not just in the source.
     *
     * This is the check for the "different style than the rest of the app" report. It reads
     * computed styles in the packaged renderer: an unstyled <input> paints with the platform
     * bevel (`border-style: inset`), which no rule in this app ever emits. A stale build
     * that predates the Scene View restyle fails here even though the source is correct —
     * exactly the trap `verify:release` exists for. */
    await page.locator('.rail__item[data-view="sceneview"]').click();
    await page.waitForTimeout(700);
    const sceneView = await page.evaluate(() => {
      const input = document.querySelector(".sv-inline-input");
      const header = document.querySelector(".sv-row--head");
      const table = document.querySelector(".scene-view-table");
      const style = input ? getComputedStyle(input) : null;
      return {
        headerRow: Boolean(header),
        inputs: document.querySelectorAll(".sv-inline-input").length,
        inputBorderStyle: style ? style.borderTopStyle : null,
        inputRadius: style ? style.borderRadius : null,
        tableOverflow: table ? table.scrollWidth - table.clientWidth : null,
      };
    });
    console.log("packaged scene view:", JSON.stringify(sceneView));
    if (!sceneView.headerRow) {
      throw new Error("the packaged Scene View has no .sv-row--head header strip");
    }
    if (sceneView.inputs === 0) {
      throw new Error("the packaged Scene View rendered no inline editors");
    }
    if (/inset/.test(String(sceneView.inputBorderStyle))) {
      throw new Error(
        `the packaged Scene View inline editor still paints the platform bevel ` +
          `(border-style: ${sceneView.inputBorderStyle}). This build predates the Fluent restyle; ` +
          "run `npm run package:dir`."
      );
    }
    if (sceneView.tableOverflow !== null && sceneView.tableOverflow > 1) {
      throw new Error(`the packaged Scene View table scrolls ${sceneView.tableOverflow}px at the default window`);
    }
    // Return to the script view so the screenshot shows the default workspace.
    await page.locator('.rail__item[data-view="script"]').click();
    await page.waitForTimeout(600);

    /* The mark is an SVG <symbol> def injected by scripts/sync-brand.cjs and
     * referenced with <use href="#i-app-mark">, so the glyph geometry lives in the
     * sprite definition rather than inside each <svg>. Assert BOTH halves: the
     * titlebar references the generated sprite id, and that symbol actually contains
     * the generated gradients/fold/letter. Checking only the <use> tag would pass for
     * a symbol that had been emptied, and checking only the symbol would not notice a
     * titlebar that had reverted to an inline hand-drawn copy. */
    const mark = await page.evaluate(() => {
      const holder = document.querySelector(".titlebar__brand .app-mark");
      const symbol = document.getElementById("i-app-mark");
      const useRef = holder?.querySelector("use")?.getAttribute("href") ?? null;
      const symbolHtml = symbol ? symbol.innerHTML : "";
      return {
        holderFound: Boolean(holder),
        useRef,
        symbolFound: Boolean(symbol),
        symbolIsGenerated: /az-page/.test(symbolHtml) && /az-badge/.test(symbolHtml) && /az-sheet-clip/.test(symbolHtml),
        symbolHasLetter: /M98 55V375/.test(symbolHtml),
      };
    });
    if (!mark.holderFound) console.warn("warning: no brand mark in the packaged titlebar");
    else if (!mark.symbolFound) {
      throw new Error(
        "the packaged page has no #i-app-mark symbol: the brand sprite was not injected. " +
          "Run node scripts/sync-brand.cjs and repackage."
      );
    } else if (!mark.useRef?.includes("i-app-mark")) {
      throw new Error(`the packaged titlebar mark references "${mark.useRef}", not the generated sprite #i-app-mark`);
    } else if (!mark.symbolIsGenerated || !mark.symbolHasLetter) {
      throw new Error(
        "the packaged #i-app-mark symbol is not the generated mark (missing az-page/az-badge/" +
          "az-sheet-clip gradients or the S outline)"
      );
    }

    const capture = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const image = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      return { visible: win.isVisible(), empty: image.isEmpty(), png: image.toPNG().toString('base64') };
    });
    if (capture.visible || capture.empty) throw new Error('Packaged capture must come from a populated hidden window.');
    fs.writeFileSync(out, Buffer.from(capture.png, 'base64'));
    console.log("wrote", path.relative(root, out));
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      /* Electron may still hold a lock; the temp dir is disposable */
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
